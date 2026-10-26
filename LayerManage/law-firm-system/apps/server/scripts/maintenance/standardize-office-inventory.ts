import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { standardizeModuleInventory } from './standardize-module-inventory';
import { officeInventoryKinds } from '../../app/application/collaboration/inventory-worksheets';
import { officeStockCatalog, officeStocktakeCatalog } from '../../app/application/collaboration/office-inventory-catalog';
import { object } from '../../app/application/collaboration/collaboration-policy';
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';

/** Schema changes retain table/field identities and existing grants. Catalog import is once-only. */
export async function standardizeOfficeInventory(db: PrismaClient, actorId: string, apply = false) {
  const report = await standardizeModuleInventory(db, actorId, apply, officeInventoryKinds, true);
  const tables = await db.collabTable.findMany({ where: {
    archived: false, OR: [
      { inventoryKind: { in: ['OFFICE_STOCK', 'OFFICE_STOCKTAKE'] } },
      { name: { in: ['办公用品库存表', '定期办公用品盘存记录', '定期办公用品盘库存记录', '定期办公用品盘库存记录表'] } },
    ],
    base: { moduleSource: 'INVENTORY_ITEMS', OR: [{ driveNode: null }, { driveNode: { deletedAt: null } }] },
  } });
  for (const table of tables) {
    const stock = table.inventoryKind === 'OFFICE_STOCK' || table.name === '办公用品库存表';
    const catalog = stock ? officeStockCatalog : officeStocktakeCatalog;
    const marker = 'OFFICE_CATALOG_IMPORT_20261026';
    const previous = await db.operationLog.findFirst({ where: { action: marker, targetId: table.id } });
    report.push({ tableId: table.id, name: table.name, initialRows: catalog.length, imported: !!previous });
    if (!apply || previous) continue;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM collab_table WHERE id=${table.id} FOR UPDATE`;
      if (await tx.operationLog.findFirst({ where: { action: marker, targetId: table.id } })) return;
      const fields = await tx.collabField.findMany({ where: { tableId: table.id, archived: false } });
      const ids = Object.fromEntries(fields.map(f => [String(object(f.options).inventoryKey), f.id]));
      if (!ids['产品名称'] || !ids[stock ? '序号' : '列1']) throw new Error('库存字段尚未标准化');
      // Never merge an initial catalog into data entered after preview without a verified mapping.
      if (await tx.collabRecord.count({ where: { tableId: table.id } }))
        throw new Error(`表 ${table.name} 已有记录，停止初始化以避免覆盖或重复导入`);
      for (const row of catalog) {
        const values: Prisma.InputJsonObject = {
          [ids[stock ? '序号' : '列1']]: row.sequence, [ids['类别']]: row.category,
          [ids['产品名称']]: row.product, [ids['产品规格']]: row.specification,
          [ids['货架']]: row.shelf, [ids['备注']]: row.note || null,
          ...(!stock ? { [ids['期初库存量']]: null, [ids['盘存时数量']]: null } : {}),
        };
        const record = await tx.collabRecord.create({ data: {
          tableId: table.id, values, ownerId: actorId, createdBy: actorId, updatedBy: actorId,
          createdAt: new Date(Date.UTC(2026, 9, 26, 0, 0, row.sequence)),
        } });
        await tx.collabRevision.create({ data: { recordId: record.id, version: 1, actorId,
          changes: Object.fromEntries(Object.entries(values).map(([id, after]) => [id, { before: null as null, after }])) as Prisma.InputJsonObject } });
      }
      await tx.operationLog.create({ data: { userId: actorId, action: marker, targetType: 'COLLAB_TABLE',
        targetId: table.id, newValues: JSON.stringify({ source: '20261026-1.docx', rows: catalog.length, preserveSequence: true }) } });
      await appendCollaborationChange(tx, actorId, table.baseId, 'record.created', table.id);
    }, { timeout: 30000 });
  }
  return report;
}
if (require.main === module) {
  const db = new PrismaClient();
  db.user.findUniqueOrThrow({ where: { username: 'admin' } })
    .then(u => standardizeOfficeInventory(db, u.id, process.argv.includes('--apply')))
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exitCode = 1; })
    .finally(() => db.$disconnect());
}
