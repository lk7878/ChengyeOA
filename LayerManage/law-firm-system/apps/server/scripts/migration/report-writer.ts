import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { compareUnicodeCodePoints } from './ordering';
import { TABLE_ORDER, type TableName } from './table-plan';
import type {
  ConflictKind,
  DiffReport,
  SnapshotExport,
  SnapshotRecord,
  SourceFileHash,
  SourceInventory,
  SourceSnapshot,
} from './types';

const RUN_ID = /^[a-zA-Z0-9_-]+$/;
const SHA256 = /^[a-fA-F0-9]{64}$/;
const EXPORT_FILE = /^[a-zA-Z0-9_.-]+\.json$/;
const CONFLICT_KINDS: readonly ConflictKind[] = [
  'PRIMARY_ONLY', 'SECONDARY_ONLY', 'CONTENT_MISMATCH', 'BUSINESS_KEY_COLLISION',
] as const;

export const ARTIFACT_READY_SUFFIX = '.ready.json';
const ARTIFACT_READY_KIND = 'migration-artifact-ready';

interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

interface DirectoryAnchor {
  directory: string;
  identity: FileIdentity;
  root: string;
}

interface OpenedArtifact {
  descriptor: number;
  identity: FileIdentity;
  path: string;
}

export type ReportFileName =
  | 'source-manifest.json'
  | 'inventory.json'
  | 'diff-report.json';

export interface SourceHashPair {
  primary: SourceFileHash;
  secondary: SourceFileHash;
}

export interface ReportPayloadMap {
  'source-manifest.json': SourceFileHash | SourceHashPair;
  'inventory.json': SourceInventory;
  'diff-report.json': DiffReport;
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

function sourceFileHash(value: unknown, label: string): SourceFileHash {
  const source = objectValue(value, label);
  exactKeys(source, ['sha256'], [], label);
  stringValue(source.sha256, label, SHA256);
  return source as unknown as SourceFileHash;
}

function sourceManifestReport(value: unknown): SourceFileHash | SourceHashPair {
  const label = 'source manifest';
  const report = objectValue(value, label);
  if (Object.hasOwn(report, 'sha256')) return sourceFileHash(report, label);
  exactKeys(report, ['primary', 'secondary'], [], label);
  sourceFileHash(report.primary, label);
  sourceFileHash(report.secondary, label);
  return report as unknown as SourceHashPair;
}

function inventoryReport(value: unknown): SourceInventory {
  const label = 'inventory';
  const report = objectValue(value, label);
  exactKeys(report, ['generatedAt', 'runId', 'source', 'tables'], [], label);
  stringValue(report.generatedAt, label);
  stringValue(report.runId, label, RUN_ID);
  sourceFileHash(report.source, label);
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
  sourceFileHash(sources.primary, label);
  sourceFileHash(sources.secondary, label);

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
    exactKeys(conflict, ['changedFields', 'kind', 'table'], ['primaryIdHash', 'secondaryIdHash'], label);
    stringArray(conflict.changedFields, label);
    if (typeof conflict.kind !== 'string' || !CONFLICT_KINDS.includes(conflict.kind as ConflictKind)) invalid(label);
    tableName(conflict.table, label);
    if (conflict.primaryIdHash !== undefined) stringValue(conflict.primaryIdHash, label, SHA256);
    if (conflict.secondaryIdHash !== undefined) stringValue(conflict.secondaryIdHash, label, SHA256);
  }
  return report as unknown as DiffReport;
}

export function parseMigrationReport<K extends ReportFileName>(fileName: K, payload: unknown): ReportPayloadMap[K] {
  if (fileName === 'source-manifest.json') return sourceManifestReport(payload) as ReportPayloadMap[K];
  if (fileName === 'inventory.json') return inventoryReport(payload) as ReportPayloadMap[K];
  if (fileName === 'diff-report.json') return diffReport(payload) as ReportPayloadMap[K];
  throw new Error('Unknown migration report');
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

function identity(status: fs.BigIntStats): FileIdentity {
  return { dev: status.dev, ino: status.ino };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function pathIdentity(filePath: string): FileIdentity {
  return identity(fs.lstatSync(filePath, { bigint: true }));
}

function directoryAnchor(outputRoot: string, segments: readonly string[]): DirectoryAnchor {
  const directory = secureDirectory(outputRoot, segments);
  const root = fs.realpathSync.native(path.resolve(outputRoot));
  return { directory, identity: pathIdentity(directory), root };
}

function assertAnchor(anchor: DirectoryAnchor): void {
  assertOrdinaryDirectory(anchor.directory);
  if (!sameIdentity(anchor.identity, pathIdentity(anchor.directory))) throw new Error('Invalid migration publication path');
  const real = fs.realpathSync.native(anchor.directory);
  if (!contained(anchor.root, real) || comparablePath(real) !== comparablePath(anchor.directory)) {
    throw new Error('Invalid migration publication path');
  }
}

function assertOpenedArtifact(anchor: DirectoryAnchor, artifact: OpenedArtifact): void {
  assertAnchor(anchor);
  const descriptorStatus = fs.fstatSync(artifact.descriptor, { bigint: true });
  const pathStatus = fs.lstatSync(artifact.path, { bigint: true });
  if (pathStatus.isSymbolicLink() || !pathStatus.isFile()) throw new Error('Invalid migration publication path');
  if (!sameIdentity(identity(descriptorStatus), identity(pathStatus))) throw new Error('Invalid migration publication path');
  if (!sameIdentity(artifact.identity, identity(descriptorStatus))) throw new Error('Invalid migration publication path');
  const real = fs.realpathSync.native(artifact.path);
  if (!contained(anchor.root, real) || comparablePath(path.dirname(real)) !== comparablePath(anchor.directory)) {
    throw new Error('Invalid migration publication path');
  }
}

function removeIfSamePath(artifact: OpenedArtifact): void {
  try {
    const status = fs.lstatSync(artifact.path, { bigint: true });
    if (!status.isSymbolicLink() && status.isFile() && sameIdentity(artifact.identity, identity(status))) {
      fs.rmSync(artifact.path, { force: true });
    }
  } catch {
    // A moved directory can make an empty or partial inode unreachable by path; readiness remains absent.
  }
}

function openAnchoredExclusive(anchor: DirectoryAnchor, fileName: string): OpenedArtifact {
  const destination = path.join(anchor.directory, fileName);
  const noFollow = (fs.constants as unknown as Record<string, number>).O_NOFOLLOW ?? 0;
  let descriptor: number | undefined;
  let openedIdentity: FileIdentity | undefined;
  try {
    descriptor = fs.openSync(
      destination,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow,
      0o600,
    );
    openedIdentity = identity(fs.fstatSync(descriptor, { bigint: true }));
    const artifact = { descriptor, identity: openedIdentity, path: destination };
    assertOpenedArtifact(anchor, artifact);
    return artifact;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (openedIdentity) removeIfSamePath({ descriptor: -1, identity: openedIdentity, path: destination });
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Migration artifact already exists', { cause: error });
    throw new Error('Invalid migration publication path', { cause: error });
  }
}

function closeArtifact(artifact: OpenedArtifact | undefined): void {
  if (artifact) fs.closeSync(artifact.descriptor);
}

function writeDescriptor(artifact: OpenedArtifact, contents: string): void {
  fs.writeFileSync(artifact.descriptor, contents, { encoding: 'utf8' });
  fs.fsyncSync(artifact.descriptor);
}

function publicationFailure(error: unknown): Error {
  if (error instanceof Error && /^(Migration artifact already exists|Invalid migration publication path)$/.test(error.message)) {
    return error;
  }
  return new Error('Invalid migration publication path');
}

// Windows Node has no openat and exposes no O_NOFOLLOW. Empty exclusive final/readiness
// inodes are identity-checked before descriptor writes, and readiness rejects crash partials.
function publishAnchored(anchor: DirectoryAnchor, fileName: string, payload: unknown): string {
  const contents = `${JSON.stringify(payload, null, 2)}\n`;
  const digest = createHash('sha256').update(contents).digest('hex');
  const token = randomBytes(32).toString('hex');
  const readyContents = `${JSON.stringify({ kind: ARTIFACT_READY_KIND, sha256: digest, token, version: 1 })}\n`;
  let destination: OpenedArtifact | undefined;
  let readiness: OpenedArtifact | undefined;
  let complete = false;

  try {
    destination = openAnchoredExclusive(anchor, fileName);
    readiness = openAnchoredExclusive(anchor, `${fileName}${ARTIFACT_READY_SUFFIX}`);
    assertOpenedArtifact(anchor, destination);
    assertOpenedArtifact(anchor, readiness);
    writeDescriptor(destination, contents);
    writeDescriptor(readiness, readyContents);
    assertOpenedArtifact(anchor, destination);
    assertOpenedArtifact(anchor, readiness);
    syncDirectory(anchor.directory);
    complete = true;
    return destination.path;
  } catch (error) {
    throw publicationFailure(error);
  } finally {
    closeArtifact(readiness);
    closeArtifact(destination);
    if (!complete) {
      if (readiness) removeIfSamePath(readiness);
      if (destination) removeIfSamePath(destination);
    }
  }
}

function notReady(): never {
  throw new Error('Migration artifact is not ready');
}

export function readPublishedArtifact(destination: string): Buffer {
  try {
    const readyPath = `${destination}${ARTIFACT_READY_SUFFIX}`;
    const firstReady = fs.readFileSync(readyPath);
    const marker = objectValue(JSON.parse(firstReady.toString('utf8')), 'artifact readiness');
    exactKeys(marker, ['kind', 'sha256', 'token', 'version'], [], 'artifact readiness');
    if (marker.kind !== ARTIFACT_READY_KIND || marker.version !== 1) notReady();
    const expected = stringValue(marker.sha256, 'artifact readiness', SHA256).toLowerCase();
    stringValue(marker.token, 'artifact readiness', SHA256);
    const contents = fs.readFileSync(destination);
    const secondReady = fs.readFileSync(readyPath);
    if (!firstReady.equals(secondReady)) notReady();
    const actual = createHash('sha256').update(contents).digest('hex');
    if (actual !== expected) notReady();
    return contents;
  } catch {
    return notReady();
  }
}

export function migrationRunDirectory(runId: string, outputRoot = MIGRATION_OUTPUT_ROOT): string {
  return runDirectory(runId, outputRoot);
}

export function writeMigrationReport<K extends ReportFileName>(
  runId: string,
  fileName: K,
  payload: ReportPayloadMap[K],
  outputRoot = MIGRATION_OUTPUT_ROOT,
): string {
  const validated = parseMigrationReport(fileName, payload);
  assertMigrationRunId(runId);
  return publishAnchored(directoryAnchor(outputRoot, [runId]), fileName, validated);
}

function canonicalRecord(record: SnapshotRecord): string {
  const canonical = Object.keys(record)
    .sort(compareUnicodeCodePoints)
    .reduce<SnapshotRecord>((result, field) => {
      result[field] = record[field];
      return result;
    }, {});
  return JSON.stringify(canonical);
}

function snapshotExport(runId: string, snapshot: SourceSnapshot): SnapshotExport {
  const tables = TABLE_ORDER.reduce<SnapshotExport['tables']>((result, table) => {
    const sourceTable = snapshot.tables[table];
    const canonicalRecords = sourceTable.records.map(canonicalRecord).sort(compareUnicodeCodePoints);
    result[table] = {
      columns: [...sourceTable.columns].sort(compareUnicodeCodePoints),
      recordsSha256: createHash('sha256').update(JSON.stringify(canonicalRecords)).digest('hex'),
      rowCount: sourceTable.rowCount,
    };
    return result;
  }, {} as SnapshotExport['tables']);

  return {
    generatedAt: snapshot.generatedAt,
    runId,
    source: { sha256: snapshot.source.sha256 },
    tables,
  };
}

export function writeSnapshotExport(runId: string, fileName: string, snapshot: SourceSnapshot, outputRoot = MIGRATION_OUTPUT_ROOT): string {
  if (!EXPORT_FILE.test(fileName)) throw new Error('Invalid migration export file');
  assertMigrationRunId(runId);
  return publishAnchored(directoryAnchor(outputRoot, [runId, 'export']), fileName, snapshotExport(runId, snapshot));
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
