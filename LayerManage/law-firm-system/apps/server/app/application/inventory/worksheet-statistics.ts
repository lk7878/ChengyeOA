import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { CollaborationService } from '../collaboration/collaboration-service';
import { object } from '../collaboration/collaboration-policy';
import { inventoryItems, officeItems } from '../collaboration/inventory-worksheets';

/** Aggregate the actual worksheets, respecting the same table, field and row ACL as the grid. */
export async function worksheetStatistics(
  db: PrismaClient,
  actor: AuthorizationContext,
  options: {
    kind?: string;
    keyword?: string;
    from?: string;
    to?: string;
    groupBy: string;
    skip: number;
    take: number;
    creatorIds?: string[];
  },
) {
  const service = new CollaborationService(db, actor);
  const candidates = await db.collabTable.findMany({
    where: {
      archived: false,
      inventoryKind: {
        in:
          options.kind === 'OFFICE'
            ? ['OFFICE_REGISTER']
            : options.kind === 'CUSTOMIZED'
              ? ['INVENTORY_REGISTER']
              : ['OFFICE_REGISTER', 'INVENTORY_REGISTER'],
      },
    },
    orderBy: { id: 'asc' },
  });
  const branches: Prisma.Sql[] = [];
  for (const table of candidates) {
    let selected: Awaited<ReturnType<typeof service.tableAccess>>;
    try {
      selected = await service.tableAccess(table.id);
    } catch (e) {
      if ([403, 404].includes((e as { status: number }).status)) continue;
      throw e;
    }
    const field = (key: string) => selected.fields.find((f) => object(f.options).inventoryKey === key);
    const date = field('领取日期'),
      person = field('领用人'),
      department = field('领取部门');
    // Never filter or group by a hidden column, even when the client knows its name.
    if (
      ((options.from || options.to) && !date) ||
      (options.groupBy === 'employee' && !person) ||
      (options.groupBy === 'organization' && !department)
    )
      continue;
    const personExpr = person ? Prisma.sql`r.values ->> ${person.id}` : Prisma.sql`NULL::text`;
    const departmentExpr = department ? Prisma.sql`r.values ->> ${department.id}` : Prisma.sql`NULL::text`;
    const day = date
      ? Prisma.sql`(r.values ->> ${date.id})::timestamptz AT TIME ZONE 'Asia/Shanghai'`
      : Prisma.sql`NULL::timestamp`;
    const items = table.inventoryKind === 'OFFICE_REGISTER' ? officeItems : inventoryItems;
    for (const item of items) {
      const quantity = field(item);
      if (!quantity) continue;
      branches.push(Prisma.sql`SELECT ${item}::text AS "itemName", ${table.inventoryKind === 'OFFICE_REGISTER' ? 'OFFICE' : 'CUSTOMIZED'}::text AS kind,
        ${personExpr} AS person, ${departmentExpr} AS department,
        (r.values ->> ${quantity.id})::numeric AS quantity
        FROM collab_record r WHERE r."tableId"=${table.id} AND r.archived=false
        AND ${selected.access.selfOnly ? Prisma.sql`r."createdBy"=${actor.userId}` : Prisma.sql`TRUE`}
        AND ${options.creatorIds ? options.creatorIds.length ? Prisma.sql`r."createdBy" IN (${Prisma.join(options.creatorIds)})` : Prisma.sql`FALSE` : Prisma.sql`TRUE`}
        AND COALESCE((r.values ->> ${quantity.id})::numeric,0) > 0
        AND ${options.from ? Prisma.sql`(${day})::date >= ${options.from}::date` : Prisma.sql`TRUE`}
        AND ${options.to ? Prisma.sql`(${day})::date <= ${options.to}::date` : Prisma.sql`TRUE`}`);
    }
  }
  if (!branches.length) return { total: 0, list: [] };
  const person = options.groupBy === 'employee' ? Prisma.sql`person` : Prisma.sql`NULL::text`;
  const department = options.groupBy === 'organization' ? Prisma.sql`department` : Prisma.sql`NULL::text`;
  const query = Prisma.sql`WITH details AS (${Prisma.join(branches, ' UNION ALL ')}), grouped AS (
    SELECT kind, "itemName", ${person} AS "employeeName", ${department} AS "organizationPath",
      sum(quantity)::text AS quantity, count(*)::int AS count
    FROM details WHERE ${options.keyword ? Prisma.sql`strpos(lower(concat_ws(' ',"itemName",person,department)),lower(${options.keyword}))>0` : Prisma.sql`TRUE`}
    GROUP BY kind, "itemName", ${person}, ${department})
    SELECT (SELECT count(*)::int FROM grouped) AS total,
      COALESCE((SELECT jsonb_agg(p) FROM (SELECT *, jsonb_build_array(kind,"itemName","employeeName","organizationPath")::text AS id,
        '—'::text AS unit FROM grouped ORDER BY kind,"itemName","employeeName","organizationPath"
        OFFSET ${options.skip} LIMIT ${options.take}) p),'[]'::jsonb) AS list`;
  const [result] = await db.$queryRaw<Array<{ total: number; list: Array<Record<string, unknown>> }>>(query);
  return result;
}
