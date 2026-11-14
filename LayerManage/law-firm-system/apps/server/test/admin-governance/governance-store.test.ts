import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { GovernanceStore } from '../../app/application/admin-governance/governance-store';
import { hashPayload } from '../../app/domain/admin-governance/canonical-json';
import { GovernanceError } from '../../app/domain/admin-governance/governance-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let prisma: PrismaClient;

function createStore(): GovernanceStore {
  return new GovernanceStore(prisma);
}

async function createUser(): Promise<string> {
  const suffix = randomUUID();
  return prisma.user.create({
    data: { username: `governance.store.${suffix}`, password: 'unused', status: 'ENABLED' },
    select: { id: true },
  }).then(user => user.id);
}

function operationInput(requesterUserId: string, idempotencyKey = 'request-1') {
  const payloadSnapshot = { targetUserId: 'target-1', validUntil: null as string | null };
  return {
    operationType: 'SYSTEM_ADMIN_GRANT' as const,
    riskLevel: 'HIGH' as const,
    reviewMode: 'PRE' as const,
    status: 'PENDING_REVIEW' as const,
    requesterUserId,
    targetType: 'USER',
    targetId: 'target-1',
    reason: '申请系统管理员授权用于治理测试',
    payloadSnapshot,
    payloadHash: hashPayload(payloadSnapshot),
    expectedTargetVersion: 1,
    idempotencyKey,
  };
}

test.before(async () => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('creates an opaque operation number and enforces requester idempotency', async () => {
  const requesterUserId = await createUser();
  const store = createStore();

  const created = await store.create(operationInput(requesterUserId));
  assert.match(created.operationNo, /^GOV-[0-9A-F-]{36}$/);
  assert.equal(created.version, 1);
  assert.deepEqual(
    await store.findByRequesterIdempotency(requesterUserId, 'request-1'),
    created,
  );
  await assert.rejects(
    () => store.create(operationInput(requesterUserId)),
    (error: unknown) => error instanceof GovernanceError
      && error.code === 'IDEMPOTENCY_KEY_REUSED'
      && error.status === 409,
  );
});

test('appends reviews and executions and returns each timeline in stable ascending order', async () => {
  const requesterUserId = await createUser();
  const reviewerUserId = await createUser();
  const store = createStore();
  const operation = await store.create(operationInput(requesterUserId));

  await store.appendReview({
    operationId: operation.id,
    reviewerUserId,
    decision: 'APPROVE',
    comment: null,
    operationVersion: 2,
    createdAt: new Date('2026-07-21T02:00:00.000Z'),
  });
  await store.appendReview({
    operationId: operation.id,
    reviewerUserId,
    decision: 'REJECT',
    comment: '测试排序使用的拒绝原因',
    operationVersion: 1,
    createdAt: new Date('2026-07-21T01:00:00.000Z'),
  });
  await store.appendExecution({
    operationId: operation.id,
    attemptNo: 2,
    executorType: 'SYSTEM',
    status: 'FAILED',
    beforeSnapshot: { status: 'ENABLED' },
    afterSnapshot: null,
    resultCode: 'FAILED_LATER',
    errorMessage: 'safe failure',
    startedAt: new Date('2026-07-21T04:00:00.000Z'),
    finishedAt: new Date('2026-07-21T04:01:00.000Z'),
  });
  await store.appendExecution({
    operationId: operation.id,
    attemptNo: 1,
    executorType: 'SYSTEM',
    status: 'SUCCEEDED',
    beforeSnapshot: { status: 'DISABLED' },
    afterSnapshot: { status: 'ENABLED' },
    resultCode: 'OK',
    errorMessage: null,
    startedAt: new Date('2026-07-21T03:00:00.000Z'),
    finishedAt: new Date('2026-07-21T03:01:00.000Z'),
  });

  const detail = await store.getDetail(operation.id);
  assert.ok(detail);
  assert.deepEqual(detail.reviews.map(item => item.operationVersion), [1, 2]);
  assert.deepEqual(detail.executions.map(item => item.attemptNo), [1, 2]);
  assert.equal('updateReview' in store, false);
  assert.equal('deleteExecution' in store, false);
});

test('uses status and version together for optimistic transitions', async () => {
  const requesterUserId = await createUser();
  const store = createStore();
  const operation = await store.create(operationInput(requesterUserId));

  const approved = await store.transition(operation.id, 'PENDING_REVIEW', 1, 'APPROVED');
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.version, 2);
  await assert.rejects(
    () => store.transition(operation.id, 'PENDING_REVIEW', 1, 'APPROVED'),
    (error: unknown) => error instanceof GovernanceError
      && error.code === 'OPERATION_ALREADY_PROCESSED'
      && error.status === 409,
  );
});
