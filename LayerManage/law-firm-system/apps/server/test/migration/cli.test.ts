import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { MigrationValidationFailedError, executeCommand, main, parseArgs } from '../../scripts/migration/cli';
import {
  IMPORT_REPORT_PENDING_FILE,
  publishReservedImportReport,
  reserveImportReport,
  writeMigrationReport,
} from '../../scripts/migration/report-writer';
import { TABLE_ORDER, type TableName } from '../../scripts/migration/table-plan';
import type { DiffReport, SourceInventory, SourceSnapshot, TableInventory, TableSnapshot } from '../../scripts/migration/types';
import { createSQLiteFixtures } from '../fixtures/sqlite/create-fixtures';

function temporaryOutputRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-oa-cli-'));
}

function createImportSource(outputRoot: string): string {
  const sourcePath = path.join(outputRoot, 'source.sqlite');
  const database = new Database(sourcePath);
  try {
    database.exec('CREATE TABLE "Organization" (id TEXT PRIMARY KEY, name TEXT, parentId TEXT, createdAt TEXT, updatedAt TEXT)');
    database.exec("INSERT INTO \"Organization\" VALUES ('org-cli', 'CLI firm', NULL, '2026-04-01 08:00:00', '2026-04-01 08:00:00')");
  } finally {
    database.close();
  }
  return sourcePath;
}

function sourceHash(sourcePath: string): string {
  return createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
}

function validInventory(): SourceInventory {
  return {
    generatedAt: '2026-07-13T00:00:00.000Z',
    runId: 'run_1',
    source: { path: 'fixture.sqlite', sha256: 'a'.repeat(64) },
    tables: Object.fromEntries(TABLE_ORDER.map(table => [table, { columns: ['id'], rowCount: 0 }])) as Record<TableName, TableInventory>,
  };
}

function validDiffReport(primarySha256: string): DiffReport {
  return {
    conflicts: [],
    counts: { PRIMARY_ONLY: 0, SECONDARY_ONLY: 0, CONTENT_MISMATCH: 0, BUSINESS_KEY_COLLISION: 0 },
    generatedAt: '2026-07-13T00:00:00.000Z',
    runId: 'diff_run',
    sources: {
      primary: { path: 'approved-readonly-copy.sqlite', sha256: primarySha256 },
      secondary: { path: 'secondary.sqlite', sha256: 'b'.repeat(64) },
    },
    tableCounts: Object.fromEntries(TABLE_ORDER.map(table => [table, { primary: 0, secondary: 0 }])) as DiffReport['tableCounts'],
  };
}

function writeDiff(outputRoot: string, primarySha256: string): string {
  return writeMigrationReport('diff_run', 'diff-report.json', validDiffReport(primarySha256), outputRoot);
}

function emptySnapshot(sha256 = 'a'.repeat(64)): SourceSnapshot {
  return {
    generatedAt: '2026-07-13T00:00:00.000Z',
    runId: 'stable_snapshot',
    source: { path: 'approved.sqlite', sha256 },
    tables: Object.fromEntries(TABLE_ORDER.map(table => [table, { columns: [], rowCount: 0, records: [] }])) as Record<TableName, TableSnapshot>,
  };
}

test('requires a source and deterministic diff report locator for import', () => {
  assert.throws(() => parseArgs(['import']), /--source/);
  assert.throws(() => parseArgs(['import', '--source', 'a.db']), /--confirm-diff/);
  assert.throws(() => parseArgs(['import', '--source', 'a.db', '--confirm-diff', 'abc']), /--diff-run-id/);
  assert.deepEqual(parseArgs(['diff', '--primary', 'a.db', '--secondary', 'b.db', '--run-id', 'r1']).command, 'diff');
  assert.throws(() => parseArgs(['inventory', '--source', 'a.db', '--run-id', 'r1', '--unexpected', 'value']), /Invalid migration CLI arguments/);
  assert.throws(() => parseArgs(['inventory', '--source', 'a.db', '--run-id', '../escape']), /run ID/);
  assert.throws(
    () => parseArgs(['import', '--source', 'a.db', '--confirm-diff', 'a'.repeat(64), '--diff-run-id', '../escape', '--run-id', 'r1']),
    /run ID/,
  );
  assert.throws(
    () => parseArgs(['inventory', '--source', 'a.db', '--source', 'b.db', '--run-id', 'r1']),
    /Invalid migration CLI arguments/,
  );
});

test('rejects an invalid run ID and writes reports by atomic publication', () => {
  const outputRoot = temporaryOutputRoot();
  try {
    const inventory = validInventory();
    assert.throws(() => writeMigrationReport('../escape', 'inventory.json', inventory, outputRoot), /run ID/);
    const reportPath = writeMigrationReport('run_1', 'inventory.json', inventory, outputRoot);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), inventory);
    assert.equal(fs.readdirSync(path.dirname(reportPath)).some(name => name.includes('.tmp-')), false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('rejects a stale diff confirmation before constructing a PostgreSQL pool', async () => {
  const outputRoot = temporaryOutputRoot();
  let poolConstructed = false;
  try {
    const diffPath = writeDiff(outputRoot, 'a'.repeat(64));
    const staleHash = createHash('sha256').update('stale').digest('hex');

    await assert.rejects(
      () => executeCommand(
        parseArgs(['import', '--source', 'never-open.sqlite', '--confirm-diff', staleHash, '--diff-run-id', 'diff_run', '--run-id', 'import_run']),
        {
          outputRoot,
          createPool: () => {
            poolConstructed = true;
            throw new Error('Pool must not be constructed');
          },
        },
      ),
      /Diff report confirmation failed/,
    );
    assert.equal(fs.existsSync(diffPath), true);
    assert.equal(poolConstructed, false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('rejects a missing diff report before constructing a PostgreSQL pool', async () => {
  const outputRoot = temporaryOutputRoot();
  let poolConstructed = false;
  try {
    await assert.rejects(
      () => executeCommand(
        parseArgs(['import', '--source', 'never-open.sqlite', '--confirm-diff', 'a'.repeat(64), '--diff-run-id', 'missing', '--run-id', 'import_run']),
        {
          outputRoot,
          createPool: () => {
            poolConstructed = true;
            throw new Error('Pool must not be constructed');
          },
        },
      ),
      /Diff report confirmation failed/,
    );
    assert.equal(poolConstructed, false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('rejects a confirmed but malformed diff report before reading or connecting', async () => {
  const outputRoot = temporaryOutputRoot();
  const sourcePath = createImportSource(outputRoot);
  let poolConstructed = false;
  try {
    const diffDirectory = path.join(outputRoot, 'diff_run');
    fs.mkdirSync(diffDirectory, { recursive: true });
    const diffPath = path.join(diffDirectory, 'diff-report.json');
    fs.writeFileSync(diffPath, JSON.stringify({ sources: { primary: { sha256: sourceHash(sourcePath) } }, payload: 'private-content' }));
    const confirmation = sourceHash(diffPath);

    await assert.rejects(
      () => executeCommand(
        parseArgs(['import', '--source', sourcePath, '--confirm-diff', confirmation, '--diff-run-id', 'diff_run', '--run-id', 'import_run']),
        {
          outputRoot,
          createPool: () => {
            poolConstructed = true;
            throw new Error('Pool must not be constructed');
          },
        },
      ),
      /Diff report confirmation failed/,
    );
    assert.equal(poolConstructed, false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('rejects a confirmed diff whose embedded run ID does not match its directory before source access', async () => {
  const outputRoot = temporaryOutputRoot();
  let poolConstructed = false;
  let sourceRead = false;
  try {
    const copiedDiff = { ...validDiffReport('a'.repeat(64)), runId: 'different_run' };
    const diffPath = writeMigrationReport('diff_run', 'diff-report.json', copiedDiff, outputRoot);
    const confirmation = sourceHash(diffPath);

    await assert.rejects(
      () => executeCommand(
        parseArgs(['import', '--source', 'never-open.sqlite', '--confirm-diff', confirmation, '--diff-run-id', 'diff_run', '--run-id', 'import_run']),
        {
          outputRoot,
          readSnapshot() {
            sourceRead = true;
            return emptySnapshot();
          },
          createPool: () => {
            poolConstructed = true;
            throw new Error('Pool must not be constructed');
          },
        },
      ),
      /Diff report confirmation failed/,
    );
    assert.equal(sourceRead, false);
    assert.equal(poolConstructed, false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('rejects a diff bound to unrelated source content before constructing a PostgreSQL pool', async () => {
  const outputRoot = temporaryOutputRoot();
  const sourcePath = createImportSource(outputRoot);
  let poolConstructed = false;
  try {
    const diffPath = writeDiff(outputRoot, 'c'.repeat(64));
    const confirmation = sourceHash(diffPath);
    await assert.rejects(
      () => executeCommand(
        parseArgs(['import', '--source', sourcePath, '--confirm-diff', confirmation, '--diff-run-id', 'diff_run', '--run-id', 'import_run']),
        {
          outputRoot,
          createPool: () => {
            poolConstructed = true;
            throw new Error('Pool must not be constructed');
          },
        },
      ),
      /Confirmed diff does not match source/,
    );
    assert.equal(poolConstructed, false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('rejects a WAL-only committed source before import reservation, export, or Pool construction', async () => {
  const outputRoot = temporaryOutputRoot();
  const sourcePath = path.join(outputRoot, 'wal-source.sqlite');
  const database = new Database(sourcePath);
  let poolConstructed = false;
  try {
    database.pragma('journal_mode = WAL');
    database.exec('CREATE TABLE "Organization" (id TEXT PRIMARY KEY)');
    database.pragma('wal_checkpoint(TRUNCATE)');
    const mainSha256 = sourceHash(sourcePath);
    database.exec("INSERT INTO \"Organization\" (id) VALUES ('wal-only-import-row')");
    assert.equal(sourceHash(sourcePath), mainSha256);

    const diffPath = writeDiff(outputRoot, mainSha256);
    const confirmation = sourceHash(diffPath);
    await assert.rejects(
      () => executeCommand(
        parseArgs(['import', '--source', sourcePath, '--confirm-diff', confirmation, '--diff-run-id', 'diff_run', '--run-id', 'import_run']),
        {
          databaseUrl: 'postgresql://test:test@localhost:55432/chengye_oa_test',
          outputRoot,
          createPool: () => {
            poolConstructed = true;
            throw new Error('Pool must not be constructed');
          },
        },
      ),
      /^Error: SQLite source has active sidecar$/,
    );
    assert.equal(poolConstructed, false);
    assert.equal(fs.existsSync(path.join(outputRoot, 'import_run', IMPORT_REPORT_PENDING_FILE)), false);
    assert.equal(fs.existsSync(path.join(outputRoot, 'import_run', 'export')), false);
  } finally {
    database.close();
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('writes the imported full-fidelity snapshot only under the importing run export directory', async () => {
  const outputRoot = temporaryOutputRoot();
  try {
    const sourcePath = createImportSource(outputRoot);
    const diffPath = writeDiff(outputRoot, sourceHash(sourcePath));
    const diffHash = createHash('sha256').update(fs.readFileSync(diffPath)).digest('hex').toUpperCase();
    const events: string[] = [];
    const client = {
      async query(text: string) {
        events.push(text);
        return { rowCount: text.startsWith('SELECT') ? 0 : null, rows: [] };
      },
      release() {
        events.push('release');
      },
    };

    await executeCommand(
      parseArgs(['import', '--source', sourcePath, '--confirm-diff', diffHash, '--diff-run-id', 'diff_run', '--run-id', 'import_run']),
      {
        databaseUrl: 'postgresql://test:test@localhost:55432/chengye_oa_test',
        outputRoot,
        createPool: () => ({
          async connect() {
            events.push('connect');
            return client as never;
          },
          async end() {
            events.push('end');
          },
        }),
      },
    );

    const exportPath = path.join(outputRoot, 'import_run', 'export', 'source-snapshot.json');
    assert.equal(fs.existsSync(exportPath), true);
    assert.equal(fs.existsSync(path.join(outputRoot, 'import_run', 'import-report.json')), true);
    assert.equal(fs.readFileSync(path.join(outputRoot, 'import_run', 'import-report.json'), 'utf8').includes('$2b$10$primaryPasswordHashLiteral'), false);
    assert.equal(events.at(-1), 'end');
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('refuses a pre-existing import report before constructing a PostgreSQL pool', async () => {
  const outputRoot = temporaryOutputRoot();
  const sourcePath = createImportSource(outputRoot);
  let poolConstructed = false;
  try {
    const diffPath = writeDiff(outputRoot, sourceHash(sourcePath));
    const confirmation = sourceHash(diffPath);
    publishReservedImportReport(
      reserveImportReport('import_run', outputRoot),
      { inserted: 0, updated: 0, skipped: 0, failed: 0, failures: [] },
    );

    await assert.rejects(
      () => executeCommand(
        parseArgs(['import', '--source', sourcePath, '--confirm-diff', confirmation, '--diff-run-id', 'diff_run', '--run-id', 'import_run']),
        {
          databaseUrl: 'postgresql://test:test@localhost:55432/chengye_oa_test',
          outputRoot,
          createPool: () => {
            poolConstructed = true;
            throw new Error('Pool must not be constructed');
          },
        },
      ),
      /already exists/,
    );
    assert.equal(poolConstructed, false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('refuses a pre-existing import report reservation before constructing a PostgreSQL pool', async () => {
  const outputRoot = temporaryOutputRoot();
  const sourcePath = createImportSource(outputRoot);
  let poolConstructed = false;
  try {
    const diffPath = writeDiff(outputRoot, sourceHash(sourcePath));
    const confirmation = sourceHash(diffPath);
    reserveImportReport('import_run', outputRoot);

    await assert.rejects(
      () => executeCommand(
        parseArgs(['import', '--source', sourcePath, '--confirm-diff', confirmation, '--diff-run-id', 'diff_run', '--run-id', 'import_run']),
        {
          databaseUrl: 'postgresql://test:test@localhost:55432/chengye_oa_test',
          outputRoot,
          createPool: () => {
            poolConstructed = true;
            throw new Error('Pool must not be constructed');
          },
        },
      ),
      /already exists/,
    );
    assert.equal(poolConstructed, false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('reserves import report publication before Pool construction and aborts on pre-transaction failure', async () => {
  const outputRoot = temporaryOutputRoot();
  const sourcePath = createImportSource(outputRoot);
  const pendingPath = path.join(outputRoot, 'import_run', IMPORT_REPORT_PENDING_FILE);
  let reservationObserved = false;
  try {
    const diffPath = writeDiff(outputRoot, sourceHash(sourcePath));
    const confirmation = sourceHash(diffPath);

    await assert.rejects(
      () => executeCommand(
        parseArgs(['import', '--source', sourcePath, '--confirm-diff', confirmation, '--diff-run-id', 'diff_run', '--run-id', 'import_run']),
        {
          databaseUrl: 'postgresql://test:test@localhost:55432/chengye_oa_test',
          outputRoot,
          createPool: () => {
            reservationObserved = fs.existsSync(pendingPath);
            throw new Error('fixture pool construction failure');
          },
        },
      ),
      /PostgreSQL import failed/,
    );
    assert.equal(reservationObserved, true);
    assert.equal(fs.existsSync(pendingPath), false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('keeps a sanitized recovery marker when final import report publication fails after COMMIT', async () => {
  const outputRoot = temporaryOutputRoot();
  const sourcePath = createImportSource(outputRoot);
  const pendingPath = path.join(outputRoot, 'import_run', IMPORT_REPORT_PENDING_FILE);
  const finalPath = path.join(outputRoot, 'import_run', 'import-report.json');
  const stderr: string[] = [];
  const events: string[] = [];
  try {
    const diffPath = writeDiff(outputRoot, sourceHash(sourcePath));
    const confirmation = sourceHash(diffPath);
    const exitCode = await main(
      ['import', '--source', sourcePath, '--confirm-diff', confirmation, '--diff-run-id', 'diff_run', '--run-id', 'import_run'],
      {
        databaseUrl: 'postgresql://test:test@localhost:55432/chengye_oa_test',
        outputRoot,
        createPool: () => ({
          async connect() {
            events.push('connect');
            return {
              async query(text: string) {
                events.push(text);
                if (text.startsWith('SELECT')) return { rowCount: 0, rows: [] };
                if (text === 'COMMIT') fs.writeFileSync(finalPath, '{"old":true}\n', { flag: 'wx' });
                return { rowCount: null, rows: [] };
              },
              release() { events.push('release'); },
            } as never;
          },
          async end() { events.push('end'); },
        }),
      },
      { stderr: { write(value: string) { stderr.push(value); } } },
    );

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, ['Import report recovery required\n']);
    assert.equal(events.includes('COMMIT'), true);
    assert.equal(events.at(-1), 'end');
    assert.equal(fs.readFileSync(finalPath, 'utf8'), '{"old":true}\n');
    const markerText = fs.readFileSync(pendingPath, 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(markerText)).sort(), ['kind', 'token', 'version']);
    assert.equal(markerText.includes(sourcePath), false);
    assert.equal(markerText.includes('postgresql://'), false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('keeps recovery pending when COMMIT may have succeeded but returns a connection reset', async () => {
  const outputRoot = temporaryOutputRoot();
  const sourcePath = createImportSource(outputRoot);
  const pendingPath = path.join(outputRoot, 'uncertain_import', IMPORT_REPORT_PENDING_FILE);
  const finalPath = path.join(outputRoot, 'uncertain_import', 'import-report.json');
  const stderr: string[] = [];
  const events: string[] = [];
  let serverCommitted = false;
  try {
    const diffPath = writeDiff(outputRoot, sourceHash(sourcePath));
    const confirmation = sourceHash(diffPath);
    const exitCode = await main(
      ['import', '--source', sourcePath, '--confirm-diff', confirmation, '--diff-run-id', 'diff_run', '--run-id', 'uncertain_import'],
      {
        databaseUrl: 'postgresql://test:test@localhost:55432/chengye_oa_test',
        outputRoot,
        createPool: () => ({
          async connect() {
            events.push('connect');
            return {
              async query(text: string) {
                events.push(text);
                if (text.startsWith('SELECT')) return { rowCount: 0, rows: [] };
                if (text === 'COMMIT') {
                  serverCommitted = true;
                  const error = new Error('private connection reset detail') as Error & { code: string };
                  error.code = 'ECONNRESET';
                  throw error;
                }
                return { rowCount: null, rows: [] };
              },
              release() { events.push('release'); },
            } as never;
          },
          async end() { events.push('end'); },
        }),
      },
      { stderr: { write(value: string) { stderr.push(value); } } },
    );

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, ['Import report recovery required\n']);
    assert.equal(serverCommitted, true);
    assert.equal(events.includes('ROLLBACK'), false);
    assert.equal(events.at(-2), 'release');
    assert.equal(events.at(-1), 'end');
    assert.equal(fs.existsSync(finalPath), false);
    const markerText = fs.readFileSync(pendingPath, 'utf8');
    assert.equal(markerText.includes('ECONNRESET'), false);
    assert.equal(markerText.includes('private connection reset detail'), false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('inventory derives report and export from one injected stable snapshot', async () => {
  const outputRoot = temporaryOutputRoot();
  let reads = 0;
  try {
    const fixture = emptySnapshot();
    await executeCommand(
      parseArgs(['inventory', '--source', 'approved.sqlite', '--run-id', 'inventory_run']),
      {
        outputRoot,
        readSnapshot() {
          reads += 1;
          return fixture;
        },
      },
    );
    const inventory = JSON.parse(fs.readFileSync(path.join(outputRoot, 'inventory_run', 'inventory.json'), 'utf8')) as SourceInventory;
    const exported = JSON.parse(fs.readFileSync(path.join(outputRoot, 'inventory_run', 'export', 'source-snapshot.json'), 'utf8')) as SourceSnapshot;
    assert.equal(reads, 1);
    assert.equal(inventory.source.sha256, fixture.source.sha256);
    assert.equal(exported.source.sha256, fixture.source.sha256);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('CLI executable catches duplicate arguments and emits one safe line with exit code 1', () => {
  const result = spawnSync(process.execPath, [
    require.resolve('tsx/cli'),
    path.resolve('scripts/migration/cli.ts'),
    'inventory', '--source', 'private-path.sqlite', '--source', 'duplicate.sqlite', '--run-id', 'run_1',
  ], { cwd: path.resolve('.'), encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Invalid migration CLI arguments\r?\n$/);
  assert.equal(result.stderr.includes('private-path.sqlite'), false);
  assert.equal(result.stderr.includes(' at '), false);
  assert.equal(result.stderr.includes(path.resolve('.')), false);
});

test('writes failed validation report then rejects with a typed error and main returns exit 1', async () => {
  const outputRoot = temporaryOutputRoot();
  const sourcePath = createImportSource(outputRoot);
  const stderr: string[] = [];
  const pools: string[] = [];
  const createValidationPool = () => ({
    async query(text: string) {
      if (text.includes('validation:decimal-total')) return { rows: [{ total: '0' }] };
      return { rows: [] };
    },
    async end() {
      pools.push('end');
    },
  });

  try {
    await assert.rejects(
      () => executeCommand(
        parseArgs(['validate', '--source', sourcePath, '--run-id', 'validation_run']),
        { createValidationPool, databaseUrl: 'postgresql://test:test@localhost:55432/chengye_oa_test', outputRoot },
      ),
      (error: unknown) => error instanceof MigrationValidationFailedError,
    );
    const report = JSON.parse(fs.readFileSync(path.join(outputRoot, 'validation_run', 'validation-report.json'), 'utf8')) as { ok: boolean };
    assert.equal(report.ok, false);

    const exitCode = await main(
      ['validate', '--source', sourcePath, '--run-id', 'validation_main'],
      { createValidationPool, databaseUrl: 'postgresql://test:test@localhost:55432/chengye_oa_test', outputRoot },
      { stderr: { write(value: string) { stderr.push(value); } } },
    );
    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, ['Migration validation failed\n']);
    assert.deepEqual(pools, ['end', 'end']);
    assert.equal(fs.existsSync(path.join(outputRoot, 'validation_main', 'validation-report.json')), true);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('root migration wrapper uses npm prefix and forwards fixture flags on Windows', () => {
  const projectRoot = path.resolve('../..');
  const rootPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.equal(rootPackage.scripts['migration:inventory'], 'npm --prefix apps/server run migration:inventory --');

  const fixtures = createSQLiteFixtures();
  const runId = `root_flags_${process.pid}_${Date.now()}`;
  const runDirectory = path.join(projectRoot, 'var', 'migration', runId);
  try {
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const result = spawnSync(process.execPath, [npmCli, 'run', 'migration:inventory', '--', '--source', fixtures.primaryPath, '--run-id', runId], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(runDirectory, 'inventory.json')), true);
  } finally {
    fixtures.cleanup();
    fs.rmSync(runDirectory, { force: true, recursive: true });
  }
});

test('writes a payload-free import failure report before propagating the guarded failure', async () => {
  const outputRoot = temporaryOutputRoot();
  try {
    const sourcePath = createImportSource(outputRoot);
    const diffPath = writeDiff(outputRoot, sourceHash(sourcePath));
    const diffHash = createHash('sha256').update(fs.readFileSync(diffPath)).digest('hex');
    const failure = new Error('private database payload must not escape') as Error & { code: string };
    failure.code = '23505';

    await assert.rejects(
      () => executeCommand(
        parseArgs(['import', '--source', sourcePath, '--confirm-diff', diffHash, '--diff-run-id', 'diff_run', '--run-id', 'failed_import']),
        {
          databaseUrl: 'postgresql://test:test@localhost:55432/chengye_oa_test',
          outputRoot,
          createPool: () => ({
            async connect() {
              return {
                async query(text: string) {
                  if (text.startsWith('SELECT')) return { rowCount: 0, rows: [] };
                  if (text.startsWith('INSERT')) throw failure;
                  return { rowCount: null, rows: [] };
                },
                release() {},
              } as never;
            },
            async end() {},
          }),
        },
      ),
      /PostgreSQL import failed/,
    );
    const report = fs.readFileSync(path.join(outputRoot, 'failed_import', 'import-report.json'), 'utf8');
    assert.equal(report.includes('private database payload must not escape'), false);
    assert.equal(report.includes('org-cli'), true);
    assert.equal(fs.existsSync(path.join(outputRoot, 'failed_import', IMPORT_REPORT_PENDING_FILE)), false);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});
