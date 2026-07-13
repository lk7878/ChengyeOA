import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SourceSnapshot } from './types';

const RUN_ID = /^[a-zA-Z0-9_-]+$/;
const REPORT_FILES = new Set(['source-manifest.json', 'inventory.json', 'diff-report.json', 'import-report.json', 'validation-report.json']);
const EXPORT_FILE = /^[a-zA-Z0-9_.-]+\.json$/;

export const MIGRATION_OUTPUT_ROOT = path.resolve(__dirname, '../../../var/migration');

function assertRunId(runId: string): void {
  if (!RUN_ID.test(runId)) throw new Error('Invalid migration run ID');
}

export function assertMigrationRunId(runId: string): void {
  assertRunId(runId);
}

function assertNoRecords(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(assertNoRecords);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'records') throw new Error('Report payload must not contain records');
    assertNoRecords(nested);
  }
}

function runDirectory(runId: string, outputRoot: string): string {
  assertRunId(runId);
  return path.join(outputRoot, runId);
}

function writeAtomically(destination: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function migrationRunDirectory(runId: string, outputRoot = MIGRATION_OUTPUT_ROOT): string {
  return runDirectory(runId, outputRoot);
}

export function writeMigrationReport(runId: string, fileName: string, payload: unknown, outputRoot = MIGRATION_OUTPUT_ROOT): string {
  if (!REPORT_FILES.has(fileName)) throw new Error('Unsupported migration report file');
  assertNoRecords(payload);
  const destination = path.join(runDirectory(runId, outputRoot), fileName);
  writeAtomically(destination, payload);
  return destination;
}

export function writeSnapshotExport(runId: string, fileName: string, snapshot: SourceSnapshot, outputRoot = MIGRATION_OUTPUT_ROOT): string {
  if (!EXPORT_FILE.test(fileName)) throw new Error('Invalid migration export file');
  const destination = path.join(runDirectory(runId, outputRoot), 'export', fileName);
  writeAtomically(destination, snapshot);
  return destination;
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
