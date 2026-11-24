import { createHash } from 'node:crypto';
import { CollabField, Prisma } from '@prisma/client';
import { CollaborationService } from './collaboration-service';
import { exact, fail, integer, json, object, text } from './collaboration-policy';
import { fieldDependencies } from './field-dependencies';
import { fieldProtection, fieldStopped, presentedField } from './field-management-policy';

type Tx = Prisma.TransactionClient;


/** Shared by every worksheet, including business projections and custom tables. */
export class FieldManagement extends CollaborationService {
  private async management(tableId: string, tx: Tx = this.db) {
    const state = await this.tableAccess(tableId, tx, 3);
    if (!this.actor.isSystemSuperAdmin && (state.access.selfOnly || state.access.hidden.length || state.access.readonly.length || state.access.viewIds || state.access.rowIds)) fail('COLLAB_FORBIDDEN', 403);
    return state;
  }
  async listFields(tableId: string) {
    const { table } = await this.management(tableId);
    return { version: table.schemaVersion, superAdmin: this.actor.isSystemSuperAdmin,
      fields: table.fields.map(field => ({ ...presentedField(field), stopped: fieldStopped(field), ...fieldProtection(field) })) };
  }
  private async impact(tx: Tx, tableId: string, field: CollabField) {
    const records = await tx.$queryRaw<{ active: bigint; trash: bigint; stamp: string }[]>(Prisma.sql`
      SELECT count(*) FILTER (WHERE NOT archived) AS active, count(*) FILTER (WHERE archived) AS trash,
      md5(COALESCE(string_agg(id || ':' || version::text, ',' ORDER BY id),'')) AS stamp
      FROM collab_record WHERE "tableId"=${tableId} AND values ? ${field.id}`);
    const extensions = await tx.$queryRaw<{ n: bigint; stamp: string }[]>(Prisma.sql`
      SELECT count(*) AS n, md5(COALESCE(string_agg("recordId" || ':' || version::text, ',' ORDER BY "recordId"),'')) AS stamp
      FROM collab_extension WHERE "tableId"=${tableId} AND values ? ${field.id}`);
    const revisions = await tx.collabRevision.count({ where: { record: { tableId }, changes: { path: [field.id], not: Prisma.DbNull } } });
    const extensionRevisions = await tx.collabExtensionRevision.count({ where: { tableId, changes: { path: [field.id], not: Prisma.DbNull } } });
    const operations = await tx.$queryRaw<{ n: bigint; stamp: string }[]>(Prisma.sql`
      SELECT count(*) AS n, md5(COALESCE(string_agg(id || ':' || before::text || ':' || after::text, ',' ORDER BY id),'')) AS stamp
      FROM collab_record_operation WHERE "tableId"=${tableId} AND (before ? ${field.id} OR after ? ${field.id} OR before->'values' ? ${field.id} OR after->'values' ? ${field.id})`);
    return { activeRecords: Number(records[0].active), recycledRecords: Number(records[0].trash), extensionRecords: Number(extensions[0].n),
      revisions: revisions + extensionRevisions, undoEntries: Number(operations[0].n), stamp: records[0].stamp + extensions[0].stamp + operations[0].stamp };
  }
  private async inspect(tx: Tx, tableId: string, fieldId: string) {
    const { table } = await this.management(tableId, tx);
    const field = table.fields.find(f => f.id === fieldId);
    if (!field) fail('COLLAB_NOT_FOUND', 404);
    const protection = fieldProtection(field);
    const blockers = await fieldDependencies(tx, tableId, field);
    if (protection.system || protection.core) blockers.unshift('系统业务字段或核心字段不能彻底删除。');
    if (!field.archived) blockers.unshift('请先停用字段，再检查删除范围。');
    const { stamp, ...impact } = await this.impact(tx, tableId, field);
    const token = createHash('sha256').update(JSON.stringify([this.actor.userId, tableId, field, table.schemaVersion, blockers, impact, stamp])).digest('hex');
    return { field, version: table.schemaVersion, blockers, impact, token };
  }
  async previewRemoval(tableId: string, fieldId: string, action = 'delete') {
    if (!['stop', 'delete'].includes(action)) fail('COLLAB_INVALID_VALUE');
    if (action === 'delete' && !this.actor.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN', 403);
    return this.db.$transaction(async tx => {
      const report = await this.inspect(tx, tableId, fieldId);
      if (action === 'stop') {
        const protection = fieldProtection(report.field);
        if (protection.system && !this.actor.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN', 403);
        report.blockers = await fieldDependencies(tx, tableId, report.field);
        if (protection.core) report.blockers.unshift(protection.reason);
      }
      return report;
    }, { isolationLevel: 'RepeatableRead' });
  }
  async changeField(tableId: string, fieldId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['action', 'version', 'name', 'helpText', 'token', 'confirmName']);
    const action = text(input.action);
    if (!['stop', 'restore', 'presentation', 'delete'].includes(action)) fail('COLLAB_INVALID_VALUE');
    const initial = await this.management(tableId);
    if (['presentation','delete'].includes(action) && !this.actor.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN', 403);
    return this.write(key, ['field.lifecycle', tableId, fieldId, input], async tx => {
      await this.lock(tx, initial.access.workspaceId);
      const { table } = await this.management(tableId, tx);
      if (table.schemaVersion !== integer(input.version)) fail('COLLAB_SCHEMA_CONFLICT', 409);
      const field = table.fields.find(f => f.id === fieldId);
      if (!field) fail('COLLAB_NOT_FOUND', 404);
      const protection = fieldProtection(field);
      if (protection.system && !this.actor.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN', 403);
      if (action === 'delete') {
        const report = await this.inspect(tx, tableId, fieldId);
        if (report.blockers.length) fail('COLLAB_FIELD_DEPENDENCIES', 409);
        if (input.token !== report.token || input.confirmName !== field.name) fail('COLLAB_FIELD_DELETE_CHANGED', 409);
        await tx.$executeRaw(Prisma.sql`UPDATE collab_record SET values=values - ${fieldId}, version=version+1, "updatedAt"=now() WHERE "tableId"=${tableId} AND values ? ${fieldId}`);
        await tx.$executeRaw(Prisma.sql`UPDATE collab_extension SET values=values - ${fieldId}, version=version+1, "updatedAt"=now() WHERE "tableId"=${tableId} AND values ? ${fieldId}`);
        await tx.$executeRaw(Prisma.sql`UPDATE collab_revision SET changes=changes - ${fieldId} WHERE "recordId" IN (SELECT id FROM collab_record WHERE "tableId"=${tableId}) AND changes ? ${fieldId}`);
        await tx.$executeRaw(Prisma.sql`UPDATE collab_extension_revision SET changes=changes - ${fieldId} WHERE "tableId"=${tableId} AND changes ? ${fieldId}`);
        // Scrub only this field; preserve other values/history while preventing restore from resurrecting it.
        await tx.$executeRaw(Prisma.sql`UPDATE collab_record_operation SET
          before=(before - ${fieldId}) #- ARRAY['values', ${fieldId}],
          after=(after - ${fieldId}) #- ARRAY['values', ${fieldId}]
          WHERE "tableId"=${tableId} AND (before ? ${fieldId} OR after ? ${fieldId} OR before->'values' ? ${fieldId} OR after->'values' ? ${fieldId})`);
        for (const view of await tx.collabView.findMany({ where: { tableId } })) {
          const config = object(view.config);
          const widths = { ...object(config.widths ?? {}) }; delete widths[fieldId];
          await tx.collabView.update({ where: { id: view.id }, data: { config: json({ ...config, widths,
            ...(Array.isArray(config.visibleFields) ? { visibleFields: config.visibleFields.filter(id => id !== fieldId) } : {}) }), version: { increment: 1 } } });
        }
        await tx.collabField.delete({ where: { id: fieldId } });
      } else if (action === 'presentation') {
        if (!protection.system) fail('COLLAB_INVALID_VALUE');
        const name = text(input.name, 100);
        const help = input.helpText ? text(input.helpText, 1000) : '';
        await tx.collabField.update({ where: { id: fieldId }, data: { options: json({ ...object(field.options), displayName: name, displayHelp: help }) } });
      } else {
        if (action === 'stop') {
          if (protection.core) fail('COLLAB_FIELD_PROTECTED', 409);
          if ((await fieldDependencies(tx, tableId, field)).length) fail('COLLAB_FIELD_DEPENDENCIES', 409);
        } else if (await tx.collabField.findFirst({ where: { tableId, id: { not: fieldId }, name: field.name, archived: false } })) fail('COLLAB_NAME_OR_ID_CONFLICT', 409);
        await tx.collabField.update({ where: { id: fieldId }, data: protection.system
          ? { archived: action === 'restore' ? false : field.archived, options: json({ ...object(field.options), presentationDisabled: action === 'stop' }) }
          : { archived: action === 'stop' } });
      }
      await tx.collabTable.update({ where: { id: tableId }, data: { schemaVersion: { increment: 1 } } });
      await tx.operationLog.create({ data: { userId: this.actor.userId, action: 'WORKSHEET_FIELD_' + action.toUpperCase(), targetType: 'COLLAB_FIELD', targetId: fieldId,
        oldValues: JSON.stringify({ name: presentedField(field).name, stopped: fieldStopped(field) }),
        newValues: JSON.stringify({ tableId, name: field.name, action, ...(action === 'presentation' ? { displayName: input.name, displayHelp: input.helpText } : {}) }) } });
      await this.event(tx, table.baseId, 'schema.updated', tableId);
      return { id: fieldId, version: table.schemaVersion + 1 };
    }, undefined, Prisma.TransactionIsolationLevel.Serializable);
  }
}
