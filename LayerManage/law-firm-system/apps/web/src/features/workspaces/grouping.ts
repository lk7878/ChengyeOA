import { currencyKey } from './money';
import type { Field, QueryResult, RecordRow } from './types';

export type GridRow = RecordRow & {
  group?: { key: string; keys: unknown[]; count?: number; loaded: number };
};
function normalize(value: unknown, field: Field): unknown {
  if (value === undefined || value === null) return null;
  if (field.type === 'BOOLEAN') return String(value);
  if (field.type === 'CURRENCY') return currencyKey(value);
  if (field.type === 'NUMBER') return Number(value);
  if (['DATETIME', 'CREATED_AT', 'UPDATED_AT'].includes(field.type))
    return new Date(String(value)).toISOString();
  // SQL grouping uses ->> for non-scalar JSON fields.
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return value;
}
export function groupedRows(
  records: RecordRow[],
  fields: Field[],
  groups: QueryResult['groups'],
  collapsed: Set<string>,
): GridRow[] {
  if (!fields.length) return records;
  const keyOf = (values: unknown[]) => JSON.stringify(values.map((v, i) => normalize(v, fields[i])));
  const totals = new Map(
    groups.map((g) => [
      keyOf(
        g.keys.map((v, i) => {
          if (['MULTI_SELECT', 'FILE', 'RELATION'].includes(fields[i].type) && typeof v === 'string') {
            try {
              return JSON.parse(v);
            } catch {
              return v;
            }
          }
          return v;
        }),
      ),
      g.count,
    ]),
  );
  const buckets = new Map<string, { keys: unknown[]; rows: RecordRow[] }>();
  for (const row of records) {
    const keys = fields.map((f) =>
      f.type === 'CREATED_BY'
        ? row.createdBy
        : f.type === 'CREATED_AT'
          ? row.createdAt
          : f.type === 'UPDATED_AT'
            ? row.updatedAt
            : row.values[f.id],
    );
    const key = keyOf(keys);
    if (!buckets.has(key)) buckets.set(key, { keys, rows: [] });
    buckets.get(key)!.rows.push(row);
  }
  return [...buckets].flatMap(([key, bucket]) => [
    {
      ...bucket.rows[0],
      id: 'group:' + key,
      group: { key, keys: bucket.keys, loaded: bucket.rows.length, count: totals.get(key) },
    },
    ...(collapsed.has(key) ? [] : bucket.rows),
  ]);
}
