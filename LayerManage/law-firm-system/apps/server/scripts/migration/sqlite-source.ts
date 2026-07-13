import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { compareUnicodeCodePoints } from './ordering';
import { TABLE_ORDER, type TableName } from './table-plan';
import type {
  SnapshotRecord,
  SnapshotValue,
  SourceInventory,
  SourceManifest,
  SourceSnapshot,
  TableInventory,
  TableSnapshot,
} from './types';

interface TableInfoRow {
  name: string;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sourceManifest(sourcePath: string): SourceManifest {
  return {
    path: sourcePath,
    sha256: createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'),
  };
}

function openReadOnly(sourcePath: string): Database.Database {
  return new Database(sourcePath, { fileMustExist: true, readonly: true });
}

function normalizeValue(value: unknown): SnapshotValue {
  if (Buffer.isBuffer(value)) {
    return value.toString('hex');
  }

  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || value === null) {
    return value as SnapshotValue;
  }

  throw new TypeError(`Unsupported SQLite value type: ${typeof value}`);
}

function canonicalizeRow(row: Record<string, unknown>): SnapshotRecord {
  return Object.keys(row)
    .sort(compareUnicodeCodePoints)
    .reduce<SnapshotRecord>((canonical, field) => {
      // Snapshot rows feed the importer, so source scalar values stay intact.
      canonical[field] = normalizeValue(row[field]);
      return canonical;
    }, {});
}

function compareRecords(left: SnapshotRecord, right: SnapshotRecord): number {
  return compareUnicodeCodePoints(String(left.id ?? ''), String(right.id ?? ''))
    || compareUnicodeCodePoints(JSON.stringify(left), JSON.stringify(right));
}

function tableColumns(database: Database.Database, table: TableName): string[] {
  return (database
    .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all() as TableInfoRow[])
    .map(column => column.name)
    .sort(compareUnicodeCodePoints);
}

function readTableInventory(database: Database.Database, table: TableName): TableInventory {
  const columns = tableColumns(database, table);
  const rowCount = columns.length === 0
    ? 0
    : (database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as { count: number }).count;

  return { columns, rowCount };
}

function readTableSnapshot(database: Database.Database, table: TableName): TableSnapshot {
  const inventory = readTableInventory(database, table);
  const records = inventory.columns.length === 0
    ? []
    : (database.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Record<string, unknown>[])
      .map(canonicalizeRow)
      .sort(compareRecords);

  return { ...inventory, records };
}

function readSource<T>(sourcePath: string, readTable: (database: Database.Database, table: TableName) => T): Record<TableName, T> {
  const database = openReadOnly(sourcePath);

  try {
    return TABLE_ORDER.reduce<Record<TableName, T>>((tables, table) => {
      tables[table] = readTable(database, table);
      return tables;
    }, {} as Record<TableName, T>);
  } finally {
    database.close();
  }
}

export function inventorySqlite(sourcePath: string): SourceInventory {
  return {
    generatedAt: new Date().toISOString(),
    runId: randomUUID(),
    source: sourceManifest(sourcePath),
    tables: readSource(sourcePath, readTableInventory),
  };
}

export function snapshotSqlite(sourcePath: string): SourceSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    runId: randomUUID(),
    source: sourceManifest(sourcePath),
    tables: readSource(sourcePath, readTableSnapshot),
  };
}
