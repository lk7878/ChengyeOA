import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { TABLE_ORDER, type TableName } from './table-plan';

interface TableSchema {
  columns: readonly string[];
  fieldTypes: ReadonlyMap<string, string>;
  tableName: string;
}

const JSON_STRING_FIELDS = new Set([
  'Lead.tags',
  'Customer.tags',
  'Contract.paymentTerms',
  'Case.teamIds',
  'Performance.kpiData',
]);

const LEGACY_NAIVE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?$/;
const OFFSET_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

export class ImportInputError extends Error {
  constructor(
    public readonly code: 'INVALID_IDENTIFIER' | 'INVALID_VALUE',
    message: string,
  ) {
    super(message);
  }
}

const TABLE_SCHEMAS = new Map<string, TableSchema>(
  TABLE_ORDER.map(table => {
    const model = Prisma.dmmf.datamodel.models.find(candidate => candidate.name === table);

    if (!model) {
      throw new Error(`Missing Prisma model for ${table}`);
    }

    const fields = model.fields.filter(field => field.kind === 'scalar');
    return [table, {
      columns: fields.map(field => field.name),
      fieldTypes: new Map(fields.map(field => [field.name, field.type])),
      tableName: model.dbName ?? model.name,
    }];
  }),
);

function normalizeDecimal(value: unknown, table: string, column: string): string {
  try {
    const decimal = new Decimal(value as string | number);
    if (!decimal.isFinite()) throw new Error('non-finite');
    return decimal.toFixed(2);
  } catch {
    throw new ImportInputError('INVALID_VALUE', `Invalid decimal in ${table}.${column}`);
  }
}

function hasValidDateTimeComponents(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  const millisecond = Number((match[7] ?? '').padEnd(3, '0'));

  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const roundTrip = new Date(0);
  roundTrip.setUTCFullYear(year, month - 1, day);
  roundTrip.setUTCHours(hour, minute, second, millisecond);
  return roundTrip.getUTCFullYear() === year
    && roundTrip.getUTCMonth() === month - 1
    && roundTrip.getUTCDate() === day
    && roundTrip.getUTCHours() === hour
    && roundTrip.getUTCMinutes() === minute
    && roundTrip.getUTCSeconds() === second
    && roundTrip.getUTCMilliseconds() === millisecond;
}

function hasValidOffset(match: RegExpMatchArray): boolean {
  const offset = match[8];
  if (!offset || offset === 'Z') return true;
  const offsetHour = Number(offset.slice(1, 3));
  const offsetMinute = Number(offset.slice(4, 6));
  return offsetHour <= 23 && offsetMinute <= 59;
}

function normalizeDateTime(value: unknown, table: string, column: string): string {
  let source: Date;

  if (value instanceof Date) {
    source = value;
  } else if (typeof value === 'string') {
    const naiveMatch = value.match(LEGACY_NAIVE_TIMESTAMP);
    const offsetMatch = value.match(OFFSET_TIMESTAMP);
    if (naiveMatch && hasValidDateTimeComponents(naiveMatch)) {
      source = new Date(`${value.replace(' ', 'T')}+08:00`);
    } else if (offsetMatch && hasValidDateTimeComponents(offsetMatch) && hasValidOffset(offsetMatch)) {
      source = new Date(value);
    } else {
      source = new Date(Number.NaN);
    }
  } else {
    source = new Date(Number.NaN);
  }

  if (Number.isNaN(source.getTime())) {
    throw new ImportInputError('INVALID_VALUE', `Invalid timestamp in ${table}.${column}`);
  }

  return source.toISOString();
}

function normalizeJsonString(value: unknown, table: string, column: string): string {
  if (typeof value !== 'string') {
    throw new ImportInputError('INVALID_VALUE', `invalid JSON in ${table}.${column}`);
  }

  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    throw new ImportInputError('INVALID_VALUE', `invalid JSON in ${table}.${column}`);
  }
}

export function getTableSchema(table: string): TableSchema {
  const schema = TABLE_SCHEMAS.get(table);
  if (!schema) throw new ImportInputError('INVALID_IDENTIFIER', 'Unsupported table identifier');
  return schema;
}

export function normalizeRow(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const schema = getTableSchema(table);
  const normalized: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(row)) {
    const fieldType = schema.fieldTypes.get(column);
    if (!fieldType) {
      throw new ImportInputError('INVALID_IDENTIFIER', `Unsupported column in ${table}`);
    }

    if (value === null) {
      normalized[column] = null;
    } else if (fieldType === 'Decimal') {
      normalized[column] = normalizeDecimal(value, table, column);
    } else if (fieldType === 'DateTime') {
      normalized[column] = normalizeDateTime(value, table, column);
    } else if (JSON_STRING_FIELDS.has(`${table}.${column}`)) {
      normalized[column] = normalizeJsonString(value, table, column);
    } else {
      normalized[column] = value;
    }
  }

  return normalized;
}
