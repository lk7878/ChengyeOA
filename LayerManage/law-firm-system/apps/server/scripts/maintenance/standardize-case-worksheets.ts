/** Idempotent field-layout upgrade. Preserves business rows; logically removes obsolete case worksheet fields. Preview by default. */
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

export async function standardizeCaseWorksheets(db: PrismaClient, apply: boolean, caseCustomerOnly = false) {
  const tables = await db.collabTable.findMany({
    where: {
      OR: [
        { source: { in: ['CASES', 'CUSTOMERS'] } },
        ...(caseCustomerOnly ? [] : [{ lifecycleKind: { in: ['AFTER_SALES', 'CASE_REFUNDS'] } }]),
      ],
    },
    include: { fields: true },
  });
  const report = tables.map((t) => ({
    id: t.id,
    name: t.name,
    source: t.source,
    kind: t.lifecycleKind,
    visibleCount:
      t.source === 'CASES' ? CASE_FIELD_ORDER.length : t.source === 'CUSTOMERS' ? businessFields('CUSTOMERS').length : lifecycleFields(t.lifecycleKind as LifecycleKind).filter(f=>f.options.defaultVisible).length,
    archiveFields:
      t.source === 'CASES'
        ? t.fields
            .filter((f) => !CASE_FIELD_ORDER.includes(String(object(f.options).businessKey)))
            .map((f) => ({ id: f.id, name: f.name }))
        : [],
  }));
  if (!apply) return report;
  const actor = await db.user.findUniqueOrThrow({ where: { username: 'admin' } });
  await db.$transaction(
    async (tx) => {
      for (const table of tables) {
        await tx.$queryRaw`SELECT id FROM collab_base WHERE id=${table.baseId} FOR UPDATE`;
        const definitions = ['CASES', 'CUSTOMERS'].includes(table.source)
          ? businessFields(table.source)
          : lifecycleFields(table.lifecycleKind as LifecycleKind);
        const old = await tx.collabField.findMany({ where: { tableId: table.id } });
        const ids: string[] = [];
        for (const spec of definitions) {
          const key =
            table.source !== 'CUSTOM' ? object(spec.options).businessKey : object(spec.options).lifecycleKey;
          const existing = old.find(
            (f) => (table.source !== 'CUSTOM' ? object(f.options).businessKey : lifecycleKey(f)) === key,
          );
          const named = old.find((f) => f.name === spec.name && f.id !== existing?.id);
          if (named) throw new Error(`Field name conflict on ${table.name}: ${spec.name}`);
          const data = {
            ...spec,
            archived: false,
            options: { ...object(existing?.options ?? {}), ...spec.options } as Prisma.InputJsonValue,
          };
          const saved = existing
            ? await tx.collabField.update({ where: { id: existing.id }, data })
            : await tx.collabField.create({ data: { ...data, tableId: table.id } });
          if (
            table.source === 'CASES'
              ? CASE_FIELD_ORDER.includes(String(key))
              : table.source === 'CUSTOMERS' || object(spec.options).defaultVisible === true
          )
            ids.push(saved.id);
        }
        if (table.source === 'CASES') {
          await tx.collabField.updateMany({
            where: { tableId: table.id, id: { notIn: ids } },
            data: { archived: true },
          });
        }
        const activeIds = new Set(
          (
            await tx.collabField.findMany({
              where: { tableId: table.id, archived: false },
              select: { id: true },
            })
          ).map((f) => f.id),
        );
        for (const view of await tx.collabView.findMany({ where: { tableId: table.id } })) {
          const config = { ...object(view.config ?? {}) };
          if (table.source === 'CASES') {
            // A mixed AND/OR filter cannot be safely simplified. Remove it if it refers to a retired field.
            const usesRetiredField = (v: unknown): boolean =>
              !!v &&
              typeof v === 'object' &&
              (Array.isArray(v)
                ? v.some(usesRetiredField)
                : Object.entries(v).some(([k, value]) =>
                    k === 'fieldId' ? !activeIds.has(String(value)) : usesRetiredField(value),
                  ));
            if (usesRetiredField(config.filter)) delete config.filter;
            if (Array.isArray(config.sorts)) config.sorts = config.sorts.filter((v) => !usesRetiredField(v));
            if (Array.isArray(config.groupBy))
              config.groupBy = config.groupBy.filter((id) => activeIds.has(String(id)));
            if (config.widths)
              config.widths = Object.fromEntries(
                Object.entries(object(config.widths)).filter(([id]) => activeIds.has(id)),
              );
            for (const key of ['dateFieldId', 'endDateFieldId', 'colorFieldId'])
              if (config[key] && !activeIds.has(String(config[key]))) delete config[key];
          }
          const visibleFields =
            table.source === 'CUSTOMERS' && Array.isArray(config.visibleFields)
              ? [...new Set([...config.visibleFields, ...ids.filter((id) => !old.some((f) => f.id === id))])]
              : ids;
          await tx.collabView.update({
            where: { id: view.id },
            data: {
              config: { ...config, visibleFields } as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
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
              specification: '20261020-3',
              visibleFields: ids,
              archivedLegacyFields: table.source === 'CASES',
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
  standardizeCaseWorksheets(
    db,
    process.argv.includes('--apply'),
    process.argv.includes('--case-customer-only'),
  )
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
