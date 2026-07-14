import type { TableName } from './table-plan';

export type ConflictKind =
  | 'PRIMARY_ONLY'
  | 'SECONDARY_ONLY'
  | 'CONTENT_MISMATCH'
  | 'BUSINESS_KEY_COLLISION';

export type SnapshotValue = boolean | null | number | string;
export type SnapshotRecord = Record<string, SnapshotValue>;

export interface SourceFileHash {
  sha256: string;
}

export interface SourceManifest extends SourceFileHash {
  path: string;
}

export interface TableInventory {
  columns: string[];
  rowCount: number;
}

export interface SourceInventory {
  generatedAt: string;
  runId: string;
  source: SourceFileHash;
  tables: Record<TableName, TableInventory>;
}

export interface TableSnapshot extends TableInventory {
  records: SnapshotRecord[];
}

/** Full-fidelity migration data. Keep in memory only; never publish or export records. */
export interface SourceSnapshot {
  generatedAt: string;
  runId: string;
  source: SourceManifest;
  tables: Record<TableName, TableSnapshot>;
}

export interface TableSnapshotExport extends TableInventory {
  recordsSha256: string;
}

export interface SnapshotExport {
  generatedAt: string;
  runId: string;
  source: SourceFileHash;
  tables: Record<TableName, TableSnapshotExport>;
}

export interface RecordConflict {
  changedFields: string[];
  kind: ConflictKind;
  primaryIdHash?: string;
  secondaryIdHash?: string;
  table: TableName;
}

export interface DiffReport {
  conflicts: RecordConflict[];
  counts: Record<ConflictKind, number>;
  generatedAt: string;
  runId: string;
  sources: {
    primary: SourceFileHash;
    secondary: SourceFileHash;
  };
  tableCounts: Record<TableName, { primary: number; secondary: number }>;
}
