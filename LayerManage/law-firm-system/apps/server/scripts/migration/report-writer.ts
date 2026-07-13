import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ImportReport } from './import-postgres';
import { TABLE_ORDER, type TableName } from './table-plan';
import type {
  ConflictKind,
  DiffReport,
  SourceInventory,
  SourceManifest,
  SourceSnapshot,
} from './types';
import type { ValidationReport } from './validate';

const RUN_ID = /^[a-zA-Z0-9_-]+$/;
const SHA256 = /^[a-fA-F0-9]{64}$/;
const EXPORT_FILE = /^[a-zA-Z0-9_.-]+\.json$/;
const IMPORT_CODE = /^(?:[A-Z][A-Z0-9_]*|\d{5})$/;
const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9]*(?:,[a-zA-Z][a-zA-Z0-9]*)*$/;
const CONFLICT_KINDS: readonly ConflictKind[] = [
  'PRIMARY_ONLY', 'SECONDARY_ONLY', 'CONTENT_MISMATCH', 'BUSINESS_KEY_COLLISION',
] as const;
const VALIDATION_CHECKS = new Set([
  'row-count', 'primary-ids', 'foreign-key', 'foreign-key-values', 'business-key',
  'decimal-total', 'timestamp-sample', 'password-hash',
]);

export const IMPORT_REPORT_PENDING_FILE = '.import-report.pending.json';
const IMPORT_REPORT_RESERVATION_KIND = 'migration-import-report-reservation';

export interface ImportReportReservation {
  readonly outputRoot: string;
  readonly runId: string;
  readonly token: string;
}

export type ReportFileName =
  | 'source-manifest.json'
  | 'inventory.json'
  | 'diff-report.json'
  | 'import-report.json'
  | 'validation-report.json';

export type DirectReportFileName = Exclude<ReportFileName, 'import-report.json'>;

export interface SourceManifestPair {
  primary: SourceManifest;
  secondary: SourceManifest;
}

export interface ReportPayloadMap {
  'source-manifest.json': SourceManifest | SourceManifestPair;
  'inventory.json': SourceInventory;
  'diff-report.json': DiffReport;
  'import-report.json': ImportReport;
  'validation-report.json': ValidationReport;
}

export const MIGRATION_OUTPUT_ROOT = path.resolve(__dirname, '../../../../var/migration');

function invalid(label: string): never {
  throw new Error(`Invalid ${label} report`);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid(label);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))) invalid(label);
}

function stringValue(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || (pattern && !pattern.test(value))) invalid(label);
  return value as string;
}

function countValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) invalid(label);
  return value as string[];
}

function tableName(value: unknown, label: string): TableName {
  if (typeof value !== 'string' || !TABLE_ORDER.includes(value as TableName)) invalid(label);
  return value as TableName;
}

function sourceManifest(value: unknown, label: string): SourceManifest {
  const source = objectValue(value, label);
  exactKeys(source, ['path', 'sha256'], [], label);
  stringValue(source.path, label);
  stringValue(source.sha256, label, SHA256);
  return source as unknown as SourceManifest;
}

function sourceManifestReport(value: unknown): SourceManifest | SourceManifestPair {
  const label = 'source manifest';
  const report = objectValue(value, label);
  if (Object.hasOwn(report, 'path')) return sourceManifest(report, label);
  exactKeys(report, ['primary', 'secondary'], [], label);
  sourceManifest(report.primary, label);
  sourceManifest(report.secondary, label);
  return report as unknown as SourceManifestPair;
}

function inventoryReport(value: unknown): SourceInventory {
  const label = 'inventory';
  const report = objectValue(value, label);
  exactKeys(report, ['generatedAt', 'runId', 'source', 'tables'], [], label);
  stringValue(report.generatedAt, label);
  stringValue(report.runId, label, RUN_ID);
  sourceManifest(report.source, label);
  const tables = objectValue(report.tables, label);
  exactKeys(tables, TABLE_ORDER, [], label);
  for (const table of TABLE_ORDER) {
    const entry = objectValue(tables[table], label);
    exactKeys(entry, ['columns', 'rowCount'], [], label);
    stringArray(entry.columns, label);
    countValue(entry.rowCount, label);
  }
  return report as unknown as SourceInventory;
}

function diffReport(value: unknown): DiffReport {
  const label = 'diff';
  const report = objectValue(value, label);
  exactKeys(report, ['conflicts', 'counts', 'generatedAt', 'runId', 'sources', 'tableCounts'], [], label);
  stringValue(report.generatedAt, label);
  stringValue(report.runId, label, RUN_ID);

  const sources = objectValue(report.sources, label);
  exactKeys(sources, ['primary', 'secondary'], [], label);
  sourceManifest(sources.primary, label);
  sourceManifest(sources.secondary, label);

  const counts = objectValue(report.counts, label);
  exactKeys(counts, CONFLICT_KINDS, [], label);
  CONFLICT_KINDS.forEach(kind => countValue(counts[kind], label));

  const tableCounts = objectValue(report.tableCounts, label);
  exactKeys(tableCounts, TABLE_ORDER, [], label);
  for (const table of TABLE_ORDER) {
    const entry = objectValue(tableCounts[table], label);
    exactKeys(entry, ['primary', 'secondary'], [], label);
    countValue(entry.primary, label);
    countValue(entry.secondary, label);
  }

  if (!Array.isArray(report.conflicts)) invalid(label);
  for (const candidate of report.conflicts) {
    const conflict = objectValue(candidate, label);
    exactKeys(conflict, ['changedFields', 'kind', 'table'], ['primaryId', 'secondaryId'], label);
    stringArray(conflict.changedFields, label);
    if (typeof conflict.kind !== 'string' || !CONFLICT_KINDS.includes(conflict.kind as ConflictKind)) invalid(label);
    tableName(conflict.table, label);
    if (conflict.primaryId !== undefined) stringValue(conflict.primaryId, label);
    if (conflict.secondaryId !== undefined) stringValue(conflict.secondaryId, label);
  }
  return report as unknown as DiffReport;
}

function importReport(value: unknown): ImportReport {
  const label = 'import';
  const report = objectValue(value, label);
  exactKeys(report, ['failed', 'failures', 'inserted', 'skipped', 'updated'], [], label);
  countValue(report.failed, label);
  countValue(report.inserted, label);
  countValue(report.skipped, label);
  countValue(report.updated, label);
  if (!Array.isArray(report.failures)) invalid(label);
  for (const candidate of report.failures) {
    const failure = objectValue(candidate, label);
    exactKeys(failure, ['code', 'id', 'table'], ['reason'], label);
    stringValue(failure.code, label, IMPORT_CODE);
    stringValue(failure.id, label);
    tableName(failure.table, label);
    if (failure.reason !== undefined && failure.reason !== 'missing-id' && failure.reason !== 'duplicate-id') invalid(label);
  }
  return report as unknown as ImportReport;
}

function validationValue(value: unknown, label: string): number | string[] {
  if (typeof value === 'number') return countValue(value, label);
  return stringArray(value, label);
}

function validationReport(value: unknown): ValidationReport {
  const label = 'validation';
  const report = objectValue(value, label);
  exactKeys(report, ['checks', 'generatedAt', 'ok', 'source'], [], label);
  stringValue(report.generatedAt, label);
  if (typeof report.ok !== 'boolean' || !Array.isArray(report.checks)) invalid(label);
  const source = objectValue(report.source, label);
  exactKeys(source, ['sha256'], [], label);
  stringValue(source.sha256, label, SHA256);
  for (const candidate of report.checks) {
    const check = objectValue(candidate, label);
    exactKeys(check, ['actual', 'check', 'expected', 'status'], ['field', 'table'], label);
    if (typeof check.check !== 'string' || !VALIDATION_CHECKS.has(check.check)) invalid(label);
    if (check.status !== 'PASS' && check.status !== 'FAIL') invalid(label);
    validationValue(check.expected, label);
    validationValue(check.actual, label);
    if (check.field !== undefined) stringValue(check.field, label, IDENTIFIER);
    if (check.table !== undefined) tableName(check.table, label);
  }
  return report as unknown as ValidationReport;
}

export function parseMigrationReport<K extends ReportFileName>(fileName: K, payload: unknown): ReportPayloadMap[K] {
  if (fileName === 'source-manifest.json') return sourceManifestReport(payload) as ReportPayloadMap[K];
  if (fileName === 'inventory.json') return inventoryReport(payload) as ReportPayloadMap[K];
  if (fileName === 'diff-report.json') return diffReport(payload) as ReportPayloadMap[K];
  if (fileName === 'import-report.json') return importReport(payload) as ReportPayloadMap[K];
  return validationReport(payload) as ReportPayloadMap[K];
}

export function assertMigrationRunId(runId: string): void {
  if (!RUN_ID.test(runId)) throw new Error('Invalid migration run ID');
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertOrdinaryDirectory(directory: string): void {
  const status = fs.lstatSync(directory);
  if (status.isSymbolicLink() || !status.isDirectory()) throw new Error('Invalid migration output path');
  if (comparablePath(fs.realpathSync.native(directory)) !== comparablePath(directory)) {
    throw new Error('Invalid migration output path');
  }
}

function createSecureDirectory(directory: string): string {
  const resolved = path.resolve(directory);
  const volumeRoot = path.parse(resolved).root;
  assertOrdinaryDirectory(volumeRoot);
  let current = volumeRoot;

  for (const segment of path.relative(volumeRoot, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      try {
        fs.mkdirSync(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    assertOrdinaryDirectory(current);
  }

  return resolved;
}

function secureDirectory(outputRoot: string, segments: readonly string[]): string {
  const root = createSecureDirectory(outputRoot);
  let current = root;

  for (const segment of segments) {
    const candidate = path.join(current, segment);
    createSecureDirectory(candidate);
    const real = fs.realpathSync.native(candidate);
    if (!contained(root, real)) throw new Error('Invalid migration output path');
    current = real;
  }
  return current;
}

function runDirectory(runId: string, outputRoot: string): string {
  assertMigrationRunId(runId);
  return secureDirectory(outputRoot, [runId]);
}

function syncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes(code ?? '')) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeExclusiveFsynced(destination: string, contents: string): void {
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = fs.openSync(destination, 'wx', 0o600);
    created = true;
    fs.writeFileSync(descriptor, contents, { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
      descriptor = undefined;
    }
    if (created) fs.rmSync(destination, { force: true });
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function syncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, 'r+');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeAtomically(destination: string, payload: unknown): void {
  if (fs.existsSync(destination)) throw new Error('Migration artifact already exists');
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    writeExclusiveFsynced(temporary, `${JSON.stringify(payload, null, 2)}\n`);
    try {
      fs.linkSync(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Migration artifact already exists');
      throw error;
    }
    syncFile(destination);
    syncDirectory(path.dirname(destination));
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function reservationPaths(reservation: ImportReportReservation): { destination: string; directory: string; pending: string } {
  const directory = runDirectory(reservation.runId, reservation.outputRoot);
  return {
    destination: path.join(directory, 'import-report.json'),
    directory,
    pending: path.join(directory, IMPORT_REPORT_PENDING_FILE),
  };
}

function assertReservation(reservation: ImportReportReservation): ReturnType<typeof reservationPaths> {
  const paths = reservationPaths(reservation);
  try {
    const marker = objectValue(JSON.parse(fs.readFileSync(paths.pending, 'utf8')), 'import report reservation');
    exactKeys(marker, ['kind', 'token', 'version'], [], 'import report reservation');
    if (marker.kind !== IMPORT_REPORT_RESERVATION_KIND || marker.version !== 1 || marker.token !== reservation.token) {
      invalid('import report reservation');
    }
  } catch {
    throw new Error('Invalid import report reservation');
  }
  return paths;
}

export function reserveImportReport(runId: string, outputRoot = MIGRATION_OUTPUT_ROOT): ImportReportReservation {
  const reservation: ImportReportReservation = {
    outputRoot,
    runId,
    token: randomBytes(32).toString('hex'),
  };
  const paths = reservationPaths(reservation);
  if (fs.existsSync(paths.destination)) throw new Error('Migration artifact already exists');

  try {
    writeExclusiveFsynced(paths.pending, `${JSON.stringify({
      kind: IMPORT_REPORT_RESERVATION_KIND,
      token: reservation.token,
      version: 1,
    })}\n`);
    syncDirectory(paths.directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Migration artifact already exists');
    throw error;
  }

  if (fs.existsSync(paths.destination)) {
    fs.rmSync(paths.pending, { force: true });
    syncDirectory(paths.directory);
    throw new Error('Migration artifact already exists');
  }
  return reservation;
}

export function abortImportReportReservation(reservation: ImportReportReservation): void {
  const paths = assertReservation(reservation);
  fs.rmSync(paths.pending);
  syncDirectory(paths.directory);
}

export function publishReservedImportReport(reservation: ImportReportReservation, report: ImportReport): string {
  const paths = assertReservation(reservation);
  const validated = parseMigrationReport('import-report.json', report);
  writeAtomically(paths.destination, validated);
  fs.rmSync(paths.pending);
  syncDirectory(paths.directory);
  return paths.destination;
}

export function migrationRunDirectory(runId: string, outputRoot = MIGRATION_OUTPUT_ROOT): string {
  return runDirectory(runId, outputRoot);
}

export function writeMigrationReport<K extends DirectReportFileName>(
  runId: string,
  fileName: K,
  payload: ReportPayloadMap[K],
  outputRoot?: string,
): string;
export function writeMigrationReport(
  runId: string,
  fileName: ReportFileName,
  payload: ReportPayloadMap[ReportFileName],
  outputRoot = MIGRATION_OUTPUT_ROOT,
): string {
  if (fileName === 'import-report.json') throw new Error('Import report reservation required');
  const validated = parseMigrationReport(fileName, payload);
  const destination = path.join(runDirectory(runId, outputRoot), fileName);
  writeAtomically(destination, validated);
  return destination;
}

export function writeSnapshotExport(runId: string, fileName: string, snapshot: SourceSnapshot, outputRoot = MIGRATION_OUTPUT_ROOT): string {
  if (!EXPORT_FILE.test(fileName)) throw new Error('Invalid migration export file');
  const directory = secureDirectory(outputRoot, [runId, 'export']);
  const destination = path.join(directory, fileName);
  writeAtomically(destination, snapshot);
  return destination;
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
