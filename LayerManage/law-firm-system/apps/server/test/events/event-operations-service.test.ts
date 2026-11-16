import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Prisma, PrismaClient } from '@prisma/client';

import { EventOperationsService } from '../../app/application/events/event-operations-service';
import { createEventServices } from '../../app/application/events/event-services-factory';
import type { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import type { ActiveSessionClaims } from '../../app/application/auth/session-service';
import type { EventRuntimeSnapshot } from '../../app/domain/events/event-observability';
import type { StepUpPurpose } from '../../app/domain/security/step-up-target';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const NOW = new Date('2026-07-22T12:00:00.000Z');
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

function runtimeSnapshot(overrides: Partial<EventRuntimeSnapshot> = {}): EventRuntimeSnapshot {
  return {
    evaluatedAt: new Date(NOW),
    undispatchedCount: 0,
    oldestUndispatchedSeconds: 0,
    dueBacklogCount: 0,
    oldestDueBacklogSeconds: 0,
    manualCount: 0,
    unresolvedDispatcherFaultCount: 0,
    processingCount: 0,
    expiredProcessingCount: 0,
    staleExpiredProcessingCount: 0,
    leaseLost15mCount: 0,
    workerConfiguredEnabled: false,
    workerState: 'DISABLED',
    workerProcessStartedAt: new Date(NOW),
    lastHeartbeatAt: null,
    lastSuccessfulTickAt: null,
    consecutiveDatabaseFailures: 0,
    ...overrides,
  };
}

let prisma: PrismaClient;
let actorUserId: string;

const claims: ActiveSessionClaims = {
  userId: 'replaced-before-use',
  sessionId: 'session:event-operations',
  credentialVersion: 1,
  assuranceLevel: 'MFA',
};

function authorization(input: {
  superAdmin?: boolean;
  permissions?: AuthorizationContext['permissionCodes'];
} = {}): AuthorizationContext {
  return {
    userId: actorUserId,
    employeeId: null,
    isSystemSuperAdmin: input.superAdmin ?? true,
    isSystemAdmin: !(input.superAdmin ?? true),
    grants: [],
    fieldRules: [],
    permissionCodes: input.permissions ?? ['event.delivery.read', 'event.delivery.retry'],
    evaluatedAt: NOW,
  };
}

interface ConsumeCall {
  purpose: StepUpPurpose;
  target: unknown;
  token: string;
}

function service(
  client = prisma,
  calls: ConsumeCall[] = [],
  auditWriter?: (tx: Prisma.TransactionClient, input: Prisma.OperationLogCreateInput) => Promise<void>,
) {
  const events = createEventServices(client, CONFIG, { observability: OBSERVABILITY_CONFIG });
  return new EventOperationsService({
    prisma: client,
    registry: events.registry,
    health: events.health,
    snapshotReader: events.snapshotReader,
    observability: OBSERVABILITY_CONFIG,
    workerEnabled: CONFIG.enabled,
    now: () => new Date(NOW),
    stepUp: {
      consume: async (
        _tx: Prisma.TransactionClient,
        _claims: ActiveSessionClaims,
        purpose: StepUpPurpose,
        target: unknown,
        token: string,
      ) => { calls.push({ purpose, target, token }); },
    },
    auditWriter,
  });
}

async function createDelivery(input: {
  status?: 'PENDING' | 'RETRY_WAIT' | 'PROCESSING' | 'MANUAL' | 'SUCCEEDED';
  version?: number;
  createdAt?: Date;
  objectId?: string;
  errorText?: string;
} = {}) {
  const operationId = input.objectId ?? randomUUID();
  const requesterUserId = randomUUID();
  const payload = {
    operationId,
    operationType: 'MASTER_DATA_STATUS_CORRECTION',
    riskLevel: 'HIGH',
    decision: 'APPROVE',
    status: 'APPROVED',
    requesterUserId,
    routeUrl: `/security/admin-governance?operationId=${operationId}`,
  };
  const event = await prisma.eventLog.create({ data: {
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    sourceModule: 'ADMIN_GOVERNANCE',
    objectType: 'ADMIN_OPERATION',
    objectId: operationId,
    orderingKey: 'a'.repeat(64),
    payload,
    traceId: `trace-${randomUUID()}`,
    occurredAt: input.createdAt ?? NOW,
    createdAt: input.createdAt ?? NOW,
  } });
  const status = input.status ?? 'MANUAL';
  const delivery = await prisma.eventDelivery.create({ data: {
    eventId: event.id,
    subscriptionId: 'subscription:admin-operation-reviewed-notification-v1',
    handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
    orderingKey: event.orderingKey,
    status,
    version: input.version ?? 7,
    attemptCount: status === 'MANUAL' ? 5 : status === 'SUCCEEDED' ? 1 : 0,
    lastErrorCode: status === 'MANUAL' ? 'EVENT_HANDLER_UNKNOWN' : null,
    lastErrorReference: status === 'MANUAL' ? input.errorText ?? 'safe-reference' : null,
    startedAt: status === 'MANUAL' || status === 'SUCCEEDED' ? new Date(NOW.getTime() - 5_000) : null,
    completedAt: status === 'SUCCEEDED' ? NOW : null,
    createdAt: input.createdAt ?? NOW,
    updatedAt: input.createdAt ?? NOW,
  } });
  if (status === 'MANUAL' || status === 'SUCCEEDED') {
    await prisma.eventHandlerLog.create({ data: {
      deliveryId: delivery.id,
      attemptNumber: 1,
      workerId: 'secret-worker-instance',
      outcome: status === 'SUCCEEDED' ? 'SUCCEEDED' : 'MANUAL_REQUIRED',
      errorCode: status === 'MANUAL' ? 'EVENT_HANDLER_UNKNOWN' : null,
      errorReference: status === 'MANUAL' ? 'handler-safe-reference' : null,
      durationMs: 10,
      startedAt: new Date(NOW.getTime() - 5_000),
      completedAt: NOW,
    } });
  }
  return { event, delivery, payload };
}

function hasCode(code: string) {
  return (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  actorUserId = (await prisma.user.create({ data: {
    username: `event.operator.${randomUUID()}`,
    password: 'unused',
  } })).id;
  claims.userId = actorUserId;
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('returns bounded summaries, strict filtered pages, and safe subscription views', async () => {
  const pending = await createDelivery({ status: 'PENDING', createdAt: new Date(NOW.getTime() - 10_000) });
  await createDelivery({ status: 'SUCCEEDED', createdAt: new Date(NOW.getTime() - 5_000) });
  await createDelivery({ status: 'MANUAL', createdAt: new Date(NOW.getTime() - 2_000) });

  const operations = service();
  const summary = await operations.summary(authorization());
  assert.deepEqual(summary.counts, {
    PENDING: 1, RETRY_WAIT: 0, PROCESSING: 0, MANUAL: 1, SUCCEEDED: 1,
  });
  assert.equal(summary.recent24Hours.total, 3);
  assert.equal(summary.recent24Hours.succeeded, 1);
  assert.equal(summary.longestBacklogSeconds, 10);
  assert.equal('workerId' in summary.worker, false);

  const page = await operations.list(authorization(), {
    page: '1', pageSize: '200', status: 'PENDING',
    eventType: 'admin.operation.reviewed',
    handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
    objectType: 'ADMIN_OPERATION', objectId: pending.event.objectId,
    from: '2026-07-22T11:59:00.000Z', to: '2026-07-22T12:01:00.000Z',
    sortBy: 'createdAt', sortOrder: 'asc',
  });
  assert.equal(page.pagination.pageSize, 200);
  assert.equal(page.list.length, 1);
  assert.equal(page.list[0].id, pending.delivery.id);
  assert.doesNotMatch(JSON.stringify(page), /payload|lockedBy|workerId|secret-worker-instance/i);
  await assert.rejects(
    () => operations.list(authorization(), { pageSize: '201' }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
  await assert.rejects(
    () => operations.list(authorization(), { status: 'BROKEN' }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
  await assert.rejects(
    () => operations.list(authorization(), { from: '2026-07-22', to: '2026-07-22T12:00:00Z' }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
  await assert.rejects(
    () => operations.list(authorization(), { sortBy: 'lockedBy' }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
  await assert.rejects(
    () => operations.list(authorization(), { extra: 'not-allowed' }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );

  const subscriptions = await operations.subscriptions(authorization());
  assert.equal(subscriptions.length, 7);
  const byCode = (code: string) => subscriptions.find(item => item.code === code);
  const governance = byCode('admin-operation-reviewed-notification-v1');
  const quarantine = byCode('event-dispatch-quarantine-v1');
  const pilot = byCode('lead-first-response-monitor-v1');
  const assessment = byCode('quality-assessment-analysis-v1');
  const sopReminder = byCode('sop-reminder-notification-v1');
  const sopChange = byCode('sop-change-notification-v1');
  const qualityChange = byCode('quality-change-notification-v1');
  assert.deepEqual(quarantine?.filterSummary, { mode: 'ALL' });
  assert.equal(governance?.status, 'ENABLED');
  assert.equal(quarantine?.status, 'DISABLED');
  assert.equal(pilot?.status, 'ENABLED');
  assert.equal(assessment?.status, 'ENABLED');
  assert.equal(sopReminder?.status, 'ENABLED');
  assert.equal(sopChange?.status, 'ENABLED');
  assert.equal(qualityChange?.status, 'ENABLED');
  assert.equal(subscriptions.filter(item => item.internal).length, 1);
  assert.equal(quarantine?.internal, true);
  assert.doesNotMatch(JSON.stringify(subscriptions), /filterJson|handler\W|constructor/i);
});

test('adds a READY preflight observability evaluation without changing existing summary fields', async () => {
  await createDelivery({ status: 'PENDING', createdAt: new Date(NOW.getTime() - 10_000) });
  await createDelivery({ status: 'SUCCEEDED', createdAt: new Date(NOW.getTime() - 5_000) });
  const events = createEventServices(prisma, CONFIG);
  const readHealthFailures: number[] = [];
  const operations = new EventOperationsService({
    prisma,
    registry: events.registry,
    health: events.health,
    stepUp: { consume: async () => undefined },
    now: () => new Date(NOW),
    snapshotReader: {
      read: async workerHealth => {
        readHealthFailures.push(workerHealth?.consecutiveDatabaseFailures ?? -1);
        return runtimeSnapshot({
          consecutiveDatabaseFailures: workerHealth?.consecutiveDatabaseFailures ?? null,
        });
      },
    },
    observability: OBSERVABILITY_CONFIG,
    workerEnabled: false,
  });

  const summary = await operations.summary(authorization());

  assert.deepEqual(summary.counts, {
    PENDING: 1, RETRY_WAIT: 0, PROCESSING: 0, MANUAL: 0, SUCCEEDED: 1,
  });
  assert.deepEqual(summary.recent24Hours, { total: 2, succeeded: 1, successRate: 0.5 });
  assert.equal(summary.longestBacklogSeconds, 10);
  assert.equal(summary.worker.workerEnabled, false);
  assert.deepEqual(readHealthFailures, [0]);
  assert.deepEqual(summary.observability, {
    status: 'READY',
    mode: 'preflight',
    evaluatedAt: NOW,
    metrics: {
      undispatchedCount: 0,
      oldestUndispatchedSeconds: 0,
      dueBacklogCount: 0,
      oldestDueBacklogSeconds: 0,
      manualCount: 0,
      processingCount: 0,
      expiredProcessingCount: 0,
      staleExpiredProcessingCount: 0,
      leaseLost15mCount: 0,
      lastSuccessfulTickAt: null,
      lastHeartbeatAt: null,
    },
    alerts: [],
  });
});

test('derives canary mode from configuration and evaluates same-process database failures', async () => {
  const events = createEventServices(prisma, CONFIG);
  events.health.recordDatabaseFailure(new Date(NOW.getTime() - 3_000));
  events.health.recordDatabaseFailure(new Date(NOW.getTime() - 2_000));
  events.health.recordDatabaseFailure(new Date(NOW.getTime() - 1_000));
  const operations = new EventOperationsService({
    prisma,
    registry: events.registry,
    health: events.health,
    stepUp: { consume: async () => undefined },
    now: () => new Date(NOW),
    snapshotReader: {
      read: async workerHealth => runtimeSnapshot({
        workerConfiguredEnabled: true,
        workerState: 'RUNNING',
        lastHeartbeatAt: new Date(NOW),
        lastSuccessfulTickAt: new Date(NOW),
        consecutiveDatabaseFailures: workerHealth?.consecutiveDatabaseFailures ?? null,
      }),
    },
    observability: OBSERVABILITY_CONFIG,
    workerEnabled: true,
  });

  const summary = await operations.summary(authorization());

  assert.equal(summary.observability.mode, 'canary');
  assert.equal(summary.observability.status, 'BLOCKED');
  assert.deepEqual(summary.observability.alerts, [{
    code: 'EVENT_OBS_DATABASE_FAILURES',
    severity: 'BLOCKED',
    value: 3,
    threshold: 3,
  }]);
});

test('rejects unauthorized summaries before a failing observability reader is reached', async () => {
  const events = createEventServices(prisma, CONFIG, { observability: OBSERVABILITY_CONFIG });
  let readerCalls = 0;
  const operations = new EventOperationsService({
    prisma,
    registry: events.registry,
    health: events.health,
    stepUp: { consume: async () => undefined },
    snapshotReader: {
      read: async () => {
        readerCalls += 1;
        throw new Prisma.PrismaClientInitializationError('unsafe-reader-marker', 'test-client');
      },
    },
    observability: OBSERVABILITY_CONFIG,
    workerEnabled: CONFIG.enabled,
  });

  await assert.rejects(
    () => operations.summary(authorization({ superAdmin: false, permissions: [] })),
    hasCode('PERMISSION_DENIED'),
  );
  assert.equal(readerCalls, 0);
});

test('combines persistent dispatcher MANUAL faults with worker health until configuration recovery and retry', async () => {
  const events = createEventServices(prisma, CONFIG);
  await prisma.eventSubscription.update({
    where: { code: 'admin-operation-reviewed-notification-v1' },
    data: { handlerCode: 'UNKNOWN_FOR_HEALTH' },
  });
  const operationId = randomUUID();
  await prisma.$transaction(tx => events.outboxWriter.append(tx, {
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    objectType: 'ADMIN_OPERATION',
    objectId: operationId,
    operatorUserId: null,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: {
      operationId,
      operationType: 'SYSTEM_ADMIN_GRANT',
      riskLevel: 'HIGH',
      decision: 'REJECT',
      status: 'REJECTED',
      requesterUserId: actorUserId,
      routeUrl: `/security/admin-governance?operationId=${operationId}`,
    },
    traceId: randomUUID(),
    occurredAt: NOW,
  }));
  await events.dispatcher.dispatchBatch(25);
  events.health.recordSuccessfulTick(NOW);
  const manual = await prisma.eventDelivery.findFirstOrThrow({ where: { status: 'MANUAL' } });

  const restartedPrisma = createTestPrisma();
  try {
    const restartedEvents = createEventServices(restartedPrisma, CONFIG, { observability: OBSERVABILITY_CONFIG });
    const operations = new EventOperationsService({
      prisma: restartedPrisma,
      registry: restartedEvents.registry,
      health: restartedEvents.health,
      snapshotReader: restartedEvents.snapshotReader,
      observability: OBSERVABILITY_CONFIG,
      workerEnabled: CONFIG.enabled,
      now: () => new Date(NOW),
      stepUp: { consume: async () => undefined },
    });
    const degraded = await operations.summary(authorization());

    assert.equal(degraded.worker.status, 'degraded');
    assert.equal(degraded.worker.consecutiveDatabaseFailures, 0);
    assert.equal(degraded.worker.unresolvedDispatcherFaultCount, 1);
    assert.equal(degraded.worker.unknownHandlerCount, 1);
    assert.equal(degraded.worker.invalidFilterCount, 0);
    assert.equal(degraded.worker.invalidEnvelopeCount, 0);
    assert.equal(degraded.worker.lastErrorCode, 'HANDLER_NOT_REGISTERED');
    assert.equal(degraded.worker.lastErrorReference, manual.lastErrorReference);
    assert.doesNotMatch(JSON.stringify(degraded.worker), /UNKNOWN_FOR_HEALTH|operationType|routeUrl|payload/i);

    await restartedPrisma.eventSubscription.update({
      where: { code: 'admin-operation-reviewed-notification-v1' },
      data: { handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION' },
    });
    await operations.retry(authorization(), manual.id, manual.version, {
      claims: { ...claims, userId: actorUserId },
      token: 'opaque-test-token',
    });
    const recovered = await operations.summary(authorization());
    assert.equal(recovered.worker.status, 'healthy');
    assert.equal(recovered.worker.unresolvedDispatcherFaultCount, 0);
    assert.equal(recovered.worker.lastErrorCode, null);
    assert.equal(recovered.worker.lastErrorReference, null);
  } finally {
    await restartedPrisma.$disconnect();
  }
});

test('refuses public retry for internal quarantine and preserves durable degraded health', async () => {
  const events = createEventServices(prisma, CONFIG);
  const event = await prisma.eventLog.create({ data: {
    eventType: 'unknown.event.for.quarantine',
    eventVersion: 1,
    sourceModule: 'UNKNOWN_SOURCE',
    objectType: 'ADMIN_OPERATION',
    objectId: randomUUID(),
    orderingKey: 'c'.repeat(64),
    payload: { opaque: 'must-not-escape' },
    traceId: randomUUID(),
    occurredAt: NOW,
  } });
  assert.deepEqual(await events.dispatcher.dispatchBatch(25), {
    dispatchedCount: 0,
    deliveryCount: 1,
    manualCount: 1,
  });
  const quarantine = await prisma.eventDelivery.findFirstOrThrow({
    where: { eventId: event.id, handlerCode: 'EVENT_DISPATCH_QUARANTINE' },
  });
  const calls: ConsumeCall[] = [];
  const operations = service(prisma, calls);

  await assert.rejects(
    () => operations.retry(authorization(), quarantine.id, quarantine.version, {
      claims: { ...claims, userId: actorUserId },
      token: 'opaque-test-token',
    }),
    hasCode('EVENT_DELIVERY_QUARANTINED'),
  );
  assert.equal(calls.length, 0);
  const unchanged = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: quarantine.id } });
  assert.equal(unchanged.status, 'MANUAL');
  assert.equal(unchanged.version, 1);
  assert.equal((await prisma.eventLog.findUniqueOrThrow({ where: { id: event.id } })).dispatchedAt, null);
  const summary = await operations.summary(authorization());
  assert.equal(summary.worker.status, 'degraded');
  assert.equal(summary.worker.invalidEnvelopeCount, 1);
  assert.equal(summary.worker.unresolvedDispatcherFaultCount, 1);
  assert.equal(await prisma.eventHandlerLog.count({ where: { deliveryId: quarantine.id } }), 0);
  assert.equal(await prisma.notification.count(), 0);
});

test('returns only registry-approved payload scalars and safe delivery attempt fields', async () => {
  const { delivery } = await createDelivery({ errorText: 'raw failure must never escape' });

  const detail = await service().detail(authorization(), delivery.id);
  assert.deepEqual(Object.keys(detail.payloadSummary).sort(), [
    'operationId', 'operationType', 'riskLevel', 'status',
  ]);
  assert.deepEqual(Object.keys(detail.attempts[0]).sort(), [
    'attemptNumber', 'completedAt', 'durationMs', 'errorCode', 'errorReference', 'outcome', 'startedAt',
  ]);
  const serialized = JSON.stringify(detail);
  assert.doesNotMatch(serialized, /lockedBy|lockedUntil|orderingKey|workerId|secret-worker-instance/i);
  assert.equal(serialized.includes('raw failure must never escape'), false);
  assert.equal(serialized.includes('requesterUserId'), false);
  assert.equal(serialized.includes('routeUrl'), false);
  assert.equal(detail.attemptsTotal, 1);
  assert.equal(detail.attemptsTruncated, false);
});

test('bounds detail to the newest 200 attempts with deterministic chronological presentation', async () => {
  const { delivery } = await createDelivery();
  await prisma.eventHandlerLog.createMany({ data: Array.from({ length: 204 }, (_, index) => {
    const attemptNumber = index + 2;
    return {
      deliveryId: delivery.id,
      attemptNumber,
      workerId: `private-worker-${attemptNumber}`,
      outcome: 'MANUAL_REQUIRED',
      errorCode: 'EVENT_HANDLER_UNKNOWN',
      errorReference: `raw failure ${attemptNumber}`,
      durationMs: attemptNumber,
      startedAt: new Date(NOW.getTime() + attemptNumber * 1_000),
      completedAt: new Date(NOW.getTime() + attemptNumber * 1_000 + 10),
    };
  }) });

  const detail = await service().detail(authorization(), delivery.id);
  assert.equal(detail.attemptsTotal, 205);
  assert.equal(detail.attemptsTruncated, true);
  assert.equal(detail.attempts.length, 200);
  assert.equal(detail.attempts[0].attemptNumber, 6);
  assert.equal(detail.attempts[199].attemptNumber, 205);
  assert.deepEqual(
    detail.attempts.map(attempt => attempt.attemptNumber),
    Array.from({ length: 200 }, (_, index) => index + 6),
  );
  assert.doesNotMatch(JSON.stringify(detail), /private-worker|raw failure|workerId/i);
});

test('allows filtering stable unknown handler evidence without trusting arbitrary handler text', async () => {
  const { delivery } = await createDelivery();
  await prisma.eventDelivery.update({
    where: { id: delivery.id },
    data: { handlerCode: 'UNKNOWN_HANDLER_CODE' },
  });

  const page = await service().list(authorization(), { handlerCode: 'UNKNOWN_HANDLER_CODE' });
  assert.equal(page.list.length, 1);
  assert.equal(page.list[0].handlerCode, 'UNKNOWN_HANDLER_CODE');
  await assert.rejects(
    () => service().list(authorization(), { handlerCode: 'not a stable code' }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
});

test('accepts canonical UTC bounds and rejects normalized calendar/time values', async () => {
  const operations = service();
  for (const value of [
    '2028-02-29T12:00:00Z',
    '2028-02-29T12:00:00.1Z',
    '2028-02-29T12:00:00.12Z',
    '2028-02-29T12:00:00.123Z',
  ]) {
    const result = await operations.list(authorization(), { from: value, to: value });
    assert.equal(result.pagination.pageSize, 20);
  }

  for (const value of [
    '2026-02-29T12:00:00Z',
    '2026-02-30T12:00:00Z',
    '2026-13-01T12:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T12:60:00Z',
    '2026-01-01T12:00:60Z',
  ]) {
    await assert.rejects(
      () => operations.list(authorization(), { from: value }),
      hasCode('AUTHORIZATION_INPUT_INVALID'),
      value,
    );
  }
  await assert.rejects(
    () => operations.list(authorization(), {
      from: '2026-07-22T12:00:00.001Z',
      to: '2026-07-22T12:00:00.000Z',
    }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
});

test('requires effective super-admin and requeues MANUAL with audit but without Step-Up', async () => {
  const calls: ConsumeCall[] = [];
  const { delivery, event, payload } = await createDelivery({ errorText: 'private raw exception' });
  const operations = service(prisma, calls);

  await assert.rejects(
    () => operations.retry(
      authorization({ superAdmin: false }), delivery.id, delivery.version,
      { claims, ip: '127.0.0.1' },
    ),
    hasCode('SPECIAL_PERMISSION_REQUIRED'),
  );
  assert.equal(calls.length, 0);

  const result = await operations.retry(
    authorization(), delivery.id, delivery.version,
    { claims, ip: '127.0.0.1' },
  );
  assert.deepEqual(result, { id: delivery.id, status: 'PENDING', version: delivery.version + 1 });
  assert.deepEqual(calls, []);

  const updated = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(updated.status, 'PENDING');
  assert.equal(updated.manualRetryCount, 1);
  assert.equal(updated.version, delivery.version + 1);
  assert.equal(updated.attemptCount, delivery.attemptCount);
  assert.equal(updated.lastErrorCode, null);
  assert.equal(updated.lastErrorReference, null);
  assert.equal(updated.nextAttemptAt, null);
  assert.equal(updated.lockedBy, null);
  assert.equal(updated.lockedUntil, null);
  assert.equal(updated.startedAt, null);
  assert.equal(updated.completedAt, null);

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { action: 'EVENT_DELIVERY_MANUAL_RETRY', targetId: delivery.id },
  });
  assert.equal(audit.userId, actorUserId);
  assert.equal(audit.targetType, 'EVENT_DELIVERY');
  assert.deepEqual(JSON.parse(audit.newValues ?? ''), {
    deliveryId: delivery.id,
    eventType: event.eventType,
    handlerCode: delivery.handlerCode,
    attemptCount: delivery.attemptCount,
    version: delivery.version + 1,
  });
  assert.doesNotMatch(`${audit.oldValues}${audit.newValues}`, new RegExp([
    payload.requesterUserId, 'private raw exception', 'one-time-step-up',
  ].join('|')));
});

test('serializes concurrent retry attempts so exactly one version-bound request succeeds', async () => {
  const { delivery } = await createDelivery();
  const secondClient = createTestPrisma();
  const first = service(prisma);
  const second = service(secondClient);
  try {
    const results = await Promise.allSettled([
      first.retry(authorization(), delivery.id, delivery.version, { claims, token: 'first' }),
      second.retry(authorization(), delivery.id, delivery.version, { claims, token: 'second' }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected');
    assert.equal(hasCode('VERSION_CONFLICT')(rejected.reason), true);
    assert.equal(await prisma.operationLog.count({
      where: { action: 'EVENT_DELIVERY_MANUAL_RETRY', targetId: delivery.id },
    }), 1);
    assert.equal((await prisma.eventDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).version, 8);
  } finally {
    await secondClient.$disconnect();
  }
});

test('rejects an authorization/session actor mismatch before consuming or mutating', async () => {
  const calls: ConsumeCall[] = [];
  const { delivery } = await createDelivery();

  await assert.rejects(
    () => service(prisma, calls).retry(authorization(), delivery.id, delivery.version, {
      claims: { ...claims, userId: randomUUID() },
      token: 'different-actor-token',
    }),
    hasCode('AUTHENTICATION_REQUIRED'),
  );
  assert.equal(calls.length, 0);
  assert.equal((await prisma.eventDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status, 'MANUAL');
});

test('rolls back delivery changes when the manual retry audit fails', async () => {
  const { delivery } = await createDelivery();
  const events = createEventServices(prisma, CONFIG);
  const operations = new EventOperationsService({
    prisma,
    registry: events.registry,
    health: events.health,
    snapshotReader: events.snapshotReader,
    observability: OBSERVABILITY_CONFIG,
    workerEnabled: CONFIG.enabled,
    now: () => new Date(NOW),
    stepUp: {
      consume: async tx => {
        await tx.operationLog.create({ data: {
          userId: actorUserId,
          action: 'TEST_STEP_UP_CONSUMED',
          targetType: 'STEP_UP_GRANT',
          targetId: 'test-grant',
        } });
      },
    },
    auditWriter: async () => { throw new Error('audit unavailable'); },
  });

  await assert.rejects(
    () => operations.retry(authorization(), delivery.id, delivery.version, { claims, token: 'token' }),
    /audit unavailable/,
  );
  const unchanged = await prisma.eventDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(unchanged.status, 'MANUAL');
  assert.equal(unchanged.version, delivery.version);
  assert.equal(unchanged.manualRetryCount, 0);
  assert.equal(await prisma.operationLog.count({ where: { action: 'TEST_STEP_UP_CONSUMED' } }), 0);
  assert.equal(await prisma.operationLog.count({ where: { action: 'EVENT_DELIVERY_MANUAL_RETRY' } }), 0);
});
