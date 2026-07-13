import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseMigrationReport, writeMigrationReport, writeSnapshotExport } from '../../scripts/migration/report-writer';
import { TABLE_ORDER, type TableName } from '../../scripts/migration/table-plan';
import type { DiffReport, SourceInventory, SourceSnapshot, TableInventory, TableSnapshot } from '../../scripts/migration/types';

function outputRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-report-writer-'));
}

function inventory(): SourceInventory {
  const tables = Object.fromEntries(TABLE_ORDER.map(table => [table, { columns: ['id'], rowCount: 0 }])) as Record<TableName, TableInventory>;
  return {
    generatedAt: '2026-07-13T00:00:00.000Z',
    runId: 'run_1',
    source: { path: 'fixture.sqlite', sha256: 'a'.repeat(64) },
    tables,
  };
}

function snapshot(): SourceSnapshot {
  const tables = Object.fromEntries(TABLE_ORDER.map(table => [table, { columns: ['id'], rowCount: 0, records: [] }])) as Record<TableName, TableSnapshot>;
  return {
    generatedAt: '2026-07-13T00:00:00.000Z',
    runId: 'run_1',
    source: { path: 'fixture.sqlite', sha256: 'a'.repeat(64) },
    tables,
  };
}

function diffReport(): DiffReport {
  const tableCounts = Object.fromEntries(TABLE_ORDER.map(table => [table, { primary: 0, secondary: 0 }])) as DiffReport['tableCounts'];
  return {
    conflicts: [],
    counts: { PRIMARY_ONLY: 0, SECONDARY_ONLY: 0, CONTENT_MISMATCH: 0, BUSINESS_KEY_COLLISION: 0 },
    generatedAt: '2026-07-13T00:00:00.000Z',
    runId: 'diff_run',
    sources: {
      primary: { path: 'primary.sqlite', sha256: 'a'.repeat(64) },
      secondary: { path: 'secondary.sqlite', sha256: 'b'.repeat(64) },
    },
    tableCounts,
  };
}

test('strict report schemas reject unknown sensitive keys and invalid nested value shapes', () => {
  const root = outputRoot();
  try {
    const validInventory = inventory();
    assert.throws(
      () => writeMigrationReport('run_1', 'inventory.json', { ...validInventory, payload: { password: 'literal-leak' } }, root),
      /Invalid inventory report/,
    );
    assert.throws(
      () => writeMigrationReport('run_2', 'inventory.json', {
        ...validInventory,
        tables: { ...validInventory.tables, Organization: { columns: ['id'], rowCount: 'private-content' } },
      }, root),
      /Invalid inventory report/,
    );
    assert.throws(
      () => writeMigrationReport('run_3', 'import-report.json', {
        inserted: 0, updated: 0, skipped: 0, failed: 0, failures: [], phone: '13800138000',
      }, root),
      /Invalid import report/,
    );
    assert.throws(
      () => writeMigrationReport('run_4', 'source-manifest.json', {
        path: 'fixture.sqlite', sha256: 'a'.repeat(64), content: 'private free text',
      }, root),
      /Invalid source manifest report/,
    );
    assert.throws(
      () => writeMigrationReport('run_5', 'validation-report.json', {
        checks: [], generatedAt: '2026-07-13T00:00:00.000Z', ok: true,
        source: { sha256: 'a'.repeat(64) }, rows: [{ email: 'private@example.test' }],
      }, root),
      /Invalid validation report/,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('parses a strict diff report and rejects unknown or malformed confirmed content', () => {
  const valid = diffReport();
  assert.deepEqual(parseMigrationReport('diff-report.json', valid), valid);
  assert.throws(() => parseMigrationReport('diff-report.json', { ...valid, rows: [] }), /Invalid diff report/);
  assert.throws(
    () => parseMigrationReport('diff-report.json', { ...valid, sources: { ...valid.sources, primary: { ...valid.sources.primary, sha256: 'not-sha' } } }),
    /Invalid diff report/,
  );
});

test('refuses to overwrite existing reports and exports with a stable safe error', () => {
  const root = outputRoot();
  try {
    const first = writeMigrationReport('run_1', 'inventory.json', inventory(), root);
    const before = fs.readFileSync(first, 'utf8');
    assert.throws(() => writeMigrationReport('run_1', 'inventory.json', inventory(), root), /already exists/);
    assert.equal(fs.readFileSync(first, 'utf8'), before);

    const exported = writeSnapshotExport('run_1', 'source-snapshot.json', snapshot(), root);
    const exportBefore = fs.readFileSync(exported, 'utf8');
    assert.throws(() => writeSnapshotExport('run_1', 'source-snapshot.json', snapshot(), root), /already exists/);
    assert.equal(fs.readFileSync(exported, 'utf8'), exportBefore);
    assert.equal(fs.readdirSync(path.dirname(first)).some(name => name.includes('.tmp-')), false);
    assert.equal(fs.readdirSync(path.dirname(exported)).some(name => name.includes('.tmp-')), false);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('rejects run-directory symlink or junction traversal when supported', t => {
  const root = outputRoot();
  const outside = outputRoot();
  try {
    const runPath = path.join(root, 'run_1');
    try {
      fs.symlinkSync(outside, runPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`directory links unavailable: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}`);
      return;
    }

    assert.throws(() => writeMigrationReport('run_1', 'inventory.json', inventory(), root), /output path/);
    assert.equal(fs.existsSync(path.join(outside, 'inventory.json')), false);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
    fs.rmSync(outside, { force: true, recursive: true });
  }
});

test('rejects export-directory symlink or junction traversal when supported', t => {
  const root = outputRoot();
  const outside = outputRoot();
  try {
    const runPath = path.join(root, 'run_1');
    fs.mkdirSync(runPath);
    try {
      fs.symlinkSync(outside, path.join(runPath, 'export'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`directory links unavailable: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}`);
      return;
    }

    assert.throws(() => writeSnapshotExport('run_1', 'source-snapshot.json', snapshot(), root), /output path/);
    assert.equal(fs.existsSync(path.join(outside, 'source-snapshot.json')), false);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
    fs.rmSync(outside, { force: true, recursive: true });
  }
});
