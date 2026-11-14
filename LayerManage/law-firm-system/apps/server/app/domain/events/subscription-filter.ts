import { allowedSubscriptionFields } from './event-registry';
import { SubscriptionFilter } from './event-types';

type FilterValue = string | number | boolean;

export function parseSubscriptionFilter(
  eventType: string,
  eventVersion: number,
  input: unknown,
): SubscriptionFilter {
  const allowedFields = allowedSubscriptionFields(eventType, eventVersion);
  const root = requireObject(input, 'Subscription filter');
  assertExactKeys(root, [ 'all' ], 'Subscription filter');
  if (!Array.isArray(root.all) || root.all.length > 10) {
    throw new TypeError('Subscription filter all must contain at most 10 clauses');
  }

  return {
    all: root.all.map((clause, index) => parseClause(clause, index, allowedFields)),
  };
}

export function matchesSubscriptionFilter(filter: SubscriptionFilter | null | undefined, payload: unknown): boolean {
  if (filter === null || filter === undefined) return true;
  const record = requireObject(payload, 'Event payload');
  return filter.all.every(clause => {
    const value = record[clause.field];
    return clause.values.some(expected => Object.is(expected, value));
  });
}

function parseClause(
  input: unknown,
  index: number,
  allowedFields: ReadonlySet<string>,
): SubscriptionFilter['all'][number] {
  const clause = requireObject(input, `Subscription filter clause ${index + 1}`);
  assertExactKeys(clause, [ 'field', 'operator', 'values' ], `Subscription filter clause ${index + 1}`);
  if (typeof clause.field !== 'string' || clause.field.length === 0 || clause.field.length > 100 || !allowedFields.has(clause.field)) {
    throw new TypeError(`Subscription filter clause ${index + 1} field is not allowed`);
  }
  if (clause.operator !== 'EQ' && clause.operator !== 'IN') {
    throw new TypeError(`Subscription filter clause ${index + 1} operator is invalid`);
  }
  if (!Array.isArray(clause.values) || clause.values.length === 0 || clause.values.length > 20) {
    throw new TypeError(`Subscription filter clause ${index + 1} values must contain 1 to 20 items`);
  }
  if (clause.operator === 'EQ' && clause.values.length !== 1) {
    throw new TypeError(`Subscription filter clause ${index + 1} EQ requires exactly one value`);
  }

  return {
    field: clause.field,
    operator: clause.operator,
    values: clause.values.map((value, valueIndex) => parseValue(value, index, valueIndex)),
  };
}

function parseValue(value: unknown, clauseIndex: number, valueIndex: number): FilterValue {
  if (typeof value === 'string') {
    if (value.length > 100) throw new TypeError(`Subscription filter clause ${clauseIndex + 1} value ${valueIndex + 1} is too long`);
    return value;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new TypeError(`Subscription filter clause ${clauseIndex + 1} value ${valueIndex + 1} is not a JSON scalar`);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [ ...expected ].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}
