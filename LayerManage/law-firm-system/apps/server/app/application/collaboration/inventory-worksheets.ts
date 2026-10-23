import { CollabField, CollabTable, Prisma } from '@prisma/client';
import { Access } from './collaboration-service';
import { fail, object } from './collaboration-policy';

export const inventoryKinds = ['INVENTORY_REGISTER', 'INVENTORY_SUMMARY'] as const;
export type InventoryKind = (typeof inventoryKinds)[number];
export const inventoryItems = [
  '档案袋',
  '案卷封底',
  '案卷封面',
  '案卷盒',
  '稿签纸',
  '手提袋',
  '大信封',
  '小信封',
  '转角合同角',
  '纸杯',
];
export const inventoryNames = {
  INVENTORY_REGISTER: '定制物品领用登记表',
  INVENTORY_SUMMARY: '定制物品领用统计',
};
export function inventoryFields(kind: InventoryKind) {
  const definitions =
    kind === 'INVENTORY_REGISTER'
      ? [
          ['序号', 'AUTONUMBER'],
          ['领取日期', 'DATETIME'],
          ['领取部门', 'SINGLE_SELECT'],
          ['领用人', 'TEXT'],
          ...inventoryItems.map((name) => [name, 'NUMBER']),
        ]
      : [
          ['物品名称', 'TEXT'],
          ['领用数量', 'FORMULA'],
        ];
  return definitions.map(([name, type], position) => ({
    name,
    type,
    position,
    required: false,
    options: {
      inventoryKey: name,
      ...(position === 0 ? { primary: true } : {}),
      ...(name === '领取部门'
        ? { choices: ['侵权中心', '律师部', '行政后勤', '大数据中心'].map((name) => ({ id: name, name })) }
        : {}),
      ...(type === 'FORMULA'
        ? {
            helpText: '按物品名称匹配登记表同名字段，并汇总当前有权查看的未删除记录；登记变更后自动重算。',
            formula:
              'SWITCH(物品名称, ' +
              inventoryItems.map((n) => `"${n}", SUM(定制物品领用登记表.${n})`).join(', ') +
              ', 0)',
          }
        : {}),
    } as Prisma.InputJsonObject,
  }));
}
export async function seedInventorySummary(tx: Prisma.TransactionClient, tableId: string, actorId: string) {
  const fields = await tx.collabField.findMany({ where: { tableId, archived: false } });
  const name = fields.find((f) => object(f.options).inventoryKey === '物品名称')!;
  for (let i = 0; i < inventoryItems.length; i++) {
    const exists = await tx.collabRecord.findFirst({
      where: { tableId, values: { path: [name.id], equals: inventoryItems[i] } },
    });
    if (!exists)
      await tx.collabRecord.create({
        data: {
          tableId,
          createdBy: actorId,
          updatedBy: actorId,
          ownerId: actorId,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          values: { [name.id]: inventoryItems[i] },
        },
      });
  }
}
/** SQL projection computes totals in the same snapshot as filtering/pagination, never from cached sums. */
export async function inventorySummarySql(
  tx: Prisma.TransactionClient,
  table: CollabTable,
  fields: CollabField[],
  actorId: string,
  authorize: (id: string) => Promise<{ fields: CollabField[]; access: Access }>,
) {
  const name = fields.find((f) => object(f.options).inventoryKey === '物品名称');
  const total = fields.find((f) => object(f.options).inventoryKey === '领用数量');
  if (!name || !total) fail('COLLAB_FIELD_UNAVAILABLE', 403);
  const tables = await tx.collabTable.findMany({
    where: { baseId: table.baseId, inventoryKind: 'INVENTORY_REGISTER', archived: false },
  });
  const branches: Prisma.Sql[] = [];
  if (!tables.length) fail('COLLAB_INVENTORY_REGISTER_REQUIRED');
  for (const source of tables) {
    let selected: Awaited<ReturnType<typeof authorize>>;
    try {
      selected = await authorize(source.id);
    } catch (e) {
      if (['COLLAB_FORBIDDEN', 'COLLAB_NOT_FOUND'].includes((e as { code: string }).code)) continue;
      throw e;
    }
    for (const field of selected.fields.filter((f) =>
      inventoryItems.includes(String(object(f.options).inventoryKey)),
    )) {
      branches.push(Prisma.sql`SELECT ${String(object(field.options).inventoryKey)}::text AS name,
        COALESCE(sum((s.values ->> ${field.id})::numeric), 0) AS quantity
        FROM collab_record s WHERE s."tableId"=${source.id} AND s.archived=false
        AND ${selected.access.selfOnly ? Prisma.sql`s."createdBy"=${actorId}` : Prisma.sql`TRUE`}`);
    }
  }
  if (!branches.length) fail('COLLAB_FORBIDDEN', 403);
  return Prisma.sql`SELECT r.id, r."tableId", r."createdBy", r."updatedBy", r."ownerId", r.version, r.archived, r."createdAt", r."updatedAt",
    r.values || jsonb_build_object(${total.id}::text, COALESCE((SELECT sum(q.quantity) FROM (${Prisma.join(branches, ' UNION ALL ')}) q
      WHERE q.name = r.values ->> ${name.id}), 0)) AS values
    FROM collab_record r WHERE r."tableId"=${table.id}`;
}
export async function assignInventoryNumber(
  tx: Prisma.TransactionClient,
  tableId: string,
  fields: CollabField[],
  values: Record<string, unknown>,
) {
  const field = fields.find((f) => f.type === 'AUTONUMBER');
  if (!field) return;
  // Serialize allocation within the table; include deleted records so numbers are never reused.
  await tx.$queryRaw`SELECT id FROM collab_table WHERE id=${tableId} FOR UPDATE`;
  const [row] = await tx.$queryRaw<
    Array<{ next: number }>
  >`SELECT (COALESCE(max((values ->> ${field.id})::bigint),0)+1)::float8 AS next FROM collab_record WHERE "tableId"=${tableId}`;
  values[field.id] = row.next;
}
