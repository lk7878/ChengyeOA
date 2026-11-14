import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import type { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { EventDeliveryStore } from '../../app/application/events/event-delivery-store';
import { EventHandlerRegistry } from '../../app/application/events/event-handler-registry';
import { EventHealthService } from '../../app/application/events/event-health-service';
import { EventOperationsService } from '../../app/application/events/event-operations-service';
import { createEventServices } from '../../app/application/events/event-services-factory';
import { EventWorker } from '../../app/application/events/event-worker';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { RetryableEventError } from '../../app/domain/events/event-errors';
import type { ActiveSessionClaims } from '../../app/application/auth/session-service';
import {
  assertEventCenterRehearsalEnvironment,
} from '../../scripts/rehearsal/rehearse-event-center';
import { allowTestGovernanceStepUp } from '../helpers/governance-step-up';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const CONFIG = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});
const OBSERVABILITY_CONFIG = Object.freeze({
  heartbeatSeconds: 10,
  heartbeatStaleSeconds: 60,
  undispatchedBlockSeconds: 120,
  dueBacklogBlockSeconds: 300,
  leaseLostDegradedCount: 1,
  leaseLostBlockedCount: 3,
  canaryWindowMinutes: 15,
});
const HANDLER_CODE = 'ACCEPTANCE_RETRY_HANDLER';
const EVENT_TYPE = 'admin.operation.reviewed';
const SECRET_FIXTURES = [
  'event-private-governance-reason',
  'event-private-review-comment',
  'event-private-business-payload',
  'event-private-step-up-token',
] as const;

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

function eventOperatorContext(): AuthorizationContext {
  return {
    userId: reviewerId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: true,
    grants: [],
    fieldRules: [],
    permissionCodes: ['event.delivery.read', 'event.delivery.retry'],
    evaluatedAt: new Date(),
  };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  requesterId = (await prisma.user.create({
    data: { username: `spec007.requester.${randomUUID()}`, password: 'unused' },
  })).id;
  reviewerId = (await prisma.user.create({
    data: { username: `spec007.reviewer.${randomUUID()}`, password: 'unused' },
  })).id;
});
test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('review transaction reaches one idempotent notification through the production event graph', async () => {
  const events = createEventServices(prisma, CONFIG);
  const governance = createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test',
    stepUp: allowTestGovernanceStepUp,
    outboxWriter: events.outboxWriter,
  });
  const source = await prisma.adminOperation.create({ data: {
    operationNo: `SPEC007-${randomUUID()}`,
    operationType: 'SYSTEM_ADMIN_GRANT',
    riskLevel: 'HIGH',
    reviewMode: 'PRE',
    status: 'PENDING_REVIEW',
    requesterUserId: requesterId,
    targetType: 'USER',
    targetId: randomUUID(),
    reason: SECRET_FIXTURES[0],
    payloadSnapshot: { privateValue: SECRET_FIXTURES[2] },
    payloadHash: 'b'.repeat(64),
    expectedTargetVersion: 1,
    idempotencyKey: randomUUID(),
  } });

  await governance.review.review(reviewerContext(), source.id, {
    decision: 'REJECT',
    comment: SECRET_FIXTURES[1],
    expectedOperationVersion: source.version,
  }, 'spec-007-acceptance');

  const [operation, reviews, audit, event] = await Promise.all([
    prisma.adminOperation.findUniqueOrThrow({ where: { id: source.id } }),
    prisma.adminOperationReview.count({ where: { operationId: source.id } }),
    prisma.operationLog.count({ where: { targetId: source.id } }),
    prisma.eventLog.findFirstOrThrow({ where: { objectId: source.id } }),
  ]);
  assert.equal(operation.status, 'REJECTED');
  assert.equal(reviews, 1);
  assert.ok(audit >= 1);
  assert.equal(event.dispatchedAt, null);

  const first = await events.worker.tick();
  assert.equal(first.dispatched, 1);
  assert.equal(first.succeeded, 1);
  assert.equal(await prisma.notification.count({ where: { userId: requesterId } }), 1);
  assert.equal((await prisma.notification.findFirstOrThrow({ where: { userId: requesterId } })).routeUrl,
    `/security/admin-governance?operationId=${source.id}`);

  assert.equal((await events.worker.tick()).claimed, 0);
  const restartedPrisma = createTestPrisma();
  try {
    assert.equal((await createEventServices(restartedPrisma, CONFIG).worker.tick()).claimed, 0);
  } finally {
    await restartedPrisma.$disconnect();
  }
  assert.equal(await prisma.notification.count({ where: { userId: requesterId } }), 1);

  const serializedEvidence = JSON.stringify({
    event: await prisma.eventLog.findUniqueOrThrow({ where: { id: event.id } }),
    delivery: await prisma.eventDelivery.findFirstOrThrow({ where: { eventId: event.id } }),
    logs: await prisma.eventHandlerLog.findMany({ where: { delivery: { eventId: event.id } } }),
    notifications: await prisma.notification.findMany({ where: { userId: requesterId } }),
  });
  for (const fixture of SECRET_FIXTURES) assert.equal(serializedEvidence.includes(fixture), false);
});

test('retry attempts 1-4 schedule, attempt 5 enters MANUAL, and target-bound Step-Up recovers once', async () => {
  const now = { value: new Date('2026-07-22T10:00:00.000Z') };
  const operationId = randomUUID();
  const event = await prisma.eventLog.create({ data: {
    eventType: EVENT_TYPE,
    eventVersion: 1,
    sourceModule: 'ADMIN_GOVERNANCE',
    objectType: 'ADMIN_OPERATION',
    objectId: operationId,
    orderingKey: 'a'.repeat(64),
    payload: {
      operationId,
      operationType: 'SYSTEM_ADMIN_GRANT',
      riskLevel: 'HIGH',
      decision: 'APPROVE',
      status: 'APPROVED',
      requesterUserId: requesterId,
      routeUrl: `/security/admin-governance?operationId=${operationId}`,
    },
    traceId: `spec007-retry-${randomUUID()}`,
    occurredAt: now.value,
    dispatchedAt: now.value,
  } });
  const subscription = await prisma.eventSubscription.findUniqueOrThrow({
    where: { code: 'admin-operation-reviewed-notification-v1' },
  });
  const delivery = await prisma.eventDelivery.create({ data: {
    eventId: event.id,
    subscriptionId: subscription.id,
    handlerCode: HANDLER_CODE,
    orderingKey: event.orderingKey,
  } });
  const retryRegistry = new EventHandlerRegistry();
  retryRegistry.register({
    handlerCode: HANDLER_CODE,
    eventType: EVENT_TYPE,
    eventVersion: 1,
    handler: { async handle() { throw new RetryableEventError('ACCEPTANCE_TRANSIENT'); } },
  });
  const retryWorker = new EventWorker({
    prisma,
    dispatcher: { async dispatchBatch() { return { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 }; } },
    registry: retryRegistry,
    health: new EventHealthService(false),
    deliveryStore: new EventDeliveryStore(prisma, { leaseSeconds: 60, now: () => now.value }),
    workerId: 'spec-007-acceptance-retry',
    config: CONFIG,
    now: () => now.value,
  });
  const expectedDelays = [15_000, 300_000, 3_600_000, 21_600_000];
  for (let index = 0; index < expectedDelays.length; index += 1) {
    assert.equal((await retryWorker.tick()).retryScheduled, 1);
    const state = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    assert.equal(state.attemptCount, index + 1);
    assert.equal(state.status, 'RETRY_WAIT');
    assert.equal(state.nextAttemptAt?.getTime(), now.value.getTime() + expectedDelays[index]);
    now.value = new Date(state.nextAttemptAt!.getTime());
  }
  assert.equal((await retryWorker.tick()).manual, 1);
  const manual = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(manual.attemptCount, 5);
  assert.equal(manual.status, 'MANUAL');

  const claims: ActiveSessionClaims = {
    userId: reviewerId,
    sessionId: 'spec-007-acceptance-session',
    credentialVersion: 1,
    assuranceLevel: 'MFA',
  };
  const consumeTargets: unknown[] = [];
  const productionEvents = createEventServices(prisma, CONFIG, { observability: OBSERVABILITY_CONFIG });
  const operations = new EventOperationsService({
    prisma,
    registry: productionEvents.registry,
    health: productionEvents.health,
    snapshotReader: productionEvents.snapshotReader,
    observability: OBSERVABILITY_CONFIG,
    workerEnabled: CONFIG.enabled,
    now: () => now.value,
    stepUp: {
      consume: async (tx, receivedClaims, purpose, target, token) => {
        assert.equal(receivedClaims.userId, reviewerId);
        assert.equal(purpose, 'EVENT_DELIVERY_RETRY');
        assert.equal(token, SECRET_FIXTURES[3]);
        assert.deepEqual(target, { deliveryId: delivery.id, expectedVersion: manual.version });
        consumeTargets.push(target);
        await tx.operationLog.create({ data: {
          userId: reviewerId,
          action: 'SPEC007_ACCEPTANCE_STEP_UP_CONSUMED',
          targetType: 'STEP_UP_GRANT',
          targetId: delivery.id,
        } });
      },
    },
  });
  await operations.retry(eventOperatorContext(), delivery.id, manual.version, {
    claims,
    token: SECRET_FIXTURES[3],
    ip: '127.0.0.1',
  });
  assert.equal(consumeTargets.length, 1);

  const successRegistry = new EventHandlerRegistry();
  successRegistry.register({
    handlerCode: HANDLER_CODE,
    eventType: EVENT_TYPE,
    eventVersion: 1,
    handler: {
      async handle(tx, context) {
        await tx.notification.createMany({ data: [{
          userId: requesterId,
          type: 'SYSTEM',
          title: '事件投递已恢复',
          content: '受控人工重试已成功',
          relatedId: operationId,
          routeUrl: `/security/admin-governance?operationId=${operationId}`,
          deduplicationKey: `spec007-acceptance:${context.eventId}`,
        }], skipDuplicates: true });
      },
    },
  });
  const successWorker = new EventWorker({
    prisma,
    dispatcher: { async dispatchBatch() { return { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 }; } },
    registry: successRegistry,
    health: new EventHealthService(false),
    deliveryStore: new EventDeliveryStore(prisma, { leaseSeconds: 60, now: () => now.value }),
    workerId: 'spec-007-acceptance-recovery',
    config: CONFIG,
    now: () => now.value,
  });
  assert.equal((await successWorker.tick()).succeeded, 1);
  assert.equal((await successWorker.tick()).claimed, 0);
  assert.equal((await prisma.eventDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status, 'SUCCEEDED');
  assert.equal(await prisma.notification.count({ where: { deduplicationKey: `spec007-acceptance:${event.id}` } }), 1);

  const serializedEvidence = JSON.stringify({
    delivery: await prisma.eventDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    logs: await prisma.eventHandlerLog.findMany({ where: { deliveryId: delivery.id } }),
    audit: await prisma.operationLog.findMany({ where: { targetId: delivery.id } }),
  });
  for (const fixture of SECRET_FIXTURES) assert.equal(serializedEvidence.includes(fixture), false);
});

test('rehearsal environment accepts only the exact local reset target with the automatic worker disabled', () => {
  const exactUrl = 'postgresql://localhost:55432/chengye_oa_test?schema=public';
  assert.throws(() => assertEventCenterRehearsalEnvironment({
    DATABASE_URL_TEST: exactUrl,
    DATABASE_URL: exactUrl,
    EVENT_WORKER_ENABLED: 'false',
  }), /guard/i);
  assert.throws(() => assertEventCenterRehearsalEnvironment({
    ALLOW_TEST_DB_RESET: 'true',
    DATABASE_URL_TEST: exactUrl.replace('chengye_oa_test', 'another_test'),
    DATABASE_URL: exactUrl.replace('chengye_oa_test', 'another_test'),
    EVENT_WORKER_ENABLED: 'false',
  }), /database/i);
  assert.throws(() => assertEventCenterRehearsalEnvironment({
    ALLOW_TEST_DB_RESET: 'true',
    DATABASE_URL_TEST: exactUrl,
    DATABASE_URL: exactUrl,
    EVENT_WORKER_ENABLED: 'true',
  }), /worker/i);
  for (const invalidUrl of [
    'postgresql://localhost/chengye_oa_test?schema=public',
    'postgresql://localhost:5432/chengye_oa_test?schema=public',
    'postgresql://127.0.0.1:55432/chengye_oa_test?schema=public',
    'postgresql://database.internal:55432/chengye_oa_test?schema=public',
  ]) {
    assert.throws(() => assertEventCenterRehearsalEnvironment({
      ALLOW_TEST_DB_RESET: 'true',
      DATABASE_URL_TEST: invalidUrl,
      DATABASE_URL: invalidUrl,
      EVENT_WORKER_ENABLED: 'false',
    }), /database/i, invalidUrl);
  }
  assert.throws(() => assertEventCenterRehearsalEnvironment({
    ALLOW_TEST_DB_RESET: 'true',
    DATABASE_URL_TEST: exactUrl,
    DATABASE_URL: `${exactUrl}&connection_limit=1`,
    EVENT_WORKER_ENABLED: 'false',
  }), /match/i);
  assert.throws(() => assertEventCenterRehearsalEnvironment({
    ALLOW_TEST_DB_RESET: 'true',
    DATABASE_URL_TEST: exactUrl,
    DATABASE_URL: exactUrl.replace('localhost', 'operator@localhost'),
    EVENT_WORKER_ENABLED: 'false',
  }), /match/i);
  assert.equal(assertEventCenterRehearsalEnvironment({
    ALLOW_TEST_DB_RESET: 'true',
    DATABASE_URL_TEST: exactUrl,
    DATABASE_URL: exactUrl,
    EVENT_WORKER_ENABLED: 'false',
  }).databaseName, 'chengye_oa_test');
});
