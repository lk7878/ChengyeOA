import 'dotenv/config';
import { isDeepStrictEqual } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { hrFields, hrNames, hrKinds, isHrKind, HrKind } from '../../app/application/collaboration/hr-worksheets';
const kindFor=(table:{inventoryKind:string|null;name:string}):HrKind|undefined=>isHrKind(table.inventoryKind)?table.inventoryKind:hrKinds.find(k=>hrNames[k]===table.name||(k==='HR_ROSTER'&&table.name==='律师员工名册')||(k==='HR_INTERNS'&&table.name==='实现律师名单'));
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';

/** Offline migration; retain base/table IDs and ACLs, archive obsolete columns for audit history. */
export async function standardizeHrWorksheets(db: PrismaClient, actorId: string, apply = false) {
  const bases = await db.collabBase.findMany({ where: {
    moduleSource: 'INVENTORY_STOCKTAKES', OR: [{ driveNode: null }, { driveNode: { deletedAt: null } }],

  }, include: { driveNode: true, workspace: { include: { members: true } }, tables: { include: { fields: true, _count: { select: { records: true, extensions: true } } } } } });
  const report = [];
  for (const base of bases) {
    const tables = base.tables.filter(t => !!kindFor(t));
    const changed = base.workspace.moduleGroup !== 'HUMAN_RESOURCES' || tables.some(t => {
      const kind=kindFor(t)!, specs=hrFields(kind);
      return t.inventoryKind!==kind || t.source!=='CUSTOM' || t.fields.filter(f=>!f.archived).length!==specs.length || specs.some(s=>!t.fields.some(f=>!f.archived&&f.name===s.name&&f.type===s.type&&f.required===s.required&&f.position===s.position&&isDeepStrictEqual(f.options,s.options)));
    });
    report.push({baseId:base.id,tableIds:tables.map(t=>t.id),fields:tables.map(t=>({name:t.name,fields:hrFields(kindFor(t)!).map(s=>s.name)})),changed});
    if (!apply || !changed) continue;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM collab_workspace WHERE id=${base.workspaceId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM collab_base WHERE id=${base.id} FOR UPDATE`;
      const current = await tx.collabBase.findUniqueOrThrow({ where: { id: base.id }, include: { driveNode: true } });
      if (current.version !== base.version || current.accessVersion !== base.accessVersion || current.driveNode?.parentId || current.driveNode?.deletedAt)
        throw new Error('工作表发生变化或存在目录继承，请重新检查后迁移');
      for (const table of tables) {
        if (table.inventoryKind !== kindFor(table) && (table._count.records || table._count.extensions ||
          (table.source === 'INVENTORY_STOCKTAKES' && await tx.inventoryStocktake.count())))
          throw new Error('原表存在业务数据，需要核对字段映射后转换；未清除任何记录');
      }
      let destination = base.workspace;
      if (base.workspace.moduleGroup !== 'HUMAN_RESOURCES') {
        const parentId = base.workspace.moduleParentId ?? base.workspace.id;
        const existing = await tx.collabWorkspace.findUnique({ where: { moduleParentId_moduleGroup: { moduleParentId: parentId, moduleGroup: 'HUMAN_RESOURCES' } }, include: { members: true } });
        const members = base.workspace.members.map(({principalType, principalId, role, canCreate, rowScope, canManageAccess, hiddenFields, readonlyFields}) => ({principalType, principalId, role, canCreate, rowScope, canManageAccess, hiddenFields, readonlyFields}));
        const signature = (rows: typeof members) => JSON.stringify(rows.map(({principalType, principalId, role, canCreate, rowScope, canManageAccess, hiddenFields, readonlyFields}) => ({principalType, principalId, role, canCreate, rowScope, canManageAccess, hiddenFields, readonlyFields})).sort((a,b) => (a.principalType+a.principalId).localeCompare(b.principalType+b.principalId)));
        if (existing && (existing.organizationId !== base.workspace.organizationId || existing.ownerId !== base.workspace.ownerId || signature(existing.members) !== signature(members)))
          throw new Error('人力资源工作区权限与原工作区不同，停止迁移以免改变数据权限');
        destination = existing ?? await tx.collabWorkspace.create({ data: {
          name: '人力资源', organizationId: base.workspace.organizationId, ownerId: base.workspace.ownerId,
          moduleGroup: 'HUMAN_RESOURCES', moduleParentId: parentId, members: { create: members },
        }, include: { members: true } });
        if (await tx.driveShortcut.count({ where: { targetId: base.id, parentId: { not: null } } }))
          throw new Error('工作表存在文件夹内快捷方式，停止迁移');
        // FK cascades retain node identity. Guards are restored in this transaction; failures roll back DDL too.
        await tx.$executeRawUnsafe('ALTER TABLE drive_node DISABLE TRIGGER drive_parent_guard');
        await tx.$executeRawUnsafe('ALTER TABLE drive_shortcut DISABLE TRIGGER drive_shortcut_guard');
        await tx.collabBase.update({ where: { id: base.id }, data: { workspaceId: destination.id, version: { increment: 1 } } });
        await tx.$executeRawUnsafe('ALTER TABLE drive_shortcut ENABLE TRIGGER drive_shortcut_guard');
        await tx.$executeRawUnsafe('ALTER TABLE drive_node ENABLE TRIGGER drive_parent_guard');
      }
      for (const table of tables) {
        const kind=kindFor(table)!, specs=hrFields(kind);
        const ids = [];
        for (const spec of specs) {
          const old = table.fields.find(f => f.name === spec.name);
          const field = old ? await tx.collabField.update({ where: { id: old.id }, data: { ...spec, archived: false } })
            : await tx.collabField.create({ data: { ...spec, tableId: table.id } });
          ids.push(field.id);
        }
        await tx.collabField.updateMany({ where: { tableId: table.id, id: { notIn: ids } }, data: { archived: true } });
        await tx.collabTable.update({ where: { id: table.id }, data: { source: 'CUSTOM', inventoryKind: kind, name:hrNames[kind], schemaVersion: { increment: 1 } } });
        await tx.collabView.updateMany({ where: { tableId: table.id }, data: { config: { visibleFields: ids }, version: { increment: 1 } } });
        if (!await tx.collabView.count({ where: { tableId: table.id } })) await tx.collabView.create({ data: { tableId: table.id, name: '总表', ownerId: actorId, shared: true, isDefault: true, config: { visibleFields: ids } } });
        await tx.operationLog.create({ data: { userId: actorId, action: 'HR_WORKSHEET_STANDARDIZE', targetType: 'COLLAB_TABLE', targetId: table.id,
          oldValues: JSON.stringify({ workspaceId: base.workspaceId, table }), newValues: JSON.stringify({ workspaceId: destination.id, fields: ids }) } });
        await appendCollaborationChange(tx, actorId, base.id, 'table.updated', table.id);
      }
    }, { timeout: 60000 });
  }
  return report;
}
if (require.main === module) {
  const db = new PrismaClient();
  db.user.findUniqueOrThrow({ where: { username: 'admin' } })
    .then(u => standardizeHrWorksheets(db, u.id, process.argv.includes('--apply')))
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
}
