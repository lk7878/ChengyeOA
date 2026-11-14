import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Prisma, PrismaClient } from '@prisma/client';

import {
  AdminOperationReviewedNotificationHandler,
  ADMIN_OPERATION_REVIEWED_NOTIFICATION_HANDLER_CODE,
} from '../../app/application/events/handlers/admin-operation-reviewed-notification-handler';
import { EventHandlerContext } from '../../app/application/events/event-delivery-store';
import { PermanentEventError } from '../../app/domain/events/event-errors';
import { AdminOperationReviewedV1 } from '../../app/domain/events/event-types';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let prisma: PrismaClient;

async function createSource(overrides: Partial<{
  requesterUserId: string;
  operationType: string;
  riskLevel: string;
  status: string;
}> = {}) {
  const requesterUserId = overrides.requesterUserId ?? (await prisma.user.create({
    data: { username: `requester.${randomUUID()}`, password: 'unused' },
  })).id;
  return prisma.adminOperation.create({
    data: {
      operationNo: `GOV-${randomUUID()}`,
      operationType: overrides.operationType ?? 'SYSTEM_ADMIN_GRANT',
      riskLevel: overrides.riskLevel ?? 'HIGH',
      reviewMode: 'PRE',
      status: overrides.status ?? 'APPROVED',
      requesterUserId,
      targetType: 'USER',
      targetId: randomUUID(),
      reason: '绝不能进入通知的申请原因',
      payloadSnapshot: { secretTargetValue: '绝不能进入通知的目标值' },
      payloadHash: 'a'.repeat(64),
      expectedTargetVersion: 1,
      idempotencyKey: randomUUID(),
    },
  });
}

function contextFor(
  source: { id: string; requesterUserId: string; operationType: string; riskLevel: string },
  overrides: Partial<EventHandlerContext> & { payload?: unknown } = {},
): EventHandlerContext {
  const payload: AdminOperationReviewedV1 = {
    operationId: source.id,
    operationType: source.operationType as AdminOperationReviewedV1['operationType'],
    riskLevel: source.riskLevel as AdminOperationReviewedV1['riskLevel'],
    decision: 'APPROVE',
    status: 'APPROVED',
    requesterUserId: source.requesterUserId,
    routeUrl: `/security/admin-governance?operationId=${source.id}`,
  };
  return {
    deliveryId: randomUUID(),
    eventId: randomUUID(),
    handlerCode: ADMIN_OPERATION_REVIEWED_NOTIFICATION_HANDLER_CODE,
    orderingKey: createHash('sha256').update(`ADMIN_OPERATION:${source.id}`, 'utf8').digest('hex'),
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    payload: (overrides.payload ?? payload) as Prisma.JsonValue,
    traceId: `handler-test-${randomUUID()}`,
    attemptNumber: 1,
    workerId: 'handler-test-worker',
    ...overrides,
  };
}

async function handle(context: EventHandlerContext): Promise<void> {
  const handler = new AdminOperationReviewedNotificationHandler();
  await prisma.$transaction(tx => handler.handle(tx, context));
}

function expectedDeduplicationKey(context: EventHandlerContext, requesterUserId: string): string {
  return createHash('sha256')
    .update(`${context.eventId}${context.handlerCode}${requesterUserId}`, 'utf8')
    .digest('hex');
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => { await clearTestApplicationData(prisma); });
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('creates one bounded safe SYSTEM notification for the original requester', async () => {
  const source = await createSource();
  const context = contextFor(source);

  await handle(context);
  await handle(context);

  const notifications = await prisma.notification.findMany({ where: { userId: source.requesterUserId } });
  assert.equal(notifications.length, 1);
  const notification = notifications[0];
  assert.equal(notification.type, 'SYSTEM');
  assert.equal(notification.relatedType, 'ADMIN_OPERATION');
  assert.equal(notification.relatedId, source.id);
  assert.equal(notification.routeUrl, `/security/admin-governance?operationId=${source.id}`);
  assert.equal(notification.deduplicationKey, expectedDeduplicationKey(context, source.requesterUserId));
  assert.match(notification.deduplicationKey ?? '', /^[0-9a-f]{64}$/);
  assert.ok(notification.title.length <= 120);
  assert.ok(notification.content.length <= 1000);
  assert.match(notification.title, /审核通过/);
  assert.match(notification.content, /系统管理员授权.*已批准/);
  assert.doesNotMatch(
    JSON.stringify(notification),
    /申请原因|目标值|reason|comment|payload|secretTargetValue/i,
  );
});

test('uses code-owned Chinese labels for every approved review decision contract', async () => {
  const cases = [
    { decision: 'APPROVE', status: 'APPROVED', decisionLabel: '审核通过', statusLabel: '已批准' },
    { decision: 'REJECT', status: 'REJECTED', decisionLabel: '审核驳回', statusLabel: '已拒绝' },
    { decision: 'CONFIRM', status: 'CONFIRMED', decisionLabel: '复核确认', statusLabel: '已确认' },
    { decision: 'FLAG', status: 'FLAGGED', decisionLabel: '复核标记', statusLabel: '已标记' },
  ] as const;

  for (const item of cases) {
    const source = await createSource({ status: item.status });
    const base = contextFor(source);
    const payload = { ...(base.payload as object), decision: item.decision, status: item.status };
    await handle({ ...base, payload: payload as Prisma.JsonValue });
    const notification = await prisma.notification.findUniqueOrThrow({
      where: { deduplicationKey: expectedDeduplicationKey(base, source.requesterUserId) },
    });
    assert.match(notification.title, new RegExp(item.decisionLabel));
    assert.match(notification.content, new RegExp(item.statusLabel));
  }
});

test('revalidates context and payload and maps every invalid source to a permanent safe code', async () => {
  const source = await createSource();
  const base = contextFor(source);
  const cases: EventHandlerContext[] = [
    { ...base, handlerCode: 'OTHER_HANDLER' },
    { ...base, eventType: 'admin.operation.other' },
    { ...base, eventVersion: 2 },
    { ...base, payload: { ...(base.payload as object), comment: 'private review comment' } as Prisma.JsonValue },
    { ...base, payload: { ...(base.payload as object), operationId: randomUUID() } as Prisma.JsonValue },
    { ...base, payload: { ...(base.payload as object), requesterUserId: randomUUID() } as Prisma.JsonValue },
    { ...base, payload: { ...(base.payload as object), operationType: 'ADMIN_MFA_RESET' } as Prisma.JsonValue },
    { ...base, payload: { ...(base.payload as object), riskLevel: 'CRITICAL' } as Prisma.JsonValue },
  ];

  for (const invalid of cases) {
    await assert.rejects(
      handle(invalid),
      (error: unknown) => error instanceof PermanentEventError
        && error.code === 'GOVERNANCE_SOURCE_INVALID'
        && error.message === 'GOVERNANCE_SOURCE_INVALID',
    );
  }
  assert.equal(await prisma.notification.count(), 0);
});

test('rejects an ordering key that differs from the Task 1 derived identity', async () => {
  const source = await createSource();
  const context = { ...contextFor(source), orderingKey: 'f'.repeat(64) };

  await assert.rejects(
    handle(context),
    (error: unknown) => error instanceof PermanentEventError
      && error.code === 'GOVERNANCE_SOURCE_INVALID',
  );
  assert.equal(await prisma.notification.count({ where: { userId: source.requesterUserId } }), 0);
});

for (const mismatch of [
  { name: 'userId', data: (source: Awaited<ReturnType<typeof createSource>>) => ({ userId: randomUUID(), type: 'SYSTEM', routeUrl: `/security/admin-governance?operationId=${source.id}` }) },
  { name: 'type', data: (source: Awaited<ReturnType<typeof createSource>>) => ({ userId: source.requesterUserId, type: 'TASK', routeUrl: `/security/admin-governance?operationId=${source.id}` }) },
  { name: 'routeUrl', data: (source: Awaited<ReturnType<typeof createSource>>) => ({ userId: source.requesterUserId, type: 'SYSTEM', routeUrl: '/private/wrong-route' }) },
]) {
  test(`rejects a deduplication collision with mismatched ${mismatch.name} without overwrite`, async () => {
    const source = await createSource();
    const context = contextFor(source);
    const key = expectedDeduplicationKey(context, source.requesterUserId);
    const conflicting = await prisma.notification.create({
      data: {
        ...mismatch.data(source),
        title: 'preexisting title',
        content: 'preexisting content',
        deduplicationKey: key,
      },
    });

    await assert.rejects(
      handle(context),
      (error: unknown) => error instanceof PermanentEventError
        && error.code === 'NOTIFICATION_DEDUPLICATION_CONFLICT',
    );

    assert.deepEqual(
      await prisma.notification.findUniqueOrThrow({ where: { id: conflicting.id } }),
      conflicting,
    );
    assert.equal(await prisma.notification.count({ where: { deduplicationKey: key } }), 1);
  });
}

test('two concurrent transactions create exactly one notification without an aborted-transaction query', async () => {
  const secondPrisma = createTestPrisma();
  try {
    const source = await createSource();
    const context = contextFor(source);
    const firstHandler = new AdminOperationReviewedNotificationHandler();
    const secondHandler = new AdminOperationReviewedNotificationHandler();

    await Promise.all([
      prisma.$transaction(tx => firstHandler.handle(tx, context)),
      secondPrisma.$transaction(tx => secondHandler.handle(tx, context)),
    ]);

    assert.equal(await prisma.notification.count({
      where: { deduplicationKey: expectedDeduplicationKey(context, source.requesterUserId) },
    }), 1);
  } finally {
    await secondPrisma.$disconnect();
  }
});

test('waits for a concurrent source mutation and rejects the committed mismatch atomically', async () => {
  const mutatingPrisma = createTestPrisma();
  const monitoringPrisma = createTestPrisma();
  const sourceLocked = deferred();
  const releaseMutation = deferred();
  let reportHandlerBackend!: (pid: number) => void;
  const handlerBackend = new Promise<number>(resolve => { reportHandlerBackend = resolve; });
  let handlerSettled = false;
  try {
    const source = await createSource();
    const context = contextFor(source);
    const mutation = mutatingPrisma.$transaction(async tx => {
      await tx.adminOperation.update({ where: { id: source.id }, data: { riskLevel: 'CRITICAL' } });
      sourceLocked.resolve();
      await releaseMutation.promise;
    });
    await sourceLocked.promise;

    const handler = new AdminOperationReviewedNotificationHandler();
    const outcome = prisma.$transaction(async tx => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      reportHandlerBackend(backend.pid);
      await handler.handle(tx, context);
      return backend.pid;
    }).then(
      pid => ({ kind: 'resolved' as const, pid }),
      error => ({ kind: 'rejected' as const, error }),
    ).finally(() => { handlerSettled = true; });
    const handlerPid = await handlerBackend;

    for (let turn = 0; turn < 100 && !handlerSettled; turn += 1) {
      const activity = await monitoringPrisma.$queryRaw<Array<{ waitEventType: string | null }>>`
        SELECT wait_event_type AS "waitEventType" FROM pg_stat_activity WHERE pid = ${handlerPid}
      `;
      if (activity[0]?.waitEventType === 'Lock') break;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    releaseMutation.resolve();
    await mutation;
    const result = await outcome;

    assert.equal(result.kind, 'rejected');
    if (result.kind === 'rejected') {
      assert.ok(result.error instanceof PermanentEventError);
      assert.equal(result.error.code, 'GOVERNANCE_SOURCE_INVALID');
    }
    assert.equal(await prisma.notification.count({ where: { userId: source.requesterUserId } }), 0);
  } finally {
    releaseMutation.resolve();
    await mutatingPrisma.$disconnect();
    await monitoringPrisma.$disconnect();
  }
});
