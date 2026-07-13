import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { BUSINESS_KEYS, TABLE_ORDER, type TableName } from './table-plan';
import { getTableSchema, normalizeRow } from './normalize';
import type { SourceSnapshot } from './types';

export interface ValidationQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface ValidationCheck {
  actual: number | string[];
  check: 'row-count' | 'primary-ids' | 'foreign-key' | 'foreign-key-values' | 'business-key' | 'decimal-total' | 'timestamp-sample' | 'password-hash';
  expected: number | string[];
  field?: string;
  status: 'PASS' | 'FAIL';
  table?: TableName;
}

export interface ValidationReport {
  checks: ValidationCheck[];
  generatedAt: string;
  ok: boolean;
  source: { sha256: string };
}

export class MigrationValidationError extends Error {
  constructor() {
    super('Migration validation query failed');
  }
}

export interface RelationRule {
  child: TableName;
  fields: readonly string[];
  parent: TableName;
  references: readonly string[];
}

function dmmfTableName(name: string): TableName {
  if (!TABLE_ORDER.includes(name as TableName)) throw new Error('Unexpected Prisma relation model');
  return name as TableName;
}

export const RELATION_RULES: readonly RelationRule[] = Prisma.dmmf.datamodel.models
  .flatMap(model => model.fields
    .filter(field => field.kind === 'object' && (field.relationFromFields?.length ?? 0) > 0)
    .map(field => ({
      child: dmmfTableName(model.name),
      fields: [...(field.relationFromFields ?? [])],
      parent: dmmfTableName(field.type),
      references: [...(field.relationToFields ?? [])],
    })))
  .sort((left, right) => TABLE_ORDER.indexOf(left.child) - TABLE_ORDER.indexOf(right.child)
    || left.fields.join(',').localeCompare(right.fields.join(',')));

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tableName(table: TableName): string {
  return quoteIdentifier(getTableSchema(table).tableName);
}

function scalarFields(table: TableName, type: string): string[] {
  return [...getTableSchema(table).fieldTypes.entries()]
    .filter(([, fieldType]) => fieldType === type)
    .map(([field]) => field);
}

async function query<T extends Record<string, unknown>>(client: ValidationQueryable, text: string, values?: readonly unknown[]): Promise<T[]> {
  try {
    return (await client.query<T>(text, values)).rows;
  } catch {
    throw new MigrationValidationError();
  }
}

function sourceIds(snapshot: SourceSnapshot, table: TableName): string[] {
  return snapshot.tables[table].records
    .map(record => typeof record.id === 'string' ? record.id : '')
    .filter(Boolean)
    .sort(compareIds);
}

function reportCheck(
  checks: ValidationCheck[],
  check: ValidationCheck['check'],
  expected: ValidationCheck['expected'],
  actual: ValidationCheck['actual'],
  table?: TableName,
  field?: string,
): void {
  checks.push({ check, expected, actual, status: JSON.stringify(expected) === JSON.stringify(actual) ? 'PASS' : 'FAIL', table, field });
}

async function validateCountsAndIds(client: ValidationQueryable, snapshot: SourceSnapshot, checks: ValidationCheck[]): Promise<void> {
  for (const table of TABLE_ORDER) {
    const rows = await query<{ id: string }>(client, `/* validation:ids:${table} */ SELECT "id" FROM ${tableName(table)} ORDER BY "id"`);
    const actualIds = rows.map(row => String(row.id)).sort(compareIds);
    const expectedIds = sourceIds(snapshot, table);
    reportCheck(checks, 'row-count', expectedIds.length, actualIds.length, table);
    reportCheck(checks, 'primary-ids', expectedIds, actualIds, table);
  }
}

async function validateForeignKeys(client: ValidationQueryable, snapshot: SourceSnapshot, checks: ValidationCheck[]): Promise<void> {
  for (const rule of RELATION_RULES) {
    const fieldLabel = rule.fields.join(',');
    const sourceRecords = snapshot.tables[rule.child].records
      .filter(record => typeof record.id === 'string')
      .sort((left, right) => compareIds(String(left.id), String(right.id)));
    const expectedIds = sourceRecords.map(record => String(record.id));
    const targetRows = expectedIds.length === 0
      ? []
      : await query<Record<string, unknown>>(client,
        `/* validation:foreign-key-values:${rule.child}:${fieldLabel} */ SELECT "id", ${rule.fields.map(quoteIdentifier).join(', ')} `
          + `FROM ${tableName(rule.child)} WHERE "id" = ANY($1::text[])`,
        [expectedIds],
      );
    const targetById = new Map(targetRows.map(row => [String(row.id), row]));
    const matchingIds = sourceRecords
      .filter(record => {
        const target = targetById.get(String(record.id));
        return target !== undefined && rule.fields.every(field => Object.hasOwn(record, field) && record[field] === target[field]);
      })
      .map(record => String(record.id));
    reportCheck(checks, 'foreign-key-values', expectedIds, matchingIds, rule.child, fieldLabel);

    const join = rule.fields.map((field, index) => `child.${quoteIdentifier(field)} = parent.${quoteIdentifier(rule.references[index])}`).join(' AND ');
    const present = rule.fields.map(field => `child.${quoteIdentifier(field)} IS NOT NULL`).join(' OR ');
    const rows = await query<{ id: string }>(client,
      `/* validation:foreign-key:${rule.child}:${fieldLabel} */ SELECT child."id" FROM ${tableName(rule.child)} AS child `
        + `LEFT JOIN ${tableName(rule.parent)} AS parent ON ${join} `
        + `WHERE (${present}) AND parent.${quoteIdentifier(rule.references[0])} IS NULL`,
    );
    reportCheck(checks, 'foreign-key', 0, rows.length, rule.child, fieldLabel);
  }
}

async function validateBusinessKeys(client: ValidationQueryable, checks: ValidationCheck[]): Promise<void> {
  for (const table of TABLE_ORDER) {
    for (const field of BUSINESS_KEYS[table] ?? []) {
      const rows = await query<{ duplicateCount: number }>(client,
        `/* validation:business-key:${table}:${field} */ SELECT COUNT(*)::int AS "duplicateCount" FROM ${tableName(table)} `
          + `WHERE ${quoteIdentifier(field)} IS NOT NULL GROUP BY ${quoteIdentifier(field)} HAVING COUNT(*) > 1`,
      );
      reportCheck(checks, 'business-key', 0, rows.length, table, field);
    }
  }
}

function decimalTotal(snapshot: SourceSnapshot, table: TableName, field: string): Decimal {
  return snapshot.tables[table].records.reduce((total, record) => {
    const value = record[field];
    if (value === null || value === undefined) return total;
    if (typeof value !== 'string' && typeof value !== 'number') throw new MigrationValidationError();
    return total.plus(new Decimal(value));
  }, new Decimal(0));
}

async function validateDecimalTotals(client: ValidationQueryable, snapshot: SourceSnapshot, checks: ValidationCheck[]): Promise<void> {
  for (const table of TABLE_ORDER) {
    for (const field of scalarFields(table, 'Decimal')) {
      const expected = decimalTotal(snapshot, table, field);
      const rows = await query<{ total: string }>(client,
        `/* validation:decimal-total:${table}:${field} */ SELECT COALESCE(SUM(${quoteIdentifier(field)}), 0)::text AS "total" FROM ${tableName(table)}`,
      );
      const actual = new Decimal(rows[0]?.total ?? '0');
      reportCheck(checks, 'decimal-total', 1, expected.equals(actual) ? 1 : 0, table, field);
    }
  }
}

function normalizedTimestamp(value: unknown, table: TableName, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(normalizeRow(table, { [field]: value })[field]);
}

async function validateTimestampSamples(client: ValidationQueryable, snapshot: SourceSnapshot, checks: ValidationCheck[]): Promise<void> {
  for (const table of TABLE_ORDER) {
    for (const field of scalarFields(table, 'DateTime')) {
      const expected = snapshot.tables[table].records
        .map(record => ({ id: typeof record.id === 'string' ? record.id : '', value: normalizedTimestamp(record[field], table, field) }))
        .filter((sample): sample is { id: string; value: string } => Boolean(sample.id && sample.value))
        .sort((left, right) => compareIds(left.id, right.id))
        .slice(0, 25);
      if (expected.length === 0) continue;

      const rows = await query<{ id: string; value: unknown }>(client,
        `/* validation:timestamp:${table}:${field} */ SELECT "id", ${quoteIdentifier(field)} AS "value" FROM ${tableName(table)} WHERE "id" = ANY($1::text[])`,
        [expected.map(sample => sample.id)],
      );
      const actual = new Map(rows.map(row => [String(row.id), normalizedTimestamp(row.value, table, field)]));
      const matches = expected.filter(sample => actual.get(sample.id) === sample.value).length;
      reportCheck(checks, 'timestamp-sample', expected.length, matches, table, field);
    }
  }
}

async function validatePasswords(client: ValidationQueryable, snapshot: SourceSnapshot, checks: ValidationCheck[]): Promise<void> {
  const expected = snapshot.tables.User.records
    .filter(record => typeof record.id === 'string' && typeof record.password === 'string')
    .map(record => ({ id: record.id as string, password: record.password as string }))
    .sort((left, right) => compareIds(left.id, right.id));
  if (expected.length === 0) return;

  const rows = await query<{ id: string; password: string }>(client,
    `/* validation:password:User */ SELECT "id", "password" FROM ${tableName('User')} WHERE "id" = ANY($1::text[])`,
    [expected.map(record => record.id)],
  );
  const actual = new Map(rows.map(row => [String(row.id), row.password]));
  const matches = expected.filter(record => actual.get(record.id) === record.password).length;
  reportCheck(checks, 'password-hash', expected.length, matches, 'User', 'password');
}

export async function validateMigration(client: ValidationQueryable, snapshot: SourceSnapshot): Promise<ValidationReport> {
  const checks: ValidationCheck[] = [];
  await validateCountsAndIds(client, snapshot, checks);
  await validateForeignKeys(client, snapshot, checks);
  await validateBusinessKeys(client, checks);
  await validateDecimalTotals(client, snapshot, checks);
  await validateTimestampSamples(client, snapshot, checks);
  await validatePasswords(client, snapshot, checks);

  return {
    checks,
    generatedAt: new Date().toISOString(),
    ok: checks.every(check => check.status === 'PASS'),
    source: { sha256: snapshot.source.sha256 },
  };
}
