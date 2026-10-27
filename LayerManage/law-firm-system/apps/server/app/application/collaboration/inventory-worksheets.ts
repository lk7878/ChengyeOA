import { CollabField, CollabTable, Prisma } from '@prisma/client';
import { Access } from './collaboration-service';
import { fail, object } from './collaboration-policy';
import { expenseFields, expenseKind, expenseName, expenseProjection } from './administrative-expenses';
import { administrativeFields, administrativeKinds, administrativeNames, AdministrativeKind } from './administrative-registers';

export const officeInventoryKinds = ['OFFICE_REGISTER', 'OFFICE_SUMMARY', 'OFFICE_INBOUND', 'OFFICE_OUTBOUND', 'OFFICE_STOCK', 'OFFICE_STOCKTAKE'] as const;
export const inventoryKinds = ['INVENTORY_REGISTER', 'INVENTORY_SUMMARY', ...officeInventoryKinds, expenseKind, ...administrativeKinds] as const;
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
export const officeItems = [
  '15mm夹子', '25mm夹子', '50mm夹子', '5号电池', '7号电池', '便利贴', '标签纸', '插线板',
  '订书机', '订书钉', '固体胶', '光盘', '黑板擦', '回形针', '记号笔', '剪刀', '美工刀',
  '凭证纸', '起钉器', '铅笔', '签字笔/笔芯', '鼠标', '透明文件袋', '文件盒', '文件框',
  '橡皮擦', '印泥', '直尺', '装订线', '计算器', '打印纸', '笔记本', '两联文件框', '液体胶', '案卷绳',
];
export const isInventorySummary = (kind: string | null | undefined) => kind === 'INVENTORY_SUMMARY' || kind === 'OFFICE_SUMMARY';
export const hasInventoryProjection = (kind: string | null | undefined) => isInventorySummary(kind) || kind === 'OFFICE_STOCK' || kind === expenseKind;
export const inventoryNames: Record<InventoryKind, string> = {
  ...administrativeNames,
  ADMIN_EXPENSES: expenseName,
  INVENTORY_REGISTER: '定制物品领用登记表',
  INVENTORY_SUMMARY: '定制物品领用统计',
  OFFICE_REGISTER: '办公用品领用明细表',
  OFFICE_SUMMARY: '办公用品领用统计',
  OFFICE_INBOUND: '入库明细表',
  OFFICE_OUTBOUND: '出库明细表',
  OFFICE_STOCK: '办公用品库存表',
  OFFICE_STOCKTAKE: '定期办公用品盘存记录',
};
export const inventoryAliases = (kind: InventoryKind): string[] => [inventoryNames[kind],
  ...(kind === 'INVENTORY_SUMMARY' ? ['定制物品领用统计表', '领定制物品领用统计'] : []),
  ...(kind === 'OFFICE_STOCKTAKE' ? ['定期办公用品盘库存记录', '定期办公用品盘库存记录表'] : []),
];
export function inventoryFields(kind: InventoryKind) {
  if (administrativeKinds.includes(kind as AdministrativeKind)) return administrativeFields(kind as AdministrativeKind);
  if (kind === expenseKind) return expenseFields();
  const items = kind === 'OFFICE_REGISTER' || kind === 'OFFICE_SUMMARY' ? officeItems : inventoryItems;
  const register = kind === 'OFFICE_SUMMARY' ? '办公用品领用明细表' : '定制物品领用登记表';
  const definitions =
    kind === 'INVENTORY_REGISTER' || kind === 'OFFICE_REGISTER'
      ? [
          ['序号', 'AUTONUMBER'],
          ['领取日期', 'DATETIME'],
          ['领取部门', 'SINGLE_SELECT'],
          ['领用人', 'TEXT'],
          ...items.map((name) => [name, 'NUMBER']),
        ]
      : isInventorySummary(kind) ? [
          ['物品名称', 'TEXT'],
          ['领用数量', 'FORMULA'],
        ] : kind === 'OFFICE_INBOUND' || kind === 'OFFICE_OUTBOUND' ? [
          ['序号', 'AUTONUMBER'], ['日期', 'DATETIME'], ['产品规格', 'TEXT'], ['产品名称', 'TEXT'],
          ['单位', 'TEXT'], ['货架', 'TEXT'], [kind === 'OFFICE_INBOUND' ? '入库数量' : '出库数量', 'NUMBER'],
          [kind === 'OFFICE_INBOUND' ? '入库人' : '出库人', 'TEXT'], ['备注', 'LONG_TEXT'],
        ] : kind === 'OFFICE_STOCK' ? [
          ['序号', 'AUTONUMBER'], ['类别', 'TEXT'], ['产品名称', 'TEXT'], ['产品规格', 'TEXT'], ['货架', 'TEXT'],
          ['入库数量', 'FORMULA'], ['出库数量', 'FORMULA'], ['库存数量', 'FORMULA'], ['备注', 'LONG_TEXT'],
        ] : [
          ['列1', 'AUTONUMBER'], ['类别', 'TEXT'], ['产品名称', 'TEXT'], ['产品规格', 'TEXT'], ['货架', 'TEXT'],
          ['期初库存量', 'NUMBER'], ['盘存时数量', 'NUMBER'], ['备注', 'LONG_TEXT'],
        ];
  return definitions.map(([name, type], position) => ({
    name,
    type,
    position,
    required: (kind === 'OFFICE_REGISTER' && ['领取日期', '领用人'].includes(name)) ||
      (['OFFICE_INBOUND', 'OFFICE_OUTBOUND'].includes(kind) && ['日期', '产品规格', '产品名称', '入库人', '出库人'].includes(name)) ||
      (kind === 'OFFICE_STOCK' && name === '产品名称'),
    options: {
      inventoryKey: name,
      ...(position === 0 ? { primary: true } : {}),
      ...(name === '领取部门'
        ? { choices: ['侵权中心', '律师部', '行政后勤', '大数据中心'].map((name) => ({ id: name, name })) }
        : {}),
      ...(type === 'FORMULA' && kind === 'OFFICE_STOCK' ? {
        helpText: name === '库存数量' ? '按产品名称关联，库存数量＝入库数量－出库数量；随明细变更自动重算。' : '按产品名称汇总同一工作表中当前有权查看的未删除明细，自动重算。',
        formula: name === '库存数量' ? '入库数量 - 出库数量' : `SUMIF(${name === '入库数量' ? '入库明细表' : '出库明细表'}.产品名称, 产品名称, ${name})`,
      } : {}),
      ...(type === 'FORMULA' && isInventorySummary(kind)
        ? {
            helpText: '按物品名称匹配登记表同名字段，并汇总当前有权查看的未删除记录；登记变更后自动重算。',
            formula:
              'SWITCH(物品名称, ' +
              items.map((n) => `"${n}", SUM(${register}.${n})`).join(', ') +
              ', 0)',
          }
        : {}),
    } as Prisma.InputJsonObject,
  }));
}
export async function seedInventorySummary(tx: Prisma.TransactionClient, tableId: string, actorId: string) {
  const table = await tx.collabTable.findUniqueOrThrow({ where: { id: tableId } });
  const items = table.inventoryKind === 'OFFICE_SUMMARY' ? officeItems : inventoryItems;
  const fields = await tx.collabField.findMany({ where: { tableId, archived: false } });
  const name = fields.find((f) => object(f.options).inventoryKey === '物品名称')!;
  for (let i = 0; i < items.length; i++) {
    const exists = await tx.collabRecord.findFirst({
      where: { tableId, values: { path: [name.id], equals: items[i] } },
    });
    if (!exists)
      await tx.collabRecord.create({
        data: {
          tableId,
          createdBy: actorId,
          updatedBy: actorId,
          ownerId: actorId,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          values: { [name.id]: items[i] },
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
  if (table.inventoryKind === expenseKind) return expenseProjection(table, fields);
  if (table.inventoryKind === 'OFFICE_STOCK') return officeStockSql(tx, table, fields, actorId, authorize);
  const items = table.inventoryKind === 'OFFICE_SUMMARY' ? officeItems : inventoryItems;
  const name = fields.find((f) => object(f.options).inventoryKey === '物品名称');
  const total = fields.find((f) => object(f.options).inventoryKey === '领用数量');
  if (!name || !total) fail('COLLAB_FIELD_UNAVAILABLE', 403);
  const tables = await tx.collabTable.findMany({
    where: { baseId: table.baseId, inventoryKind: table.inventoryKind === 'OFFICE_SUMMARY' ? 'OFFICE_REGISTER' : 'INVENTORY_REGISTER', archived: false },
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
      items.includes(String(object(f.options).inventoryKey)),
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

async function officeStockSql(
  tx: Prisma.TransactionClient,
  table: CollabTable,
  fields: CollabField[],
  actorId: string,
  authorize: (id: string) => Promise<{ fields: CollabField[]; access: Access }>,
) {
  const name = fields.find(f => object(f.options).inventoryKey === '产品名称');
  const computed = fields.filter(f => f.type === 'FORMULA');
  if (!computed.length) return Prisma.sql`SELECT r.* FROM collab_record r WHERE r."tableId"=${table.id}`;
  if (!name) fail('COLLAB_FIELD_UNAVAILABLE', 403);
  const sources = await tx.collabTable.findMany({ where: {
    baseId: table.baseId, archived: false, inventoryKind: { in: ['OFFICE_INBOUND', 'OFFICE_OUTBOUND'] },
  } });
  const branches: Prisma.Sql[] = [];
  for (const kind of ['OFFICE_INBOUND', 'OFFICE_OUTBOUND']) {
    const matches = sources.filter(s => s.inventoryKind === kind);
    if (!matches.length) fail('COLLAB_INVENTORY_MOVEMENTS_REQUIRED');
    let allowed = false;
    for (const source of matches) {
      let selected: Awaited<ReturnType<typeof authorize>>;
      try { selected = await authorize(source.id); }
      catch (e) {
        if (['COLLAB_FORBIDDEN', 'COLLAB_NOT_FOUND'].includes((e as {code: string}).code)) continue;
        throw e;
      }
      const product = selected.fields.find(f => object(f.options).inventoryKey === '产品名称');
      const quantity = selected.fields.find(f => object(f.options).inventoryKey === (kind === 'OFFICE_INBOUND' ? '入库数量' : '出库数量'));
      if (!product || !quantity) continue;
      allowed = true;
      const sum = Prisma.sql`COALESCE(sum((s.values ->> ${quantity.id})::numeric), 0)`;
      branches.push(Prisma.sql`SELECT s.values ->> ${product.id} AS name,
        ${kind === 'OFFICE_INBOUND' ? sum : Prisma.sql`0::numeric`} AS incoming,
        ${kind === 'OFFICE_OUTBOUND' ? sum : Prisma.sql`0::numeric`} AS outgoing
        FROM collab_record s WHERE s."tableId"=${source.id} AND s.archived=false
        AND ${selected.access.selfOnly ? Prisma.sql`s."createdBy"=${actorId}` : Prisma.sql`TRUE`}
        GROUP BY 1`);
    }
    if (!allowed) fail('COLLAB_FORBIDDEN', 403);
  }
  const values = computed.flatMap(f => [Prisma.sql`${f.id}::text`,
    object(f.options).inventoryKey === '入库数量' ? Prisma.sql`q.incoming` :
      object(f.options).inventoryKey === '出库数量' ? Prisma.sql`q.outgoing` : Prisma.sql`q.incoming-q.outgoing`]);
  return Prisma.sql`SELECT r.id, r."tableId", r."createdBy", r."updatedBy", r."ownerId", r.version, r.archived, r."createdAt", r."updatedAt",
    r.values || jsonb_build_object(${Prisma.join(values)}) AS values
    FROM collab_record r LEFT JOIN LATERAL (
      SELECT COALESCE(sum(m.incoming),0) AS incoming, COALESCE(sum(m.outgoing),0) AS outgoing
      FROM (${Prisma.join(branches, ' UNION ALL ')}) m WHERE m.name=r.values ->> ${name.id}
    ) q ON TRUE WHERE r."tableId"=${table.id}`;
}

/** Called for writes and restores, under the same table lock to prevent duplicate product rows. */
export async function validateOfficeStock(
  tx: Prisma.TransactionClient, table: CollabTable, fields: CollabField[], values: Record<string, unknown>, recordId?: string,
) {
  if (table.inventoryKind !== 'OFFICE_STOCK') return;
  await tx.$queryRaw`SELECT id FROM collab_table WHERE id=${table.id} FOR UPDATE`;
  const product = fields.find(f => object(f.options).inventoryKey === '产品名称');
  if (!product) fail('COLLAB_REQUIRED_FIELD_FORBIDDEN', 403);
  const name = values[product.id];
  const duplicate = await tx.collabRecord.findFirst({ where: {
    tableId: table.id, archived: false, ...(recordId ? { id: { not: recordId } } : {}),
    values: { path: [product.id], equals: String(name) },
  }, select: { id: true } });
  if (duplicate) fail('COLLAB_INVENTORY_PRODUCT_DUPLICATE', 409);
}
