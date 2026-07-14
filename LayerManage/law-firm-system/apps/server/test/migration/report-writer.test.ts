import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ARTIFACT_READY_SUFFIX,
  parseMigrationReport,
  readPublishedArtifact,
  writeMigrationReport,
  writeSnapshotExport,
} from '../../scripts/migration/report-writer';
import { TABLE_ORDER, type TableName } from '../../scripts/migration/table-plan';
import type { DiffReport, SourceInventory, SourceSnapshot, TableInventory, TableSnapshot } from '../../scripts/migration/types';

function outputRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-report-writer-'));
}

function swapDirectoryAtNextPublicationOpen(directory: string, outside: string): {
  displaced: string;
  restore(): void;
  wasTriggered(): boolean;
} {
  const displaced = `${directory}-checked`;
  const originalOpen = fs.openSync;
  let triggered = false;

  (fs as unknown as { openSync: (...args: unknown[]) => number }).openSync = (...args: unknown[]) => {
    const target = args[0];
    if (!triggered && typeof target === 'string') {
      triggered = true;
      fs.renameSync(directory, displaced);
      fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return (originalOpen as unknown as (...values: unknown[]) => number)(...args);
  };

  return {
    displaced,
    restore() {
      (fs as unknown as { openSync: typeof fs.openSync }).openSync = originalOpen;
    },
    wasTriggered() { return triggered; },
  };
}

function directoryText(directory: string): string {
  if (!fs.existsSync(directory)) return '';
  return fs.readdirSync(directory)
    .filter(name => fs.lstatSync(path.join(directory, name)).isFile())
    .map(name => fs.readFileSync(path.join(directory, name), 'utf8'))
    .join('\n');
}

function inventory(): SourceInventory {
  const tables = Object.fromEntries(TABLE_ORDER.map(table => [table, { columns: ['id'], rowCount: 0 }])) as Record<TableName, TableInventory>;
  return {
    generatedAt: '2026-07-13T00:00:00.000Z',
    runId: 'run_1',
    source: { sha256: 'a'.repeat(64) },
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
      primary: { sha256: 'a'.repeat(64) },
      secondary: { sha256: 'b'.repeat(64) },
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
      () => writeMigrationReport('run_4', 'source-manifest.json', {
        path: 'fixture.sqlite', sha256: 'a'.repeat(64), content: 'private free text',
      }, root),
      /Invalid source manifest report/,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('snapshot export publishes only file hash, schema, counts, and deterministic table hashes', () => {
  const root = outputRoot();
  try {
    const sensitive = snapshot();
    sensitive.source.path = 'SENSITIVE-SOURCE-PATH-CANARY';
    sensitive.tables.Organization = {
      columns: ['email', 'id', 'remark'],
      rowCount: 1,
      records: [{
        email: 'SENSITIVE-EMAIL-CANARY@example.test',
        id: 'SENSITIVE-RAW-ID-CANARY',
        remark: 'SENSITIVE-FREE-TEXT-CANARY',
      }],
    };

    const exported = writeSnapshotExport('redacted_snapshot', 'source-snapshot.json', sensitive, root);
    const contents = fs.readFileSync(exported, 'utf8');
    assert.equal(contents.includes('SENSITIVE-'), false);
    assert.doesNotMatch(contents, /"records"\s*:/);
    assert.doesNotMatch(contents, /"path"\s*:/);
    const published = JSON.parse(contents) as {
      source: { sha256: string };
      tables: Record<TableName, { columns: string[]; recordsSha256: string; rowCount: number }>;
    };
    assert.deepEqual(published.tables.Organization.columns, ['email', 'id', 'remark']);
    assert.equal(published.tables.Organization.rowCount, 1);
    assert.match(published.tables.Organization.recordsSha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('accepts only source, inventory, and diff report kinds', () => {
  assert.throws(
    () => parseMigrationReport('import-report.json' as never, {}),
    /Unknown migration report/,
  );
  assert.throws(
    () => parseMigrationReport('validation-report.json' as never, {}),
    /Unknown migration report/,
  );
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
    assert.equal(fs.existsSync(`${first}${ARTIFACT_READY_SUFFIX}`), true);
    assert.throws(() => writeMigrationReport('run_1', 'inventory.json', inventory(), root), /already exists/);
    assert.equal(fs.readFileSync(first, 'utf8'), before);

    const exported = writeSnapshotExport('run_1', 'source-snapshot.json', snapshot(), root);
    const exportBefore = fs.readFileSync(exported, 'utf8');
    assert.equal(fs.existsSync(`${exported}${ARTIFACT_READY_SUFFIX}`), true);
    assert.throws(() => writeSnapshotExport('run_1', 'source-snapshot.json', snapshot(), root), /already exists/);
    assert.equal(fs.readFileSync(exported, 'utf8'), exportBefore);
    assert.equal(fs.readdirSync(path.dirname(first)).some(name => name.includes('.tmp-')), false);
    assert.equal(fs.readdirSync(path.dirname(exported)).some(name => name.includes('.tmp-')), false);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('accepts only hash-bound ready artifacts and rejects missing or tampered readiness', () => {
  const root = outputRoot();
  try {
    const destination = writeMigrationReport('ready_run', 'inventory.json', {
      ...inventory(),
      runId: 'ready_run',
    }, root);
    const readyPath = `${destination}${ARTIFACT_READY_SUFFIX}`;
    assert.equal(fs.existsSync(readyPath), true);
    assert.deepEqual(JSON.parse(readPublishedArtifact(destination).toString('utf8')), {
      ...inventory(),
      runId: 'ready_run',
    });

    fs.rmSync(readyPath);
    assert.throws(() => readPublishedArtifact(destination), /not ready/);
    fs.writeFileSync(readyPath, '{"kind":"migration-artifact-ready","sha256":"' + '0'.repeat(64) + '","token":"' + 'a'.repeat(64) + '","version":1}\n');
    assert.throws(() => readPublishedArtifact(destination), /not ready/);
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

test('rejects a symlink or junction in an output-root ancestor when supported', t => {
  const container = outputRoot();
  const outside = outputRoot();
  const linkedAncestor = path.join(container, 'linked-ancestor');
  const nestedOutputRoot = path.join(linkedAncestor, 'migration-output');

  try {
    try {
      fs.symlinkSync(outside, linkedAncestor, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`directory links unavailable: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}`);
      return;
    }

    assert.throws(() => writeMigrationReport('run_1', 'inventory.json', inventory(), nestedOutputRoot), /output path/);
    assert.equal(fs.existsSync(path.join(outside, 'migration-output', 'run_1', 'inventory.json')), false);
  } finally {
    if (fs.existsSync(linkedAncestor) && fs.lstatSync(linkedAncestor).isSymbolicLink()) fs.unlinkSync(linkedAncestor);
    fs.rmSync(container, { force: true, recursive: true });
    fs.rmSync(outside, { force: true, recursive: true });
  }
});

test('does not publish report content through a run-directory junction swapped immediately before open', t => {
  const root = outputRoot();
  const outside = outputRoot();
  const runPath = path.join(root, 'race_report');
  fs.mkdirSync(runPath);
  let swap: ReturnType<typeof swapDirectoryAtNextPublicationOpen> | undefined;
  try {
    try {
      swap = swapDirectoryAtNextPublicationOpen(runPath, outside);
    } catch (error) {
      t.skip(`directory links unavailable: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}`);
      return;
    }

    let caught: unknown;
    try {
      writeMigrationReport('race_report', 'inventory.json', {
        ...inventory(),
        runId: 'race_report',
      }, root);
    } catch (error) {
      caught = error;
    }
    assert.equal(swap.wasTriggered(), true);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.match(String(caught), /output path|publication/i);
  } finally {
    swap?.restore();
    if (fs.existsSync(runPath) && fs.lstatSync(runPath).isSymbolicLink()) fs.unlinkSync(runPath);
    fs.rmSync(root, { force: true, recursive: true });
    fs.rmSync(outside, { force: true, recursive: true });
  }
});

test('does not publish snapshot payload through an export-directory junction swap', t => {
  const root = outputRoot();
  const outside = outputRoot();
  const exportPath = path.join(root, 'race_export', 'export');
  fs.mkdirSync(exportPath, { recursive: true });
  let swap: ReturnType<typeof swapDirectoryAtNextPublicationOpen> | undefined;
  try {
    try {
      swap = swapDirectoryAtNextPublicationOpen(exportPath, outside);
    } catch (error) {
      t.skip(`directory links unavailable: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}`);
      return;
    }

    const sensitiveSnapshot = snapshot();
    sensitiveSnapshot.source.path = 'SENSITIVE-EXPORT-PATH-LITERAL';
    sensitiveSnapshot.tables.Organization = {
      columns: ['id', 'remark'],
      rowCount: 1,
      records: [{ id: 'SENSITIVE-EXPORT-ID-LITERAL', remark: 'SENSITIVE-EXPORT-ROW-LITERAL' }],
    };
    let caught: unknown;
    try {
      writeSnapshotExport('race_export', 'source-snapshot.json', sensitiveSnapshot, root);
    } catch (error) {
      caught = error;
    }
    assert.equal(swap.wasTriggered(), true);
    assert.equal(directoryText(outside).includes('SENSITIVE-EXPORT-PATH-LITERAL'), false);
    assert.equal(directoryText(outside).includes('SENSITIVE-EXPORT-ROW-LITERAL'), false);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.match(String(caught), /output path|publication/i);
  } finally {
    swap?.restore();
    if (fs.existsSync(exportPath) && fs.lstatSync(exportPath).isSymbolicLink()) fs.unlinkSync(exportPath);
    fs.rmSync(root, { force: true, recursive: true });
    fs.rmSync(outside, { force: true, recursive: true });
  }
});
