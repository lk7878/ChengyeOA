import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeCommand, parseArgs } from '../../scripts/migration/cli';
import { writeMigrationReport } from '../../scripts/migration/report-writer';
import { TABLE_ORDER, type TableName } from '../../scripts/migration/table-plan';
import type { DiffReport, SourceInventory, SourceSnapshot, TableInventory, TableSnapshot } from '../../scripts/migration/types';
import { createSQLiteFixtures, FIXTURE_LITERALS } from '../fixtures/sqlite/create-fixtures';

function temporaryOutputRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-oa-cli-'));
}

function emittedFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? emittedFiles(candidate) : [candidate];
  }).sort();
}

function validInventory(): SourceInventory {
  return {
    generatedAt: '2026-07-13T00:00:00.000Z',
    runId: 'run_1',
    source: { sha256: 'a'.repeat(64) },
    tables: Object.fromEntries(TABLE_ORDER.map(table => [table, { columns: ['id'], rowCount: 0 }])) as Record<TableName, TableInventory>,
  };
}

function emptySnapshot(sha256 = 'a'.repeat(64)): SourceSnapshot {
  return {
    generatedAt: '2026-07-13T00:00:00.000Z',
    runId: 'stable_snapshot',
    source: { path: 'approved.sqlite', sha256 },
    tables: Object.fromEntries(TABLE_ORDER.map(table => [table, { columns: [], rowCount: 0, records: [] }])) as Record<TableName, TableSnapshot>,
  };
}

test('exposes only read-only inventory and diff commands', () => {
  assert.equal(parseArgs(['inventory', '--source', 'a.db', '--run-id', 'r1']).command, 'inventory');
  assert.equal(parseArgs(['diff', '--primary', 'a.db', '--secondary', 'b.db', '--run-id', 'r2']).command, 'diff');
  assert.throws(() => parseArgs(['import', '--source', 'a.db', '--run-id', 'r3']), /command/i);
  assert.throws(() => parseArgs(['validate', '--source', 'a.db', '--run-id', 'r4']), /command/i);
  assert.throws(() => parseArgs(['inventory', '--source', 'a.db', '--run-id', 'r1', '--unexpected', 'value']), /Invalid migration CLI arguments/);
  assert.throws(() => parseArgs(['inventory', '--source', 'a.db', '--run-id', '../escape']), /run ID/);
  assert.throws(
    () => parseArgs(['inventory', '--source', 'a.db', '--source', 'b.db', '--run-id', 'r1']),
    /Invalid migration CLI arguments/,
  );
});

test('rejects an invalid run ID and writes reports through immutable ready publication', () => {
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
    const exported = JSON.parse(fs.readFileSync(path.join(outputRoot, 'inventory_run', 'export', 'source-snapshot.json'), 'utf8')) as {
      source: { sha256: string };
      tables: Record<TableName, { columns: string[]; recordsSha256: string; rowCount: number }>;
    };
    assert.equal(reads, 1);
    assert.equal(inventory.source.sha256, fixture.source.sha256);
    assert.equal(exported.source.sha256, fixture.source.sha256);
    assert.equal(Object.hasOwn(exported.source, 'path'), false);
    assert.match(exported.tables.Organization.recordsSha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('inventory and diff publish no sensitive fixture values or raw rows in any artifact', async () => {
  const outputRoot = temporaryOutputRoot();
  const fixtures = createSQLiteFixtures();
  try {
    await executeCommand(
      parseArgs(['inventory', '--source', fixtures.primaryPath, '--run-id', 'canary_inventory']),
      { outputRoot },
    );
    await executeCommand(
      parseArgs([
        'diff', '--primary', fixtures.primaryPath, '--secondary', fixtures.secondaryPath, '--run-id', 'canary_diff',
      ]),
      { outputRoot },
    );

    const files = emittedFiles(outputRoot);
    assert.equal(files.length, 14);
    const emitted = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
    for (const literal of Object.values(FIXTURE_LITERALS)) {
      assert.equal(emitted.includes(literal), false, `artifact exposed sensitive fixture literal: ${literal}`);
    }
    assert.doesNotMatch(emitted, /"records"\s*:/);
    assert.doesNotMatch(emitted, /"path"\s*:/);

    const report = JSON.parse(fs.readFileSync(path.join(outputRoot, 'canary_diff', 'diff-report.json'), 'utf8')) as {
      conflicts: Array<{ primaryIdHash?: string; secondaryIdHash?: string }>;
    };
    assert.ok(report.conflicts.length > 0);
    for (const conflict of report.conflicts) {
      for (const identifier of [conflict.primaryIdHash, conflict.secondaryIdHash].filter(Boolean)) {
        assert.match(identifier as string, /^[a-f0-9]{64}$/);
      }
    }
  } finally {
    fixtures.cleanup();
    fs.rmSync(outputRoot, { force: true, recursive: true });
  }
});

test('diff derives reports and exports from two injected stable snapshots', async () => {
  const outputRoot = temporaryOutputRoot();
  const snapshots = [emptySnapshot('a'.repeat(64)), emptySnapshot('b'.repeat(64))];
  let reads = 0;
  try {
    await executeCommand(
      parseArgs(['diff', '--primary', 'primary.sqlite', '--secondary', 'secondary.sqlite', '--run-id', 'diff_run']),
      {
        outputRoot,
        readSnapshot() {
          return snapshots[reads++];
        },
      },
    );
    const report = JSON.parse(fs.readFileSync(path.join(outputRoot, 'diff_run', 'diff-report.json'), 'utf8')) as DiffReport;
    assert.equal(reads, 2);
    assert.equal(report.sources.primary.sha256, snapshots[0].source.sha256);
    assert.equal(report.sources.secondary.sha256, snapshots[1].source.sha256);
    assert.equal(fs.existsSync(path.join(outputRoot, 'diff_run', 'export', 'primary-snapshot.json')), true);
    assert.equal(fs.existsSync(path.join(outputRoot, 'diff_run', 'export', 'secondary-snapshot.json')), true);
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

test('root migration wrapper uses npm prefix and forwards fixture flags', () => {
  const projectRoot = path.resolve('../..');
  const rootPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.equal(rootPackage.scripts['migration:inventory'], 'npm --prefix apps/server run migration:inventory --');

  const fixtures = createSQLiteFixtures();
  const runId = `root_flags_${process.pid}_${Date.now()}`;
  const runDirectory = path.join(projectRoot, 'var', 'migration', runId);
  try {
    const npmCli = process.env.npm_execpath;
    assert.ok(npmCli, 'npm_execpath must be available when the suite runs through npm');
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
