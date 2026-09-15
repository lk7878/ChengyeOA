import { isInventoryDecimal } from './inventory-decimal';
import { CollabField, Prisma } from '@prisma/client';

export class CollaborationError extends Error {
  constructor(
    readonly code: string,
    readonly status = 422,
    readonly errors?: unknown,
  ) {
    super(code);
  }
}
export function fail(message: string, status = 422, details?: unknown): never {
  throw new CollaborationError(message, status, details);
}
export type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('COLLAB_INVALID_OBJECT');
  return value as ObjectValue;
}
export function exact(value: unknown, keys: string[]): ObjectValue {
  const input = object(value);
  if (Object.keys(input).some((key) => !keys.includes(key))) fail('COLLAB_UNKNOWN_PROPERTY');
  return input;
}
export function text(value: unknown, max = 120): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    [...value].some((c) => c.charCodeAt(0) <= 8)
  )
    fail('COLLAB_INVALID_TEXT');
  return value.trim();
}
export function integer(value: unknown, min = 1, max = 2147483647): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    fail('COLLAB_INVALID_NUMBER');
  return Number(value);
}
export const FIELD_TYPES = [
  'TEXT',
  'LONG_TEXT',
  'NUMBER',
  'CURRENCY',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'USER',
  'ORGANIZATION',
  'PHONE',
  'URL',
  'FILE',
  'RELATION',
  'CREATED_BY',
  'CREATED_AT',
  'UPDATED_BY',
  'UPDATED_AT',
] as const;
export const VIEW_TYPES = ['GRID'] as const;
export function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail('COLLAB_INVALID_OPTION');
  return value as T;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') fail('COLLAB_INVALID_BOOLEAN');
  return value;
}
export function strings(value: unknown, max = 200): string[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((v) => typeof v !== 'string' || v.length > 120)
  )
    fail('COLLAB_INVALID_LIST');
  return [...new Set(value)] as string[];
}
export function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export function isSystemField(field: Pick<CollabField, 'type'>): boolean {
  return ['CREATED_BY', 'CREATED_AT', 'UPDATED_BY', 'UPDATED_AT'].includes(field.type);
}
export function validateValue(field: CollabField, value: unknown): unknown {
  if (value === null || value === undefined || value === '') {
    if (field.required) fail('COLLAB_REQUIRED_FIELD', 422, { fieldId: field.id });
    return null;
  }
  const options = object(field.options);
  switch (field.type) {
    case 'TEXT':
    case 'LONG_TEXT':
    case 'PHONE':
      return text(value, field.type === 'LONG_TEXT' ? 10000 : 500);
    case 'NUMBER':
      if (isInventoryDecimal(field)) {
        if (typeof value !== 'string' || !/^-?\d{1,15}(\.\d{1,3})?$/.test(value))
          fail('COLLAB_INVALID_NUMBER');
        return new Prisma.Decimal(value).toFixed(3);
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e15)
        fail('COLLAB_INVALID_NUMBER');
      return value;
    case 'CURRENCY':
      if (typeof value !== 'string' || !/^-?\d{1,16}(\.\d{1,2})?$/.test(value))
        fail('COLLAB_INVALID_CURRENCY');
      return new Prisma.Decimal(value).toFixed(2);
    case 'BOOLEAN':
      return boolean(value);
    case 'DATE':
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
      )
        fail('COLLAB_INVALID_DATE');
      return value;
    case 'DATETIME':
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        fail('COLLAB_INVALID_DATE');
      return new Date(value).toISOString();
    case 'URL': {
      const url = text(value, 2048);
      try {
        if (!['http:', 'https:'].includes(new URL(url).protocol)) fail('COLLAB_INVALID_URL');
      } catch {
        fail('COLLAB_INVALID_URL');
      }
      return url;
    }
    case 'SINGLE_SELECT': {
      const id = text(value);
      if (!optionIds(options).includes(id)) fail('COLLAB_INVALID_OPTION');
      return id;
    }
    case 'MULTI_SELECT': {
      const ids = strings(value);
      if (ids.some((id) => !optionIds(options).includes(id))) fail('COLLAB_INVALID_OPTION');
      return ids;
    }
    case 'USER':
    case 'ORGANIZATION':
      return text(value);
    case 'FILE':
    case 'RELATION':
      return strings(value, 100);
    default:
      fail('COLLAB_READONLY_FIELD', 403);
  }
}
export function optionIds(options: ObjectValue): string[] {
  if (!Array.isArray(options.choices)) return [];
  return options.choices.map((v) => text(object(v).id));
}
export function validateOptions(type: string, raw: unknown): ObjectValue {
  const options = exact(raw ?? {}, ['choices', 'targetTableId', 'helpText']);
  if (options.helpText !== undefined) text(options.helpText, 2000);
  if (['SINGLE_SELECT', 'MULTI_SELECT'].includes(type)) {
    if (!Array.isArray(options.choices) || options.choices.length > 100) fail('COLLAB_INVALID_OPTIONS');
    const ids = options.choices.map((v) => {
      const o = exact(v, ['id', 'name']);
      text(o.name);
      return text(o.id);
    });
    if (new Set(ids).size !== ids.length) fail('COLLAB_DUPLICATE_OPTION');
  }
  if (type === 'RELATION') text(options.targetTableId);
  return options;
}
export interface Filter {
  join?: 'and' | 'or';
  children?: Filter[];
  fieldId?: string;
  operator?: string;
  value?: unknown;
}
export interface ViewConfig {
  filter?: Filter;
  sorts?: Array<{ fieldId: string; direction: 'asc' | 'desc' }>;
  groupBy?: string[];
  visibleFields?: string[];
  widths?: Record<string, number>;
  frozen?: number;
  rowHeight?: number;
  dateFieldId?: string;
  endDateFieldId?: string;
  colorFieldId?: string;
}
export function fieldExpression(field: CollabField): Prisma.Sql {
  const system: Record<string, Prisma.Sql> = {
    CREATED_AT: Prisma.sql`r."createdAt"`,
    UPDATED_AT: Prisma.sql`r."updatedAt"`,
    CREATED_BY: Prisma.sql`r."createdBy"`,
    UPDATED_BY: Prisma.sql`r."updatedBy"`,
  };
  if (system[field.type]) return system[field.type];
  const value = Prisma.sql`r."values" ->> ${field.id}`;
  if (field.type === 'DATETIME') return Prisma.sql`(${value})::timestamptz`;
  if (field.type === 'DATE') return Prisma.sql`(${value})::date`;
  return ['NUMBER', 'CURRENCY'].includes(field.type) ? Prisma.sql`(${value})::numeric` : value;
}
/** Keep currency group keys exact across PostgreSQL JSON and JavaScript. */
export function groupExpression(field: CollabField): Prisma.Sql {
  const expression = fieldExpression(field);
  return field.type === 'CURRENCY' || isInventoryDecimal(field)
    ? Prisma.sql`trim_scale(${expression})::text`
    : expression;
}
export function fieldOf(fields: CollabField[], id: unknown): CollabField {
  const f = fields.find((f) => f.id === id && !f.archived);
  if (!f) fail('COLLAB_FIELD_UNAVAILABLE', 403);
  return f;
}
export function filterSql(
  raw: unknown,
  fields: CollabField[],
  userId: string,
  employeeId: string | null,
  depth = 0,
  budget = { remaining: 100 },
): Prisma.Sql {
  if (raw === undefined || raw === null) return Prisma.sql`TRUE`;
  if (depth > 5) fail('COLLAB_FILTER_TOO_DEEP');
  if (--budget.remaining < 0) fail('COLLAB_FILTER_TOO_LARGE');
  const f = exact(raw, ['join', 'children', 'fieldId', 'operator', 'value']);
  if (f.join !== undefined) {
    choice(f.join, ['and', 'or']);
    if (!Array.isArray(f.children) || f.children.length < 1 || f.children.length > 20)
      fail('COLLAB_INVALID_FILTER');
    return Prisma.sql`(${Prisma.join(
      f.children.map((c) => filterSql(c, fields, userId, employeeId, depth + 1, budget)),
      f.join === 'and' ? ' AND ' : ' OR ',
    )})`;
  }
  const field = fieldOf(fields, f.fieldId);
  if (field.type === 'RELATION' || field.type === 'FILE') fail('COLLAB_REFERENCE_FILTER_UNSUPPORTED');
  const expr = fieldExpression(field);
  const operator = choice(f.operator, [
    'eq',
    'ne',
    'contains',
    'gt',
    'gte',
    'lt',
    'lte',
    'empty',
    'notEmpty',
  ]);
  if (operator === 'empty') return Prisma.sql`(${expr} IS NULL OR (${expr})::text = '')`;
  if (operator === 'notEmpty') return Prisma.sql`(${expr} IS NOT NULL AND (${expr})::text <> '')`;
  const value = f.value === '$currentUser' ? (field.type === 'USER' ? employeeId : userId) : f.value;
  if (value === null) return Prisma.sql`FALSE`;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
    fail('COLLAB_INVALID_FILTER');
  if (String(value).length > 1000) fail('COLLAB_INVALID_FILTER');
  if (['NUMBER', 'CURRENCY'].includes(field.type) && !/^-?\d+(\.\d+)?$/.test(String(value)))
    fail('COLLAB_INVALID_FILTER');
  if (operator === 'contains') return Prisma.sql`strpos(lower((${expr})::text), lower(${String(value)})) > 0`;
  if (
    ['DATE', 'DATETIME', 'CREATED_AT', 'UPDATED_AT'].includes(field.type) &&
    !Number.isFinite(Date.parse(String(value)))
  )
    fail('COLLAB_INVALID_FILTER');
  // String equality can use the existing JSONB GIN index, preserving scalar semantics.
  if (
    operator === 'eq' &&
    ['TEXT', 'LONG_TEXT', 'PHONE', 'URL', 'SINGLE_SELECT', 'USER', 'ORGANIZATION'].includes(field.type)
  )
    return Prisma.sql`r."values" @> ${JSON.stringify({ [field.id]: String(value) })}::jsonb`;
  const comparison = ['NUMBER', 'CURRENCY'].includes(field.type)
    ? Prisma.sql`${String(value)}::numeric`
    : field.type === 'DATE'
      ? Prisma.sql`${String(value)}::date`
      : field.type === 'DATETIME'
        ? Prisma.sql`${String(value)}::timestamptz`
        : ['CREATED_AT', 'UPDATED_AT'].includes(field.type)
          ? Prisma.sql`${String(value)}::timestamp`
          : Prisma.sql`${String(value)}`;
  switch (operator) {
    case 'eq':
      return Prisma.sql`${expr} = ${comparison}`;
    case 'ne':
      return Prisma.sql`${expr} IS DISTINCT FROM ${comparison}`;
    case 'gt':
      return Prisma.sql`${expr} > ${comparison}`;
    case 'gte':
      return Prisma.sql`${expr} >= ${comparison}`;
    case 'lt':
      return Prisma.sql`${expr} < ${comparison}`;
    default:
      return Prisma.sql`${expr} <= ${comparison}`;
  }
}
export function validateView(raw: unknown, fields: CollabField[]): ViewConfig {
  const c = exact(raw, [
    'filter',
    'sorts',
    'groupBy',
    'visibleFields',
    'widths',
    'frozen',
    'rowHeight',
    'dateFieldId',
    'endDateFieldId',
    'colorFieldId',
  ]);
  filterSql(c.filter, fields, 'user', 'employee');
  for (const key of ['groupBy', 'visibleFields'])
    if (c[key] !== undefined)
      strings(c[key]).forEach((id) => {
        const field = fieldOf(fields, id);
        if (key === 'groupBy' && ['RELATION', 'FILE'].includes(field.type))
          fail('COLLAB_REFERENCE_FILTER_UNSUPPORTED');
      });
  if (c.sorts !== undefined) {
    if (!Array.isArray(c.sorts) || c.sorts.length > 5) fail('COLLAB_INVALID_SORT');
    c.sorts.forEach((s) => {
      const item = exact(s, ['fieldId', 'direction']);
      fieldOf(fields, item.fieldId);
      choice(item.direction, ['asc', 'desc']);
    });
  }
  if (c.widths !== undefined)
    for (const [id, width] of Object.entries(object(c.widths))) {
      fieldOf(fields, id);
      integer(width, 72, 1200);
    }
  if (c.frozen !== undefined) integer(c.frozen, 0, 5);
  if (c.rowHeight !== undefined) integer(c.rowHeight, 32, 120);
  for (const key of ['dateFieldId', 'endDateFieldId', 'colorFieldId']) if (c[key]) fieldOf(fields, c[key]);
  if (c.groupBy && (c.groupBy as string[]).length > 3) fail('COLLAB_TOO_MANY_GROUPS');
  return c as ViewConfig;
}
