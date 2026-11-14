import 'dotenv/config';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import { lawyerProspectFields, lawyerProspectNames } from '../../app/application/collaboration/lawyer-prospect-template';
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';
import { object } from '../../app/application/collaboration/collaboration-policy';

/** Upgrade the two empty placeholders in place, preserving their identities and ACLs. */
export async function standardizeLawyerProspects(db: PrismaClient, actorId: string, apply = false) {
  return db.$transaction(async tx => {
    const bases = await tx.collabBase.findMany({
      where: {
        tables: { some: { name: { in: lawyerProspectNames }, archived: false } },
        OR: [{ driveNode: null }, { driveNode: { deletedAt: null } }],
      },
      include: { tables: { include: { fields: true } } },
    });
    const report: { baseId: string; tableId: string; name: string; fields: number; changed: boolean }[] = [];
    if (!bases.length) throw new Error('未找到指定客资表，请先核对工作区');
    for (const base of bases) {
      await tx.$queryRaw`SELECT id FROM collab_workspace WHERE id=${base.workspaceId} FOR UPDATE`;
      // Never move unrelated tables or silently change which records a business table exposes.
      if (base.tables.some(t => !lawyerProspectNames.includes(t.name)) ||
          lawyerProspectNames.some(name => !base.tables.some(t => t.name === name && !t.archived)))
        throw new Error('客资表所在工作簿包含其他表或缺少目标表，需单独核对');
      const nextName = base.name === '线索表' ? '律师客资工作表' : base.name;
      const baseChanged = base.moduleSource !== 'CUSTOMERS' || base.name !== nextName;
      for (const name of lawyerProspectNames) {
        const table = base.tables.find(t => t.name === name)!;
        const desired = lawyerProspectFields().map(spec => ({
          spec,
          old: table.fields.find(f => f.name === spec.name) ??
            (spec.name === '客户姓名' ? table.fields.find(f => f.name === '标题') : undefined),
        }));
        const changed = table.source !== 'CUSTOM' || table.position !== lawyerProspectNames.indexOf(name) ||
          desired.some(({ spec, old }) => !old || old.archived || old.name !== spec.name ||
            old.type !== spec.type || old.position !== spec.position || old.required !== spec.required ||
            !isDeepStrictEqual(old.options, spec.options)) ||
          table.fields.some(f => !f.archived && !desired.some(d => d.old?.id === f.id));
        report.push({ baseId: base.id, tableId: table.id, name, fields: desired.length, changed: changed || baseChanged });
        if (table.source !== 'CUSTOM' && (table.source !== 'LEADS' ||
            await tx.lead.count() || await tx.collabExtension.count({ where: { tableId: table.id } })))
          throw new Error(`${name} 已连接业务数据，不能直接转换为空白客资表`);
        if (!changed) continue;
        if (await tx.collabRecord.count({ where: { tableId: table.id } }))
          throw new Error(`${name} 已有数据，请先制定字段迁移方案`);
        if (!apply) continue;
        const ids: string[] = [];
        for (const { spec, old } of desired) {
          const data = { ...spec, archived: false };
          const field = old
            ? await tx.collabField.update({ where: { id: old.id }, data })
            : await tx.collabField.create({ data: { ...data, tableId: table.id } });
          ids.push(field.id);
        }
        await tx.collabField.updateMany({ where: { tableId: table.id, id: { notIn: ids } }, data: { archived: true } });
        const views = await tx.collabView.findMany({ where: { tableId: table.id } });
        if (!views.length) await tx.collabView.create({ data: {
          tableId: table.id, name: '总表', ownerId: actorId, shared: true, isDefault: true,
          config: { visibleFields: ids },
        } });
        for (const view of views) {
          const config = object(view.config);
          const invalid = (value: unknown): boolean => !!value && typeof value === 'object' &&
            (Array.isArray(value) ? value.some(invalid) : Object.entries(value).some(([k, v]) =>
              k === 'fieldId' ? !ids.includes(String(v)) : invalid(v)));
          if (invalid(config.filter)) delete config.filter;
          if (Array.isArray(config.sorts)) config.sorts = config.sorts.filter(v => !invalid(v));
          if (Array.isArray(config.groupBy)) config.groupBy = config.groupBy.filter(v => ids.includes(String(v)));
          await tx.collabView.update({ where: { id: view.id }, data: {
            config: { ...config, visibleFields: ids } as Prisma.InputJsonObject, version: { increment: 1 },
          } });
        }
        await tx.collabTable.update({ where: { id: table.id }, data: {
          source: 'CUSTOM', position: lawyerProspectNames.indexOf(name), schemaVersion: { increment: 1 },
        } });
        await tx.operationLog.create({ data: {
          userId: actorId, action: 'LAWYER_PROSPECT_STANDARDIZE', targetType: 'COLLAB_TABLE', targetId: table.id,
          oldValues: JSON.stringify(table), newValues: JSON.stringify({ specification: '20261103', fields: ids }),
        } });
        await appendCollaborationChange(tx, actorId, base.id, 'table.updated', table.id);
      }
      if (apply && baseChanged) {
        await tx.collabBase.update({ where: { id: base.id }, data: {
          moduleSource: 'CUSTOMERS', name: nextName, version: { increment: 1 },
        } });
        await tx.operationLog.create({ data: {
          userId: actorId, action: 'LAWYER_PROSPECT_RELOCATE', targetType: 'COLLAB_BASE', targetId: base.id,
          oldValues: JSON.stringify({ name: base.name, moduleSource: base.moduleSource, accessPolicy: base.accessPolicy }),
          newValues: JSON.stringify({ name: nextName, moduleSource: 'CUSTOMERS' }),
        } });
        await appendCollaborationChange(tx, actorId, base.id, 'base.updated', base.id);
      }
    }
    return report;
  }, { timeout: 30000 });
}

if (require.main === module) {
  const db = new PrismaClient();
  db.user.findUniqueOrThrow({ where: { username: 'admin' } })
    .then(u => standardizeLawyerProspects(db, u.id, process.argv.includes('--apply')))
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exitCode = 1; })
    .finally(() => db.$disconnect());
}
