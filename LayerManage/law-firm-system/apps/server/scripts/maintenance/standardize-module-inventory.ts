import 'dotenv/config';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  moduleGroup,
  moduleGroups,
  ensureModuleWorkspace,
} from '../../app/application/collaboration/module-workspaces';
import {
  inventoryKinds,
  inventoryNames,
  inventoryFields,
  seedInventorySummary,
  InventoryKind,
} from '../../app/application/collaboration/inventory-worksheets';
import { object } from '../../app/application/collaboration/collaboration-policy';
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';

/** Preserve identities, sharing, records and history. Preview is the default. */
export async function standardizeModuleInventory(db: PrismaClient, actorId: string, apply = false) {
  const report: unknown[] = [];
  const roots = await db.collabWorkspace.findMany({
    where: { moduleGroup: null },
    include: {
      bases: { include: { driveNode: true, tables: { include: { fields: true } } } },
    },
  });
  for (const root of roots) {
    for (const group of Object.keys(moduleGroups)) {
      report.push({ workspace: root.name, module: moduleGroups[group].name });
      if (apply) await db.$transaction((tx) => ensureModuleWorkspace(tx, root.id, group, actorId));
    }
    for (const base of root.bases) {
      if (!base.moduleSource || base.driveNode?.deletedAt || !base.tables.length) continue;
      const group = moduleGroup(base.moduleSource);
      // Nested folders carry ACL inheritance; do not silently detach or weaken their policy.
      if (base.driveNode?.parentId) {
        report.push({ baseId: base.id, skipped: 'nested-folder-inheritance' });
        continue;
      }
      const foreign = base.tables.filter((t) => t.source !== 'CUSTOM' && moduleGroup(t.source) !== group);
      if (foreign.length) throw new Error(`工作表 ${base.name} 包含其他模块的数据连接，需拆分后迁移`);
      report.push({ baseId: base.id, name: base.name, destination: moduleGroups[group].name });
      if (apply)
        await db.$transaction(async (tx) => {
          const target = await ensureModuleWorkspace(tx, root.id, group, actorId);
          if (await tx.driveShortcut.count({ where: { targetId: base.id, parentId: { not: null } } }))
            throw new Error(`工作表 ${base.name} 有文件夹内快捷方式，需保留目录后再迁移`);
          // Offline maintenance only: DDL locks serialize writers and rollback restores these
          // guards on failure. Foreign keys stay enabled and cascade all directory references.
          await tx.$executeRawUnsafe('ALTER TABLE drive_node DISABLE TRIGGER drive_parent_guard');
          await tx.$executeRawUnsafe('ALTER TABLE drive_shortcut DISABLE TRIGGER drive_shortcut_guard');
          await tx.collabBase.update({
            where: { id: base.id },
            data: { workspaceId: target.id, version: { increment: 1 } },
          });
          await tx.$executeRawUnsafe('ALTER TABLE drive_shortcut ENABLE TRIGGER drive_shortcut_guard');
          await tx.$executeRawUnsafe('ALTER TABLE drive_node ENABLE TRIGGER drive_parent_guard');
          await tx.operationLog.create({
            data: {
              userId: actorId,
              action: 'workspace.module.moved',
              targetType: 'COLLAB_BASE',
              targetId: base.id,
              oldValues: JSON.stringify({ workspaceId: root.id }),
              newValues: JSON.stringify({ workspaceId: target.id }),
            },
          });
          await appendCollaborationChange(tx, actorId, base.id, 'access.updated', base.id);
        });
    }
  }
  const bases = await db.collabBase.findMany({
    where: { moduleSource: 'INVENTORY_ITEMS', OR: [{ driveNode: null }, { driveNode: { deletedAt: null } }] },
    include: {
      tables: {
        where: { archived: false },
        include: { fields: true, _count: { select: { records: true, extensions: true } } },
      },
    },
  });
  for (const base of bases) {
    for (const kind of inventoryKinds) {
      const aliases =
        kind === 'INVENTORY_REGISTER'
          ? ['定制物品领用登记表']
          : ['定制物品领用统计', '定制物品领用统计表', '领定制物品领用统计'];
      const matches = base.tables.filter((t) => t.inventoryKind === kind || aliases.includes(t.name));
      // Only standardize the requested inventory workbook, not unrelated stock directories.
      if (
        !base.tables.some(
          (t) =>
            t.inventoryKind ||
            ['定制物品领用登记表', '领定制物品领用统计', '定制物品领用统计'].includes(t.name),
        )
      )
        continue;
      for (const previous of matches.length ? matches : [undefined]) {
        const specs = inventoryFields(kind);
        const changed =
          !previous ||
          previous.name !== inventoryNames[kind] ||
          previous.inventoryKind !== kind ||
          previous.source !== 'CUSTOM' ||
          previous.fields.filter((f) => !f.archived).length !== specs.length ||
          specs.some((spec) => {
            const old = previous.fields.find((f) => f.name === spec.name && !f.archived);
            return (
              !old ||
              old.type !== spec.type ||
              old.position !== spec.position ||
              old.required !== spec.required ||
              !isDeepStrictEqual(old.options, spec.options)
            );
          });
        report.push({
          baseId: base.id,
          tableId: previous?.id,
          kind,
          fields: specs.length,
          changed,
          records: previous?._count.records ?? 0,
        });
        if (!apply || !changed) continue;
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM collab_workspace WHERE id=${base.workspaceId} FOR UPDATE`;
          if (previous && !previous.inventoryKind && (previous._count.records || previous._count.extensions))
            throw new Error(`表 ${previous.name} 有既有数据，需明确字段映射后转换，未删除任何数据`);
          const table =
            previous ??
            (await tx.collabTable.create({
              data: {
                baseId: base.id,
                name: inventoryNames[kind],
                createdBy: actorId,
                position: await tx.collabTable.count({ where: { baseId: base.id } }),
              },
            }));
          const ids: string[] = [];
          for (const spec of specs) {
            const old = previous?.fields.find((f) => f.name === spec.name);
            const data = { ...spec, archived: false };
            const field = old
              ? await tx.collabField.update({ where: { id: old.id }, data })
              : await tx.collabField.create({ data: { ...data, tableId: table.id } });
            ids.push(field.id);
          }
          await tx.collabField.updateMany({
            where: { tableId: table.id, id: { notIn: ids } },
            data: { archived: true },
          });
          await tx.collabTable.update({
            where: { id: table.id },
            data: {
              name: inventoryNames[kind],
              source: 'CUSTOM',
              inventoryKind: kind,
              schemaVersion: { increment: 1 },
            },
          });
          const views = await tx.collabView.findMany({ where: { tableId: table.id } });
          if (!views.length)
            await tx.collabView.create({
              data: {
                tableId: table.id,
                name: '总表',
                ownerId: actorId,
                shared: true,
                isDefault: true,
                config: { visibleFields: ids },
              },
            });
          for (const view of views) {
            const config = object(view.config);
            const invalid = (value: unknown): boolean =>
              !!value &&
              typeof value === 'object' &&
              (Array.isArray(value)
                ? value.some(invalid)
                : Object.entries(value).some(([k, v]) =>
                    k === 'fieldId' ? !ids.includes(String(v)) : invalid(v),
                  ));
            if (invalid(config.filter)) delete config.filter;
            if (Array.isArray(config.sorts)) config.sorts = config.sorts.filter((v) => !invalid(v));
            if (Array.isArray(config.groupBy))
              config.groupBy = config.groupBy.filter((id) => ids.includes(String(id)));
            await tx.collabView.update({
              where: { id: view.id },
              data: {
                config: { ...config, visibleFields: ids } as Prisma.InputJsonObject,
                version: { increment: 1 },
              },
            });
          }
          if (kind === 'INVENTORY_SUMMARY') await seedInventorySummary(tx, table.id, actorId);
          await tx.operationLog.create({
            data: {
              userId: actorId,
              action: 'INVENTORY_WORKSHEET_STANDARDIZE',
              targetType: 'COLLAB_TABLE',
              targetId: table.id,
              oldValues: JSON.stringify(previous ?? null),
              newValues: JSON.stringify({ kind: kind as InventoryKind, fields: ids }),
            },
          });
          await appendCollaborationChange(tx, actorId, base.id, 'table.updated', table.id);
        });
      }
    }
  }
  return report;
}
if (require.main === module) {
  const db = new PrismaClient();
  db.user
    .findUniqueOrThrow({ where: { username: 'admin' } })
    .then((u) => standardizeModuleInventory(db, u.id, process.argv.includes('--apply')))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
