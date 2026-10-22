import { isDeepStrictEqual } from 'node:util';
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { businessFields } from '../../app/application/crm/workspace-business-table';
import { object } from '../../app/application/collaboration/collaboration-policy';
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';

export async function standardizeFollowWorksheets(db: PrismaClient, actorId: string, apply = false) {
  const tables = await db.collabTable.findMany({
    where: { archived: false, source: { in: ['FOLLOWS', 'PAYMENTS'] } },
    include: { fields: true },
  });
  const report: unknown[] = [];
  for (const table of tables) {
    if (table.source === 'PAYMENTS') {
      const dates = table.fields.filter((f) => object(f.options).businessKey === 'paidAt' && !f.required);
      report.push({ table: table.id, requiredDates: dates.length });
      if (apply && dates.length)
        await db.$transaction(async (tx) => {
          await tx.collabField.updateMany({
            where: { id: { in: dates.map((f) => f.id) } },
            data: { required: true },
          });
          await tx.collabTable.update({ where: { id: table.id }, data: { schemaVersion: { increment: 1 } } });
          await appendCollaborationChange(tx, actorId, table.baseId, 'table.updated', table.id);
        });
      continue;
    }
    const specs = businessFields('FOLLOWS');
    const remap: Record<string, string> = { followedBy: 'createdBy', enteredAt: 'createdAt' };
    const find = (key: string) =>
      table.fields.find((f) => object(f.options).businessKey === key) ??
      table.fields.find((f) => object(f.options).businessKey === remap[key]);
    const changed =
      specs.some((s) => {
        const old = find(String(s.options.businessKey));
        return (
          !old ||
          old.archived ||
          old.name !== s.name ||
          old.type !== s.type ||
          old.position !== s.position ||
          !isDeepStrictEqual(old.options, s.options)
        );
      }) ||
      table.fields.some(
        (f) => !f.archived && !specs.some((s) => find(String(s.options.businessKey))?.id === f.id),
      );
    report.push({ table: table.id, fields: specs.length, changed });
    if (!apply || !changed) continue;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM collab_base WHERE id=${table.baseId} FOR UPDATE`;
      const ids: string[] = [];
      for (const spec of specs) {
        const old = find(String(spec.options.businessKey));
        const data = { ...spec, archived: false, options: spec.options as Prisma.InputJsonObject };
        const field = old
          ? await tx.collabField.update({ where: { id: old.id }, data })
          : await tx.collabField.create({ data: { ...data, tableId: table.id } });
        ids.push(field.id);
      }
      // Retire obsolete columns, retaining their stored values and IDs for recovery.
      await tx.collabField.updateMany({
        where: { tableId: table.id, id: { notIn: ids } },
        data: { archived: true },
      });
      for (const view of await tx.collabView.findMany({ where: { tableId: table.id } })) {
        const config = object(view.config);
        const invalid = (value: unknown): boolean =>
          Boolean(
            value &&
              typeof value === 'object' &&
              (Array.isArray(value)
                ? value.some(invalid)
                : Object.entries(value).some(([k, v]) =>
                    k === 'fieldId' ? !ids.includes(String(v)) : invalid(v),
                  )),
          );
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
      await tx.collabTable.update({ where: { id: table.id }, data: { schemaVersion: { increment: 1 } } });
      await tx.operationLog.create({
        data: {
          userId: actorId,
          action: 'FOLLOW_FIELDS_STANDARDIZE',
          targetType: 'COLLAB_TABLE',
          targetId: table.id,
          oldValues: JSON.stringify(table.fields),
          newValues: JSON.stringify({ specification: '20261022-1', fields: ids }),
        },
      });
      await appendCollaborationChange(tx, actorId, table.baseId, 'table.updated', table.id);
    });
  }
  return report;
}
if (require.main === module) {
  const db = new PrismaClient();
  db.user
    .findUniqueOrThrow({ where: { username: 'admin' } })
    .then((u) => standardizeFollowWorksheets(db, u.id, process.argv.includes('--apply')))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
