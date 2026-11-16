import { CollabRecord, Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { appendCollaborationChange } from './collaboration-change';
import { fail, json, object } from './collaboration-policy';

export const CUSTOMER_ROUTE_TRIGGER = 'CUSTOMER_SOURCE_CHANGED';
export const customerRouteKeys = ['customerNo', 'name', 'phone', 'address', 'wechat'] as const;
export type CustomerRouteKey = typeof customerRouteKeys[number];
export type CustomerRouteAction = { sourceFieldId: string; routes: Record<string, {
  targetTableId: string; fields: Record<string, CustomerRouteKey>;
}> };

/** Admin-configured distribution runs atomically with the source edit. The target
 * keeps its own ACL and follow-up values. Reassignment archives the previous target record. */
export async function syncCustomerSource(tx: Prisma.TransactionClient, customerId: string, actorId: string, sourceTableId?: string) {
  const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
  if (!customer) return;
  const rules = await tx.collabRule.findMany({ where: { enabled: true, trigger: CUSTOMER_ROUTE_TRIGGER,
    ...(sourceTableId ? { tableId: sourceTableId } : {}), table: { archived: false, source: 'CUSTOMERS', base: { OR: [{ driveNode: null }, { driveNode: { deletedAt: null } }] } } },
    include: { table: { include: { fields: { where: { archived: false } } } } }, orderBy: { id: 'asc' } });
  for (const rule of rules) {
    const action = rule.action as unknown as CustomerRouteAction;
    const source = rule.table.fields.find(f => f.id === action.sourceFieldId && f.type === 'SINGLE_SELECT');
    if (!source) continue;
    const extension = await tx.collabExtension.findUnique({ where: { tableId_recordId: { tableId: rule.tableId, recordId: customerId } } });
    const choice = object(extension?.values ?? {})[source.id];
    const route = typeof choice === 'string' ? action.routes?.[choice] : undefined;
    // Serialize all destinations in a fixed order, including a change/clear of origin.
    for (const id of [...new Set(Object.values(action.routes).map(r => r.targetTableId))].sort())
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`customer-route:${id}:${customer.customerNo}`}, 0))`;
    for (const old of Object.values(action.routes).filter(r => r.targetTableId !== route?.targetTableId)) {
      const number = Object.entries(old.fields).find(([, key]) => key === 'customerNo')?.[0];
      if (!number) continue;
      const target = await tx.collabTable.findFirst({ where: { id: old.targetTableId, baseId: rule.table.baseId, source: 'CUSTOM', archived: false } });
      if (!target) continue;
      for (const previous of await tx.$queryRaw<CollabRecord[]>`SELECT * FROM collab_record WHERE "tableId"=${target.id} AND archived=false AND "values"->>${number}=${customer.customerNo} FOR UPDATE`) {
        const saved = await tx.collabRecord.update({ where: { id: previous.id }, data: { archived: true, updatedBy: actorId, version: { increment: 1 } } });
        await tx.collabRecordOperation.create({ data: { tableId: target.id, recordId: previous.id, actorId, kind: 'DELETE', before: json({ values: previous.values }), after: json({ values: {} }), expectedVersion: saved.version, schemaVersion: target.schemaVersion } });
        await appendCollaborationChange(tx, actorId, target.baseId, 'customer.source.removed', saved.id);
      }
    }
    if (!route) continue;
    const target = await tx.collabTable.findFirst({ where: { id: route.targetTableId, archived: false, source: 'CUSTOM', baseId: rule.table.baseId }, include: { fields: { where: { archived: false } } } });
    if (!target || target.inventoryKind || target.lifecycleKind) fail('COLLAB_CUSTOMER_ROUTE_UNAVAILABLE', 409);
    const entries = Object.entries(route.fields);
    const number = entries.find(([, key]) => key === 'customerNo')?.[0];
    if (!number || entries.some(([id, key]) => !customerRouteKeys.includes(key) || !target.fields.some(f => f.id === id && ['TEXT','PHONE','LONG_TEXT'].includes(f.type)))) fail('COLLAB_CUSTOMER_ROUTE_UNAVAILABLE', 409);
    const matches = await tx.$queryRaw<CollabRecord[]>`SELECT * FROM collab_record WHERE "tableId"=${target.id} AND "values"->>${number}=${customer.customerNo} FOR UPDATE`;
    if (matches.length > 1) fail('COLLAB_CUSTOMER_ROUTE_DUPLICATE', 409);
    const previous = matches[0];
    const values = { ...object(previous?.values ?? {}), ...Object.fromEntries(entries.map(([id, key]) => [id, customer[key] ?? null])) };
    if (!previous) for (const field of target.fields) {
      if (!Object.hasOwn(values, field.id) && field.defaultValue != null) values[field.id] = field.defaultValue;
      if (field.required && !['CREATED_AT','UPDATED_AT','CREATED_BY','UPDATED_BY','AUTONUMBER'].includes(field.type) && (values[field.id] == null || values[field.id] === '')) fail('COLLAB_CUSTOMER_ROUTE_REQUIRED_FIELD', 409);
    }
    if (previous && !previous.archived && isDeepStrictEqual(previous.values, values)) continue;
    const saved = previous ? await tx.collabRecord.update({ where: { id: previous.id }, data: { values: json(values), archived: false, updatedBy: actorId, version: { increment: 1 } } })
      : await tx.collabRecord.create({ data: { tableId: target.id, values: json(values), ownerId: customer.createdBy, createdBy: customer.createdBy, updatedBy: actorId } });
    await tx.collabRevision.create({ data: { recordId: saved.id, version: saved.version, actorId, changes: json(Object.fromEntries(entries.map(([id]) => [id, { before: object(previous?.values ?? {})[id] ?? null, after: values[id] } ]))) } });
    await appendCollaborationChange(tx, actorId, target.baseId, 'customer.source.synced', saved.id);
  }
}
