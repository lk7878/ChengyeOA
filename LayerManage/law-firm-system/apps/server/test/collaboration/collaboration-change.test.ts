import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';
import { validateEventEnvelope } from '../../app/domain/events/event-registry';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const db = createTestPrisma();
let actorId: string, baseId: string;
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  actorId = (await db.user.create({ data: { username: randomUUID(), password: 'fixture' } })).id;
  const orgId = randomUUID();
  await db.organization.create({
    data: { id: orgId, code: randomUUID(), name: '验收组织', type: 'FIRM', path: '/' + orgId },
  });
  const workspace = await db.collabWorkspace.create({
    data: { name: '验收空间', ownerId: actorId, organizationId: orgId },
  });
  baseId = (await db.collabBase.create({ data: { name: '验收应用', workspaceId: workspace.id } })).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

test('batched collaboration change preserves registered outbox and audit identity', async () => {
  const targetId = randomUUID();
  await db.$transaction((tx) => appendCollaborationChange(tx, actorId, baseId, 'record.updated', targetId));
  const event = await db.eventLog.findFirstOrThrow();
  const registered = validateEventEnvelope(event);
  assert.equal(event.orderingKey, registered.orderingKey);
  assert.equal(event.sourceModule, registered.sourceModule);
  assert.equal(event.operatorUserId, actorId);
  assert.deepEqual(event.payload, { baseId });
  assert.equal(event.dispatchedAt, null);
  const invalidation = await db.collabEvent.findFirstOrThrow();
  assert.equal(invalidation.baseId, baseId);
  assert.equal(invalidation.kind, 'record.updated');
  const audit = await db.operationLog.findFirstOrThrow();
  assert.equal(audit.userId, actorId);
  assert.equal(audit.targetId, targetId);
  assert.equal(audit.targetType, 'COLLAB');
  assert.equal(audit.action, 'record.updated');
  assert.equal(audit.newValues, null);
});

test('failed audit insert rolls back invalidation, outbox and preceding domain change', async () => {
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.collabBase.update({ where: { id: baseId }, data: { name: '必须回滚' } });
      // A real PostgreSQL NOT NULL failure, after parameter binding and registry validation.
      await appendCollaborationChange(tx, actorId, baseId, 'record.updated', null as unknown as string);
    }),
  );
  assert.equal((await db.collabBase.findUniqueOrThrow({ where: { id: baseId } })).name, '验收应用');
  assert.equal(await db.collabEvent.count(), 0);
  assert.equal(await db.eventLog.count(), 0);
  assert.equal(await db.operationLog.count(), 0);
});
