import { CollabField, CollabRecord, Prisma, PrismaClient } from '@prisma/client';
import { groupExpression, fieldExpression, fieldOf, ViewConfig } from './collaboration-policy';

type Group = { keys: unknown[]; count: number };
type QueryRow = CollabRecord & { _total: bigint; _groups: Group[] };

// The caller has already validated fields and compiled the current row permissions.
// Materialize only IDs and query keys, then fetch full values for the requested page.
// Count, page and groups share one PostgreSQL statement snapshot; no result cache.
export async function queryCustomRecords(
  db: PrismaClient,
  where: Prisma.Sql,
  config: ViewConfig,
  fields: CollabField[],
  page: number,
  pageSize: number,
) {
  const sorts = config.sorts ?? [];
  const sortColumns = sorts.map(
    (sort, index) =>
      Prisma.sql`${fieldExpression(fieldOf(fields, sort.fieldId))} AS ${Prisma.raw('sort_' + index)}`,
  );
  const ordering = sorts.map(
    (sort, index) =>
      Prisma.sql`${Prisma.raw('sort_' + index)} ${sort.direction === 'desc' ? Prisma.sql`DESC NULLS LAST` : Prisma.sql`ASC NULLS LAST`}`,
  );
  ordering.push(Prisma.sql`"createdAt" ASC`, Prisma.sql`id ASC`);
  const grouped = !!config.groupBy?.length;
  const keys = grouped
    ? Prisma.sql`jsonb_build_array(${Prisma.join(config.groupBy!.map((id) => groupExpression(fieldOf(fields, id))))})`
    : Prisma.sql`NULL::jsonb`;
  const columns = [
    Prisma.sql`r.id`,
    Prisma.sql`r."createdAt"`,
    ...sortColumns,
    Prisma.sql`${keys} AS group_keys`,
  ];
  const groups = grouped
    ? Prisma.sql`(SELECT COALESCE(jsonb_agg(jsonb_build_object('keys', group_keys, 'count', count)), '[]'::jsonb)
        FROM (SELECT group_keys, count(*) AS count FROM matched GROUP BY group_keys
              ORDER BY count(*) DESC, group_keys LIMIT 201) grouped)`
    : Prisma.sql`'[]'::jsonb`;
  const rows = await db.$queryRaw<QueryRow[]>(Prisma.sql`
    WITH matched AS MATERIALIZED (
      SELECT ${Prisma.join(columns)} FROM collab_record r WHERE ${where}
    ), page AS (
      SELECT id, row_number() OVER (ORDER BY ${Prisma.join(ordering)}) AS ordinal
      FROM matched ORDER BY ${Prisma.join(ordering)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    )
    SELECT r.*, stats.total AS "_total", ${groups} AS "_groups"
    FROM (SELECT count(*) AS total FROM matched) stats
    LEFT JOIN page ON TRUE LEFT JOIN collab_record r ON r.id = page.id
    ORDER BY page.ordinal
  `);
  const records: CollabRecord[] = rows
    .filter((row) => row.id !== null)
    .map((row) => ({
      id: row.id,
      tableId: row.tableId,
      values: row.values,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      ownerId: row.ownerId,
      version: row.version,
      archived: row.archived,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  const allGroups = rows[0]._groups;
  return {
    records,
    total: Number(rows[0]._total),
    groups: allGroups.slice(0, 200),
    groupsTruncated: allGroups.length > 200,
  };
}
