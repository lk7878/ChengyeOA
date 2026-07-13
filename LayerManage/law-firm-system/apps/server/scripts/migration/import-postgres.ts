import type { PoolClient, QueryResultRow } from 'pg';
import { TABLE_ORDER, type TableName } from './table-plan';
import type { SnapshotRecord, SourceSnapshot } from './types';
import { getTableSchema, ImportInputError, normalizeRow } from './normalize';

export interface ImportFailureDetail {
  code: string;
  id: string;
  table: TableName;
}

export interface ImportReport {
  failed: number;
  failures: ImportFailureDetail[];
  inserted: number;
  skipped: number;
  updated: number;
}

export class ImportFailure extends Error {
  constructor(public readonly report: ImportReport) {
    super('PostgreSQL import failed');
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function failureCode(error: unknown): string {
  if (error instanceof ImportInputError) return error.code;
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'IMPORT_FAILED';
}

function recordId(row: SnapshotRecord): string {
  return typeof row.id === 'string' && row.id.length > 0 ? row.id : 'unknown';
}

function normalizeStoredDateTime(value: unknown): unknown {
  if (!(value instanceof Date)) return value;

  return new Date(Date.UTC(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    value.getHours(),
    value.getMinutes(),
    value.getSeconds(),
    value.getMilliseconds(),
  )).toISOString();
}

function sameRow(left: Record<string, unknown>, right: QueryResultRow, columns: readonly string[], table: TableName): boolean {
  const schema = getTableSchema(table);
  const existing = normalizeRow(table, Object.fromEntries(
    Object.entries(right).map(([column, value]) => [
      column,
      schema.fieldTypes.get(column) === 'DateTime' ? normalizeStoredDateTime(value) : value,
    ]),
  ));
  return columns.every(column => left[column] === existing[column]);
}

async function importRow(client: PoolClient, table: TableName, sourceRow: SnapshotRecord, report: ImportReport): Promise<void> {
  const schema = getTableSchema(table);
  const normalized = normalizeRow(table, sourceRow);
  const columns = schema.columns.filter(column => Object.hasOwn(normalized, column));

  if (typeof normalized.id !== 'string' || normalized.id.length === 0) {
    throw new ImportInputError('INVALID_VALUE', `Missing id in ${table}`);
  }

  const quotedTable = quoteIdentifier(schema.tableName);
  const quotedColumns = columns.map(quoteIdentifier);
  const existingResult = await client.query(
    `SELECT ${quotedColumns.join(', ')} FROM ${quotedTable} WHERE "id" = $1`,
    [normalized.id],
  );

  if (existingResult.rowCount === 1 && sameRow(normalized, existingResult.rows[0], columns, table)) {
    report.skipped += 1;
    return;
  }

  const values = columns.map(column => normalized[column]);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const updateColumns = columns.filter(column => column !== 'id');
  const assignments = (updateColumns.length > 0 ? updateColumns : ['id'])
    .map(column => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`);

  await client.query(
    `INSERT INTO ${quotedTable} (${quotedColumns.join(', ')}) VALUES (${placeholders.join(', ')}) `
      + `ON CONFLICT ("id") DO UPDATE SET ${assignments.join(', ')}`,
    values,
  );

  if (existingResult.rowCount === 0) {
    report.inserted += 1;
  } else {
    report.updated += 1;
  }
}

export async function importSnapshot(client: PoolClient, snapshot: SourceSnapshot): Promise<ImportReport> {
  const report: ImportReport = { inserted: 0, updated: 0, skipped: 0, failed: 0, failures: [] };
  let currentTable: TableName = TABLE_ORDER[0];
  let currentRow: SnapshotRecord = {};

  await client.query('BEGIN');

  try {
    for (const table of TABLE_ORDER) {
      currentTable = table;
      for (const row of snapshot.tables[table].records) {
        currentRow = row;
        await importRow(client, table, row, report);
      }
    }

    await client.query('COMMIT');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    report.failed += 1;
    report.failures.push({ table: currentTable, id: recordId(currentRow), code: failureCode(error) });
    throw new ImportFailure(report);
  }
}
