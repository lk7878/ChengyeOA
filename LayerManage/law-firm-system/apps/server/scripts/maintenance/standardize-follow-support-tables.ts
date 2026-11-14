import 'dotenv/config';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  followSupportKinds,
  followSupportFields,
  followSupportNames,
} from '../../app/application/collaboration/follow-support-templates';
import { object } from '../../app/application/collaboration/collaboration-policy';
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';

/** Preview by default. Retire obsolete fields without discarding their historical values. */
export async function standardizeFollowSupportTables(db: PrismaClient, actorId: string, apply = false) {
  const bases = await db.collabBase.findMany({
    where: {
      tables: { some: { archived: false } },
      AND: [
        { OR: [{ driveNode: null }, { driveNode: { deletedAt: null } }] },
        { OR: [{ moduleSource: 'FOLLOWS' }, { tables: { some: { source: 'FOLLOWS', archived: false } } }] },
      ],
    },
    include: {
      tables: {
        where: { archived: false, source: 'CUSTOM' },
        include: { fields: true, _count: { select: { records: true } } },
      },
    },
  });
  const report: unknown[] = [];
  for (const base of bases)
    for (const kind of followSupportKinds) {
      const names = kind === 'MEDICAL_ASSESSMENT' ? ['病例评估表', '病历评估表'] : ['签约转化表'];
      const matches = base.tables.filter((t) => names.includes(t.name));
      for (const previous of matches.length ? matches : [undefined]) {
        const specs = followSupportFields(kind);
        const find = (name: string, position: number) =>
          previous?.fields.find((f) => f.name === name) ??
          (position === 0 ? previous?.fields.find((f) => f.position === 0 && f.name === '标题') : undefined);
        const desired = specs.map((spec) => {
          const old = find(spec.name, spec.position);
          // These two columns deliberately have no prescribed choices; retain later user configuration.
          if (['财务收款状态', '合同生成状态'].includes(spec.name) && old?.type === spec.type)
            spec.options = {
              ...spec.options,
              choices: (object(old.options).choices ?? []) as Prisma.InputJsonValue,
            };
          return { spec, old };
        });
        const changed =
          !previous ||
          previous.name !== followSupportNames[kind] ||
          previous.followSupportKind !== kind ||
          desired.some(
            ({ spec, old }) =>
              !old ||
              old.archived ||
              old.type !== spec.type ||
              old.position !== spec.position ||
              old.required !== spec.required ||
              !isDeepStrictEqual(old.options, spec.options),
          ) ||
          previous.fields.some((f) => !f.archived && !desired.some((d) => d.old?.id === f.id));
        report.push({
          baseId: base.id,
          tableId: previous?.id ?? null,
          name: followSupportNames[kind],
          fields: specs.length,
          records: previous?._count.records ?? 0,
          changed,
        });
        if (!apply || !changed) continue;
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM collab_workspace WHERE id=${base.workspaceId} FOR UPDATE`;
          const table =
            previous ??
            (await tx.collabTable.create({
              data: {
                baseId: base.id,
                name: followSupportNames[kind],
                createdBy: actorId,
                position: await tx.collabTable.count({ where: { baseId: base.id } }),
              },
            }));
          const ids: string[] = [];
          for (const { spec, old } of desired) {
            if (
              old &&
              old.type !== spec.type &&
              (await tx.collabRecord.count({
                where: { tableId: table.id, values: { path: [old.id], not: Prisma.DbNull } },
              }))
            )
              throw new Error(`字段 ${old.name} 有旧类型数据，需先迁移后再标准化`);
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
            const invalid = (v: unknown): boolean =>
              !!v &&
              typeof v === 'object' &&
              (Array.isArray(v)
                ? v.some(invalid)
                : Object.entries(v).some(([k, value]) =>
                    k === 'fieldId' ? !ids.includes(String(value)) : invalid(value),
                  ));
            if (invalid(config.filter)) delete config.filter;
            if (Array.isArray(config.sorts)) config.sorts = config.sorts.filter((v) => !invalid(v));
            if (Array.isArray(config.groupBy))
              config.groupBy = config.groupBy.filter((v) => ids.includes(String(v)));
            await tx.collabView.update({
              where: { id: view.id },
              data: {
                config: { ...config, visibleFields: ids } as Prisma.InputJsonObject,
                version: { increment: 1 },
              },
            });
          }
          await tx.collabTable.update({
            where: { id: table.id },
            data: { name: followSupportNames[kind], followSupportKind: kind, schemaVersion: { increment: 1 } },
          });
          await tx.operationLog.create({
            data: {
              userId: actorId,
              action: 'FOLLOW_SUPPORT_STANDARDIZE',
              targetType: 'COLLAB_TABLE',
              targetId: table.id,
              oldValues: JSON.stringify(previous?.fields ?? []),
              newValues: JSON.stringify({ specification: '20261022-2', kind, fields: ids }),
            },
          });
          await appendCollaborationChange(tx, actorId, base.id, 'table.updated', table.id);
        });
      }
    }
  return report;
}
if (require.main === module) {
  const db = new PrismaClient();
  db.user
    .findUniqueOrThrow({ where: { username: 'admin' } })
    .then((u) => standardizeFollowSupportTables(db, u.id, process.argv.includes('--apply')))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
