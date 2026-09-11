import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import {
  createEventServices,
  EventServices,
} from '../../app/application/events/event-services-factory';
import { ADMIN_OPERATION_REVIEWED_NOTIFICATION_HANDLER_CODE } from '../../app/application/events/handlers/admin-operation-reviewed-notification-handler';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { EventWorkerEnvironment } from '../../config/env';
import { allowTestGovernanceStepUp } from '../helpers/governance-step-up';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const EVENT_CONFIG: EventWorkerEnvironment = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});
let prisma: PrismaClient;
let requesterId: string;
let reviewerId: string;

function reviewerContext(): AuthorizationContext {
  return {
    userId: reviewerId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: true,
    grants: [],
    fieldRules: [],
    permissionCodes: ['governance.review'] as PermissionCode[],
    evaluatedAt: new Date(),
  };
}

async function createOperation(input: {
  operationType: 'SYSTEM_ADMIN_GRANT' | 'MASTER_DATA_METADATA_CORRECTION';
  riskLevel: 'HIGH' | 'LOW';
  reviewMode: 'PRE' | 'POST';
  status: 'PENDING_REVIEW' | 'PENDING_POST_REVIEW';
}) {
  return prisma.adminOperation.create({
    data: {
      operationNo: `GOV-${randomUUID()}`,
      operationType: input.operationType,
      riskLevel: input.riskLevel,
      reviewMode: input.reviewMode,
      status: input.status,
      requesterUserId: requesterId,
      targetType: 'USER',
      targetId: randomUUID(),
      reason: 'E2E private request reason',
      payloadSnapshot: { privateTarget: 'must-not-notify' },
      payloadHash: 'b'.repeat(64),
      expectedTargetVersion: 1,
      idempotencyKey: randomUUID(),
    },
  });
}

function governanceServices(events: EventServices) {
  return createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test',
    stepUp: allowTestGovernanceStepUp,
    outboxWriter: events.outboxWriter,
  });
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  requesterId = (await prisma.user.create({
    data: { username: `requester.${randomUUID()}`, password: 'unused' },
  })).id;
  reviewerId = (await prisma.user.create({
    data: { username: `reviewer.${randomUUID()}`, password: 'unused' },
  })).id;
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('returns one shared service graph for one client/config and isolates different clients', async () => {
  const first = createEventServices(prisma, EVENT_CONFIG);
  const repeated = createEventServices(prisma, { ...EVENT_CONFIG });
  assert.strictEqual(repeated, first);
  assert.strictEqual(repeated.registry, first.registry);
  assert.strictEqual(repeated.dispatcher, first.dispatcher);
  assert.strictEqual(repeated.deliveryStore, first.deliveryStore);
  assert.strictEqual(repeated.worker, first.worker);
  assert.strictEqual(repeated.health, first.health);
  assert.strictEqual(repeated.outboxWriter, first.outboxWriter);
  assert.ok(first.registry.resolve(
    ADMIN_OPERATION_REVIEWED_NOTIFICATION_HANDLER_CODE,
    'admin.operation.reviewed',
    1,
  ));

  assert.throws(
    () => createEventServices(prisma, { ...EVENT_CONFIG, batchSize: 26 }),
    /already initialized with different configuration/,
  );

  const secondPrisma = createTestPrisma();
  try {
    const isolated = createEventServices(secondPrisma, EVENT_CONFIG);
    assert.notStrictEqual(isolated, first);
    assert.notStrictEqual(isolated.worker, first.worker);
  } finally {
    await secondPrisma.$disconnect();
  }
});

test('controllers do not construct independent EventWorker instances', async () => {
  const controllerDirectory = path.resolve(process.cwd(), 'app/controller');
  const controllerFiles = (await readdir(controllerDirectory)).filter(file => file.endsWith('.ts'));
  const source = (await Promise.all(controllerFiles.map(file => readFile(path.join(controllerDirectory, file), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /new\s+EventWorker\s*\(/);
});

test('real governance reviews flow through outbox, dispatcher, worker, and one requester notification', async () => {
  const events = createEventServices(prisma, EVENT_CONFIG);
  const governance = governanceServices(events);
  const rejectedSource = await createOperation({
    operationType: 'SYSTEM_ADMIN_GRANT', riskLevel: 'HIGH', reviewMode: 'PRE', status: 'PENDING_REVIEW',
  });
  const confirmedSource = await createOperation({
    operationType: 'MASTER_DATA_METADATA_CORRECTION', riskLevel: 'LOW', reviewMode: 'POST', status: 'PENDING_POST_REVIEW',
  });

  await governance.review.review(reviewerContext(), rejectedSource.id, {
    decision: 'REJECT',
    comment: 'Private review comment must not enter notification',
    expectedOperationVersion: rejectedSource.version,
  }, 'governance-notification-reject');
  await governance.review.review(reviewerContext(), confirmedSource.id, {
    decision: 'CONFIRM',
    expectedOperationVersion: confirmedSource.version,
  }, 'governance-notification-confirm');

  const tick = await events.worker.tick();
  assert.deepEqual(tick, {
    dispatched: 2, claimed: 2, succeeded: 2, retryScheduled: 0, manual: 0, leaseLost: 0,
  });
  const notifications = await prisma.notification.findMany({
    where: { userId: requesterId }, orderBy: { relatedId: 'asc' },
  });
  assert.equal(notifications.length, 2);
  const rejected = notifications.find(item => item.relatedId === rejectedSource.id);
  const confirmed = notifications.find(item => item.relatedId === confirmedSource.id);
  assert.ok(rejected);
  assert.ok(confirmed);
  assert.match(rejected.title, /审核驳回/);
  assert.match(rejected.content, /已拒绝/);
  assert.match(confirmed.title, /复核确认/);
  assert.match(confirmed.content, /已确认/);
  assert.doesNotMatch(JSON.stringify(notifications), /Private review comment|privateTarget|must-not-notify/i);

  const deliveries = await prisma.eventDelivery.findMany({ orderBy: { createdAt: 'asc' } });
  assert.equal(deliveries.length, 2);
  assert.ok(deliveries.every(delivery => delivery.status === 'SUCCEEDED'));
  const logs = await prisma.eventHandlerLog.findMany({
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
  });
  assert.equal(logs.length, 2);
  assert.ok(logs.every(log => log.outcome === 'SUCCEEDED'));

  assert.deepEqual(await events.worker.tick(), {
    dispatched: 0, claimed: 0, succeeded: 0, retryScheduled: 0, manual: 0, leaseLost: 0,
  });
  const restartedPrisma = createTestPrisma();
  try {
    const restarted = createEventServices(restartedPrisma, EVENT_CONFIG);
    assert.deepEqual(await restarted.worker.tick(), {
      dispatched: 0, claimed: 0, succeeded: 0, retryScheduled: 0, manual: 0, leaseLost: 0,
    });
  } finally {
    await restartedPrisma.$disconnect();
  }
  assert.equal(await prisma.notification.count({ where: { userId: requesterId } }), 2);
});

test('a governance source mismatch rolls back notification and enters safe MANUAL evidence', async () => {
  const events = createEventServices(prisma, EVENT_CONFIG);
  const governance = governanceServices(events);
  const source = await createOperation({
    operationType: 'SYSTEM_ADMIN_GRANT', riskLevel: 'HIGH', reviewMode: 'PRE', status: 'PENDING_REVIEW',
  });
  await governance.review.review(reviewerContext(), source.id, {
    decision: 'REJECT', comment: 'Reject for safe permanent-error path', expectedOperationVersion: source.version,
  });
  await prisma.adminOperation.update({ where: { id: source.id }, data: { riskLevel: 'CRITICAL' } });

  const tick = await events.worker.tick();

  assert.equal(tick.manual, 1);
  assert.equal(tick.succeeded, 0);
  assert.equal(await prisma.notification.count({ where: { userId: requesterId } }), 0);
  const delivery = await prisma.eventDelivery.findFirstOrThrow();
  const log = await prisma.eventHandlerLog.findFirstOrThrow();
  assert.equal(delivery.status, 'MANUAL');
  assert.equal(delivery.lastErrorCode, 'GOVERNANCE_SOURCE_INVALID');
  assert.match(delivery.lastErrorReference ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(log.outcome, 'MANUAL_REQUIRED');
  assert.equal(log.errorCode, 'GOVERNANCE_SOURCE_INVALID');
  assert.equal(log.errorReference, delivery.lastErrorReference);
  assert.doesNotMatch(JSON.stringify({ delivery, log }), /Reject for safe|privateTarget|must-not-notify/i);
});

test('a corrupted ordering key is quarantined before the Worker path without notification', async () => {
  const events = createEventServices(prisma, EVENT_CONFIG);
  const governance = governanceServices(events);
  const source = await createOperation({
    operationType: 'SYSTEM_ADMIN_GRANT', riskLevel: 'HIGH', reviewMode: 'PRE', status: 'PENDING_REVIEW',
  });
  await governance.review.review(reviewerContext(), source.id, {
    decision: 'REJECT', comment: 'Reject before ordering identity corruption', expectedOperationVersion: source.version,
  });
  await prisma.eventLog.updateMany({
    where: { objectId: source.id },
    data: { orderingKey: 'f'.repeat(64) },
  });

  const tick = await events.worker.tick();

  assert.equal(tick.manual, 1);
  assert.equal(tick.claimed, 0);
  assert.equal(tick.succeeded, 0);
  assert.equal(await prisma.notification.count({ where: { userId: requesterId } }), 0);
  const delivery = await prisma.eventDelivery.findFirstOrThrow();
  assert.equal(delivery.orderingKey, 'f'.repeat(64));
  assert.equal(delivery.status, 'MANUAL');
  assert.equal(delivery.handlerCode, 'EVENT_DISPATCH_QUARANTINE');
  assert.equal(delivery.lastErrorCode, 'EVENT_ENVELOPE_INVALID');
  assert.match(delivery.lastErrorReference ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(await prisma.eventHandlerLog.count({ where: { deliveryId: delivery.id } }), 0);
  assert.equal((await prisma.eventLog.findFirstOrThrow({ where: { objectId: source.id } })).dispatchedAt, null);
  assert.equal((await events.worker.tick()).manual, 0);
  assert.equal(await prisma.eventDelivery.count({ where: { event: { objectId: source.id } } }), 1);
  assert.doesNotMatch(JSON.stringify({ delivery }), /Reject before ordering|payload|privateTarget/i);
});
