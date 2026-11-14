import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ActiveSessionClaims } from '../../app/application/auth/session-service';
import { SecurityError } from '../../app/domain/security/security-errors';
import { StepUpPurpose } from '../../app/domain/security/step-up-target';
import { hashPayload } from '../../app/domain/admin-governance/canonical-json';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let prisma: PrismaClient;
let requesterId: string;
let reviewerId: string;
let branchId: string;

function context(userId: string, superAdmin: boolean): AuthorizationContext {
  return {
    userId,
    employeeId: null,
    isSystemAdmin: !superAdmin,
    isSystemSuperAdmin: superAdmin,
    grants: [],
    fieldRules: [],
    evaluatedAt: new Date(),
    permissionCodes: (superAdmin
      ? ['governance.operation.create', 'governance.review', 'governance.retry']
      : ['governance.operation.create']) as PermissionCode[],
  };
}

function claims(userId: string): ActiveSessionClaims {
  return { userId, sessionId: randomUUID(), credentialVersion: 1, assuranceLevel: 'MFA' };
}

function authorization(userId: string) {
  return { claims: claims(userId), token: `grant-${randomUUID()}` };
}

function highInput() {
  return {
    operationType: 'MASTER_DATA_STATUS_CORRECTION',
    targetType: 'ORGANIZATION',
    targetId: branchId,
    reason: 'Protect this high-risk governance state correction with step-up',
    expectedTargetVersion: 1,
    payload: { status: 'DISABLED' },
    idempotencyKey: randomUUID(),
  };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  requesterId = (await prisma.user.create({ data: { username: `step.requester.${randomUUID()}`, password: 'x' } })).id;
  reviewerId = (await prisma.user.create({ data: { username: `step.reviewer.${randomUUID()}`, password: 'x' } })).id;
  const rootId = randomUUID();
  branchId = randomUUID();
  await prisma.organization.create({ data: { id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}` } });
  await prisma.organization.create({ data: {
    id: branchId, code: 'BRANCH', name: 'Branch', type: 'BRANCH', parentId: rootId,
    path: `/${rootId}/${branchId}`, level: 1,
  } });
  await prisma.systemInitialization.create({
    data: { id: 'PRIMARY', rootOrganizationId: rootId, superAdminUserId: reviewerId, completedAt: new Date() },
  });
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('requires and transactionally consumes purpose-bound grants for high-risk create, approve, and retry', async () => {
  const calls: Array<{ purpose: StepUpPurpose; target: unknown; observedStatus: string | null }> = [];
  const consumer = {
    async consume(
      tx: Prisma.TransactionClient,
      _claims: ActiveSessionClaims,
      purpose: StepUpPurpose,
      target: unknown,
      token: string,
    ) {
      assert.match(token, /^grant-/);
      const operationId = typeof target === 'object' && target && 'operationId' in target
        ? String((target as { operationId: unknown }).operationId)
        : null;
      const operation = operationId
        ? await tx.adminOperation.findUnique({ where: { id: operationId }, select: { status: true } })
        : null;
      calls.push({ purpose, target, observedStatus: operation?.status ?? null });
    },
  };
  const services = createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test',
    stepUp: consumer,
  });

  await assert.rejects(
    () => services.command.create(context(requesterId, false), highInput()),
    (error: unknown) => error instanceof SecurityError && error.code === 'STEP_UP_REQUIRED',
  );

  const created = await services.command.create(
    context(requesterId, false), highInput(), undefined, authorization(requesterId),
  );
  assert.equal(calls[0].purpose, 'ADMIN_GOVERNANCE_CREATE');
  assert.equal(calls[0].observedStatus, null);
  assert.deepEqual(calls[0].target, {
    operationType: 'MASTER_DATA_STATUS_CORRECTION',
    targetType: 'ORGANIZATION',
    targetId: branchId,
    expectedTargetVersion: 1,
    payloadHash: hashPayload({ status: 'DISABLED' }),
  });

  await services.review.review(
    context(reviewerId, true),
    created.id,
    { decision: 'APPROVE', expectedOperationVersion: created.version },
    undefined,
    authorization(reviewerId),
  );
  assert.deepEqual(calls[1], {
    purpose: 'ADMIN_GOVERNANCE_APPROVE',
    target: { operationId: created.id, expectedOperationVersion: created.version, decision: 'APPROVE' },
    observedStatus: 'PENDING_REVIEW',
  });

  await prisma.organization.update({ where: { id: branchId }, data: { status: 'ENABLED', version: 1 } });
  const retrySource = await services.command.create(
    context(requesterId, false), highInput(), undefined, authorization(requesterId),
  );
  await prisma.adminOperation.update({ where: { id: retrySource.id }, data: { status: 'FAILED', version: 2 } });
  await services.review.resume(
    context(reviewerId, true),
    retrySource.id,
    { expectedOperationVersion: 2 },
    undefined,
    authorization(reviewerId),
  );
  assert.deepEqual(calls[3], {
    purpose: 'ADMIN_GOVERNANCE_RETRY',
    target: { operationId: retrySource.id, expectedOperationVersion: 2 },
    observedStatus: 'FAILED',
  });
});
