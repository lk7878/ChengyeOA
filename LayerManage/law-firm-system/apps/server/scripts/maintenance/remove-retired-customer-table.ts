import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';

/** Delete only an empty, retired FOLLOWS projection with an identified live replacement.
 * The normal deletion service cleans views/preferences and publishes directory invalidation.
 * Canonical customer/follow-up records are not owned by this projection and remain intact. */
export async function removeRetiredCustomerTable(db: PrismaClient, actorId: string, tableId: string, replacementId: string, apply = false) {
  const actor = await new AuthorizationContextLoader(db).load(actorId);
  if (!actor.isSystemSuperAdmin) throw new Error('仅超级管理员可清理旧客资表');
  const table = await db.collabTable.findUnique({ where: { id: tableId } });
  if (!table) return { tableId, removed: true, alreadyRemoved: true };
  const replacement = await db.collabTable.findUnique({ where: { id: replacementId } });
  if (!table.archived || table.source !== 'FOLLOWS' || !replacement || replacement.archived || replacement.source !== 'CUSTOM'
    || replacement.baseId !== table.baseId || table.name !== `${replacement.name}（已移除-${table.id.slice(0, 8)}）`)
    throw new Error('旧表与有效替代表不匹配，拒绝清理');
  const counts = {
    records: await db.collabRecord.count({ where: { tableId } }),
    extensions: await db.collabExtension.count({ where: { tableId } }),
    attachments: await db.collabAttachment.count({ where: { tableId } }),
    calendarEvents: await db.calendarEvent.count({ where: { tableId } }),
    views: await db.collabView.count({ where: { tableId } }),
    preferences: await db.collabPreference.count({ where: { tableId } }),
  };
  if (counts.records || counts.extensions || counts.attachments || counts.calendarEvents) throw new Error('旧表仍有附属业务数据，请先核对');
  const rules = await db.collabRule.findMany({ where: { tableId: { not: tableId } }, select: { action: true, condition: true } });
  if (rules.some(rule => JSON.stringify(rule).includes(tableId))) throw new Error('旧表仍被自动化规则引用，拒绝清理');
  if (apply) await new CollaborationService(db, actor).mutateTable(tableId, { remove: true, version: table.schemaVersion }, randomUUID());
  return { tableId, replacementId, counts, removed: apply };
}

if (require.main === module) {
  const db = new PrismaClient();
  const [actorId, tableId, replacementId] = process.argv.slice(2);
  if (!actorId || !tableId || !replacementId) throw new Error('需要管理员、旧表和有效替代表 ID；默认预览，--apply 执行');
  removeRetiredCustomerTable(db, actorId, tableId, replacementId, process.argv.includes('--apply'))
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
}
