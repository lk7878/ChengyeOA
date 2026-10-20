/** Idempotent field-layout upgrade. Never deletes business rows or legacy fields. Preview by default. */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { businessFields } from '../../app/application/crm/workspace-business-table';
import {
  lifecycleFields,
  lifecycleKey,
  LifecycleKind,
} from '../../app/application/collaboration/lifecycle-worksheet';
import { CASE_FIELD_ORDER } from '../../app/application/case/intake-contract';
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';
import { object } from '../../app/application/collaboration/collaboration-policy';

export async function standardizeCaseWorksheets(db: PrismaClient, apply: boolean) {
  const tables = await db.collabTable.findMany({
    where: { OR: [{ source: 'CASES' }, { lifecycleKind: { in: ['AFTER_SALES', 'CASE_REFUNDS'] } }] },
    include: { fields: true },
  });
  const report = tables.map((t) => ({
    id: t.id,
    name: t.name,
    source: t.source,
    kind: t.lifecycleKind,
    visibleCount: t.source === 'CASES' ? 23 : 27,
  }));
  if (!apply) return report;
  const actor = await db.user.findUniqueOrThrow({ where: { username: 'admin' } });
  await db.$transaction(
    async (tx) => {
      for (const table of tables) {
        await tx.$queryRaw`SELECT id FROM collab_base WHERE id=${table.baseId} FOR UPDATE`;
        const definitions =
          table.source === 'CASES'
            ? businessFields('CASES')
            : lifecycleFields(table.lifecycleKind as LifecycleKind);
        const old = await tx.collabField.findMany({ where: { tableId: table.id } });
        const ids: string[] = [];
        for (const spec of definitions) {
          const key =
            table.source === 'CASES' ? object(spec.options).businessKey : object(spec.options).lifecycleKey;
          const existing = old.find(
            (f) => (table.source === 'CASES' ? object(f.options).businessKey : lifecycleKey(f)) === key,
          );
          const named = old.find((f) => f.name === spec.name && f.id !== existing?.id);
          if (named) throw new Error(`Field name conflict on ${table.name}: ${spec.name}`);
          const data = {
            ...spec,
            options: { ...object(existing?.options ?? {}), ...spec.options } as Prisma.InputJsonValue,
          };
          const saved = existing
            ? await tx.collabField.update({ where: { id: existing.id }, data })
            : await tx.collabField.create({ data: { ...data, tableId: table.id } });
          if (
            table.source === 'CASES'
              ? CASE_FIELD_ORDER.includes(String(key))
              : object(spec.options).defaultVisible === true
          )
            ids.push(saved.id);
        }
        for (const view of await tx.collabView.findMany({ where: { tableId: table.id } })) {
          await tx.collabView.update({
            where: { id: view.id },
              data: { config: { ...object(view.config ?? {}), visibleFields: ids }, version: { increment: 1 } },
          });
        }
        await tx.collabTable.update({ where: { id: table.id }, data: { schemaVersion: { increment: 1 } } });
        await tx.operationLog.create({
          data: {
            userId: actor.id,
            action: 'WORKSHEET_FIELD_STANDARDIZE',
            targetType: 'COLLAB_TABLE',
            targetId: table.id,
            newValues: JSON.stringify({
              specification: '20261020字段优化内容',
              visibleFields: ids,
              preservedLegacyFields: true,
            }),
          },
        });
        await appendCollaborationChange(tx, actor.id, table.baseId, 'table.updated', table.id);
      }
    },
    { timeout: 120000 },
  );
  return report;
}

if (require.main === module) {
  const db = new PrismaClient();
  standardizeCaseWorksheets(db, process.argv.includes('--apply'))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
