import type { TableName } from './table-plan';

export type ConflictKind =
  | 'PRIMARY_ONLY'
  | 'SECONDARY_ONLY'
  | 'CONTENT_MISMATCH'
  | 'BUSINESS_KEY_COLLISION';

export type SnapshotValue = boolean | null | number | string;
export type SnapshotRecord = Record<string, SnapshotValue>;

export interface SourceManifest {
  path: string;
  sha256: string;
}

export interface TableInventory {
  columns: string[];
  rowCount: number;
}

export interface SourceInventory {
  generatedAt: string;
  runId: string;
  source: SourceManifest;
  tables: Record<TableName, TableInventory>;
}

export interface TableSnapshot extends TableInventory {
  records: SnapshotRecord[];
}

export interface SourceSnapshot {
  generatedAt: string;
  runId: string;
  source: SourceManifest;
  tables: Record<TableName, TableSnapshot>;
}

export interface RecordConflict {
  changedFields: string[];
  kind: ConflictKind;
  primaryId?: string;
  secondaryId?: string;
  table: TableName;
}

export interface DiffReport {
  conflicts: RecordConflict[];
  counts: Record<ConflictKind, number>;
  generatedAt: string;
  runId: string;
  sources: {
    primary: SourceManifest;
    secondary: SourceManifest;
  };
  tableCounts: Record<TableName, { primary: number; secondary: number }>;
}
