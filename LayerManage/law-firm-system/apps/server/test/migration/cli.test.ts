import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { executeCommand, parseArgs } from '../../scripts/migration/cli';
import { writeMigrationReport } from '../../scripts/migration/report-writer';

function temporaryOutputRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-oa-cli-'));
}

function createImportSource(outputRoot: string): string {
  const sourcePath = path.join(outputRoot, 'source.sqlite');
  const database = new Database(sourcePath);
  try {
    database.exec('CREATE TABLE "Organization" (id TEXT PRIMARY KEY, name TEXT, createdAt TEXT, updatedAt TEXT)');
    database.exec("INSERT INTO \"Organization\" VALUES ('org-cli', 'CLI firm', '2026-04-01 08:00:00', '2026-04-01 08:00:00')");
  } finally {
    database.close();
  }
  return sourcePath;
}

test('requires a source and deterministic diff report locator for import', () => {
  assert.throws(() => parseArgs(['import']), /--source/);
  assert.throws(() => parseArgs(['import', '--source', 'a.db']), /--confirm-diff/);
  assert.throws(() => parseArgs(['import', '--source', 'a.db', '--confirm-diff', 'abc']), /--diff-run-id/);
  assert.deepEqual(parseArgs(['diff', '--primary', 'a.db', '--secondary', 'b.db', '--run-id', 'r1']).command, 'diff');
  assert.throws(() => parseArgs(['inventory', '--source', 'a.db', '--run-id', 'r1', '--unexpected', 'value']), /Invalid migration CLI arguments/);
  assert.throws(() => parseArgs(['inventory', '--source', 'a.db', '--run-id', '../escape']), /run ID/);
});

test('rejects an invalid run ID and writes reports by atomic rename without snapshot records', () => {
  const outputRoot = temporaryOutputRoot();
  try {
    assert.throws(() => writeMigrationReport('../escape', 'inventory.json', {}, outputRoot), /run ID/);
    const reportPath = writeMigrationReport('run_1', 'inventory.json', { tables: { Organization: { rowCount: 1 } } }, outputRoot);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), { tables: { Organization: { rowCount: 1 } } });
    assert.equal(fs.readdirSync(path.dirname(reportPath)).some(name => name.includes('.tmp-')), false);
    assert.throws(() => writeMigrationReport('run_1', 'inventory.json', { records: [{ password: 'never-write' }] }, outputRoot), /records/);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('rejects a stale diff confirmation before constructing a PostgreSQL pool', async () => {
  const outputRoot = temporaryOutputRoot();
  let poolConstructed = false;
  try {
    const diffPath = writeMigrationReport('diff_run', 'diff-report.json', { counts: {}, tableCounts: {}, conflicts: [] }, outputRoot);
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

test('writes the imported full-fidelity snapshot only under the importing run export directory', async () => {
  const outputRoot = temporaryOutputRoot();
  try {
    const sourcePath = createImportSource(outputRoot);
    const diffPath = writeMigrationReport('diff_run', 'diff-report.json', { counts: {}, tableCounts: {}, conflicts: [] }, outputRoot);
    const diffHash = createHash('sha256').update(fs.readFileSync(diffPath)).digest('hex');
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

test('writes a payload-free import failure report before propagating the guarded failure', async () => {
  const outputRoot = temporaryOutputRoot();
  try {
    const sourcePath = createImportSource(outputRoot);
    const diffPath = writeMigrationReport('diff_run', 'diff-report.json', { counts: {}, tableCounts: {}, conflicts: [] }, outputRoot);
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
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});
