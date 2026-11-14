import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import { InMemoryGovernanceEventSink } from '../../app/application/admin-governance/governance-event-sink';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { GovernanceError } from '../../app/domain/admin-governance/governance-errors';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { allowTestGovernanceStepUp, testGovernanceStepUp } from '../helpers/governance-step-up';

let prisma: PrismaClient;
let requesterId: string;
let reviewerId: string;
let branchId: string;
let events: InMemoryGovernanceEventSink;

function ctx(userId: string, superAdmin: boolean): AuthorizationContext {
  return {
    userId, employeeId: null, isSystemAdmin: !superAdmin, isSystemSuperAdmin: superAdmin,
    grants: [], fieldRules: [], evaluatedAt: new Date(),
    permissionCodes: (superAdmin
      ? ['governance.operation.create', 'governance.review', 'governance.retry', 'governance.operation.read_all']
      : ['governance.operation.create', 'governance.operation.read_self']) as PermissionCode[],
  };
}

function services() { return createGovernanceServices(prisma, {
  databaseName: 'chengye_oa_test', eventSink: events, stepUp: allowTestGovernanceStepUp,
}); }
function input(operationType: 'MASTER_DATA_STATUS_CORRECTION' | 'MASTER_DATA_METADATA_CORRECTION') {
  return {
    operationType, targetType: 'ORGANIZATION', targetId: branchId,
    reason: 'Governance review test request with a sufficient explanation', expectedTargetVersion: 1,
    payload: operationType.endsWith('STATUS_CORRECTION') ? { status: 'DISABLED' } : { sort: 12 },
    idempotencyKey: randomUUID(),
  };
}

async function assertReviewRefusal(
  operationId: string,
  actorUserId: string,
  refusalCode: string,
  requestId: string,
): Promise<void> {
  const operation = await prisma.adminOperation.findUniqueOrThrow({ where: { id: operationId } });
  assert.equal(operation.status, 'PENDING_REVIEW');
  assert.equal(await prisma.adminOperationReview.count({ where: { operationId } }), 0);
  assert.equal(await prisma.eventLog.count({ where: { objectId: operationId } }), 0);

  const audits = await prisma.operationLog.findMany({
    where: { action: 'ADMIN_GOVERNANCE_REVIEW_REJECTED', targetId: operationId },
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].userId, actorUserId);
  assert.equal(audits[0].targetType, 'ADMIN_GOVERNANCE');
  assert.deepEqual(JSON.parse(audits[0].newValues ?? 'null'), { refusalCode, requestId });
  assert.doesNotMatch(JSON.stringify(audits[0]), /raw review comment|private reason|business payload|token-secret/i);
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  events = new InMemoryGovernanceEventSink();
  requesterId = (await prisma.user.create({ data: { username: `requester.${randomUUID()}`, password: 'x' } })).id;
  reviewerId = (await prisma.user.create({ data: { username: `reviewer.${randomUUID()}`, password: 'x' } })).id;
  const rootId = randomUUID(); branchId = randomUUID();
  await prisma.organization.create({ data: { id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}` } });
  await prisma.organization.create({ data: { id: branchId, code: 'BRANCH', name: 'Branch', type: 'BRANCH', parentId: rootId, path: `/${rootId}/${branchId}`, level: 1 } });
  await prisma.systemInitialization.create({ data: { id: 'PRIMARY', rootOrganizationId: rootId, superAdminUserId: reviewerId, completedAt: new Date() } });
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('rejects self-review, persists an independent approval, and executes PRE exactly once', async () => {
  const { command, review } = services();
  const created = await command.create(ctx(requesterId, false), input('MASTER_DATA_STATUS_CORRECTION'), undefined, testGovernanceStepUp(requesterId));
  await assert.rejects(
    () => review.review(
      ctx(requesterId, true),
      created.id,
      { decision: 'APPROVE', expectedOperationVersion: 1 },
      'self-review-request',
    ),
    (error: unknown) => error instanceof GovernanceError && error.code === 'GOVERNANCE_SELF_REVIEW_FORBIDDEN',
  );
  await assertReviewRefusal(created.id, requesterId, 'GOVERNANCE_SELF_REVIEW_FORBIDDEN', 'self-review-request');
  const approved = await review.review(ctx(reviewerId, true), created.id, {
    decision: 'APPROVE', expectedOperationVersion: 1,
  }, 'approve-review-request', testGovernanceStepUp(reviewerId));
  assert.equal(approved.status, 'SUCCEEDED');
  assert.equal(approved.reviews.length, 1);
  assert.equal(approved.executions.length, 1);
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).status, 'DISABLED');
  const event = await prisma.eventLog.findFirstOrThrow({ where: { objectId: created.id } });
  assert.equal((event.payload as Record<string, unknown>).decision, 'APPROVE');
  assert.equal((event.payload as Record<string, unknown>).status, 'APPROVED');
});

test('audits invalid review input without persisting raw fields or changing governance state', async () => {
  const { command, review } = services();
  const created = await command.create(
    ctx(requesterId, false),
    input('MASTER_DATA_STATUS_CORRECTION'),
    undefined,
    testGovernanceStepUp(requesterId),
  );
  const rawRequestId = `  invalid-review-${'x'.repeat(250)}  `;
  const normalizedRequestId = rawRequestId.trim().slice(0, 200);

  await assert.rejects(
    () => review.review(ctx(reviewerId, true), created.id, {
      decision: 'REJECT',
      expectedOperationVersion: created.version,
      comment: 'raw review comment must not be persisted',
      reason: 'private reason must not be persisted',
      payload: 'business payload must not be persisted',
      token: 'token-secret',
    }, rawRequestId),
    (error: unknown) => error instanceof GovernanceError && error.code === 'TARGET_NOT_ELIGIBLE',
  );

  await assertReviewRefusal(created.id, reviewerId, 'TARGET_NOT_ELIGIBLE', normalizedRequestId);
});

test('audits a stale review version without creating a review or event', async () => {
  const { command, review } = services();
  const created = await command.create(
    ctx(requesterId, false),
    input('MASTER_DATA_STATUS_CORRECTION'),
    undefined,
    testGovernanceStepUp(requesterId),
  );

  await assert.rejects(
    () => review.review(ctx(reviewerId, true), created.id, {
      decision: 'REJECT',
      comment: 'Reject with an intentionally stale operation version',
      expectedOperationVersion: created.version + 1,
    }, 'stale-version-request'),
    (error: unknown) => error instanceof GovernanceError && error.code === 'OPERATION_ALREADY_PROCESSED',
  );

  await assertReviewRefusal(created.id, reviewerId, 'OPERATION_ALREADY_PROCESSED', 'stale-version-request');
});

test('fails closed and does not notify observers when refusal audit persistence fails', async () => {
  const { command, review } = services();
  const created = await command.create(
    ctx(requesterId, false),
    input('MASTER_DATA_STATUS_CORRECTION'),
    undefined,
    testGovernanceStepUp(requesterId),
  );
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION reject_governance_refusal_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW.action = 'ADMIN_GOVERNANCE_REVIEW_REJECTED' THEN
        RAISE EXCEPTION 'refusal audit unavailable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER reject_governance_refusal_audit_trigger
    BEFORE INSERT ON operation_log
    FOR EACH ROW EXECUTE FUNCTION reject_governance_refusal_audit()
  `);

  try {
    await assert.rejects(
      () => review.review(
        ctx(requesterId, true),
        created.id,
        { decision: 'APPROVE', expectedOperationVersion: created.version },
        'audit-failure-request',
      ),
      /refusal audit unavailable/,
    );
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_governance_refusal_audit_trigger ON operation_log');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_governance_refusal_audit()');
  }

  assert.equal((await prisma.adminOperation.findUniqueOrThrow({ where: { id: created.id } })).status, 'PENDING_REVIEW');
  assert.equal(await prisma.adminOperationReview.count({ where: { operationId: created.id } }), 0);
  assert.equal(await prisma.eventLog.count({ where: { objectId: created.id } }), 0);
  assert.equal(events.events.filter(event => event.operationId === created.id).length, 1);
  assert.equal(events.events[0].eventType, 'OPERATION_CREATED');
});

test('rolls back the governance decision when EventLog creation fails', async () => {
  const configured = createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test',
    eventSink: events,
    stepUp: allowTestGovernanceStepUp,
    outboxWriter: {
      async append() { throw new Error('outbox unavailable'); },
    },
  } as Parameters<typeof createGovernanceServices>[1]);
  const created = await configured.command.create(
    ctx(requesterId, false),
    input('MASTER_DATA_STATUS_CORRECTION'),
    undefined,
    testGovernanceStepUp(requesterId),
  );

  await assert.rejects(
    () => configured.review.review(ctx(reviewerId, true), created.id, {
      decision: 'REJECT',
      comment: 'Reject this operation while testing atomic event persistence',
      expectedOperationVersion: created.version,
    }),
    /outbox unavailable/,
  );

  assert.equal((await prisma.adminOperation.findUniqueOrThrow({ where: { id: created.id } })).status, 'PENDING_REVIEW');
  assert.equal(await prisma.adminOperationReview.count({ where: { operationId: created.id } }), 0);
  assert.equal(await prisma.operationLog.count({
    where: { action: 'ADMIN_GOVERNANCE_REJECT', targetId: created.id },
  }), 0);
  assert.equal(await prisma.eventLog.count({ where: { objectId: created.id } }), 0);
});

test('requires comments for rejection and flags, and never rolls back a flagged LOW change', async () => {
  const { command, review } = services();
  const rejectedSource = await command.create(ctx(requesterId, false), input('MASTER_DATA_STATUS_CORRECTION'), undefined, testGovernanceStepUp(requesterId));
  const rejected = await review.review(ctx(reviewerId, true), rejectedSource.id, {
    decision: 'REJECT', comment: 'Target is still operational and must remain enabled', expectedOperationVersion: 1,
  });
  assert.equal(rejected.status, 'REJECTED');

  const low = await command.create(ctx(requesterId, false), input('MASTER_DATA_METADATA_CORRECTION'));
  const flagged = await review.review(ctx(reviewerId, true), low.id, {
    decision: 'FLAG', comment: 'Ordering evidence needs another independent verification',
    expectedOperationVersion: low.version,
  });
  assert.equal(flagged.status, 'FLAGGED');
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).sort, 12);
  assert.ok(events.events.some(event => event.eventType === 'POST_REVIEW_FLAGGED'));
  const flaggedEvent = await prisma.eventLog.findFirstOrThrow({ where: { objectId: low.id } });
  assert.equal((flaggedEvent.payload as Record<string, unknown>).decision, 'FLAG');
  assert.equal((flaggedEvent.payload as Record<string, unknown>).status, 'FLAGGED');
});

test('detects payload tampering before execution and permits APPROVED resume only once', async () => {
  const { command, review } = services();
  const created = await command.create(ctx(requesterId, false), input('MASTER_DATA_STATUS_CORRECTION'), undefined, testGovernanceStepUp(requesterId));
  await prisma.adminOperation.update({ where: { id: created.id }, data: { payloadSnapshot: { status: 'ENABLED' } } });
  await assert.rejects(
    () => review.review(ctx(reviewerId, true), created.id, { decision: 'APPROVE', expectedOperationVersion: 1 }, undefined, testGovernanceStepUp(reviewerId)),
    (error: unknown) => error instanceof GovernanceError && error.code === 'PAYLOAD_HASH_MISMATCH',
  );
  const stored = await prisma.adminOperation.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'APPROVED');
  await assert.rejects(
    () => review.resume(ctx(reviewerId, true), created.id, { expectedOperationVersion: stored.version }),
    (error: unknown) => error instanceof GovernanceError && error.code === 'PAYLOAD_HASH_MISMATCH',
  );
});

test('resumes an APPROVED operation left between review commit and execution', async () => {
  const { command, review } = services();
  const created = await command.create(ctx(requesterId, false), input('MASTER_DATA_STATUS_CORRECTION'), undefined, testGovernanceStepUp(requesterId));
  await prisma.adminOperation.update({
    where: { id: created.id },
    data: { status: 'APPROVED', version: 2 },
  });
  const resumed = await review.resume(ctx(reviewerId, true), created.id, { expectedOperationVersion: 2 }, undefined, testGovernanceStepUp(reviewerId));
  assert.equal(resumed.status, 'SUCCEEDED');
  assert.equal(resumed.executions.length, 1);
});

test('rejects a reviewer who is also the administrator-account target', async () => {
  await prisma.role.create({ data: {
    id: 'role:super-admin', code: 'SYSTEM_SUPER_ADMIN', name: 'Super Admin', type: 'SYSTEM',
  } });
  const { command, review } = services();
  const created = await command.create(ctx(requesterId, true), {
    operationType: 'SUPER_ADMIN_GRANT', targetType: 'USER', targetId: reviewerId,
    reason: 'Grant verified governance coverage to the intended administrator', expectedTargetVersion: 1,
    payload: { validUntil: null as string | null }, idempotencyKey: randomUUID(),
    confirmation: `CONFIRM chengye_oa_test SUPER_ADMIN_GRANT ${(await prisma.user.findUniqueOrThrow({ where: { id: reviewerId } })).username}`,
  }, undefined, testGovernanceStepUp(requesterId));
  await assert.rejects(
    () => review.review(
      ctx(reviewerId, true),
      created.id,
      { decision: 'APPROVE', expectedOperationVersion: 1 },
      'target-conflict-request',
    ),
    (error: unknown) => error instanceof GovernanceError && error.code === 'GOVERNANCE_REVIEW_TARGET_CONFLICT',
  );
  await assertReviewRefusal(created.id, reviewerId, 'GOVERNANCE_REVIEW_TARGET_CONFLICT', 'target-conflict-request');
});
