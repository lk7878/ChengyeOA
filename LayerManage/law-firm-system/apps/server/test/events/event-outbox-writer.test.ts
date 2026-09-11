import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { allowTestGovernanceStepUp, testGovernanceStepUp } from '../helpers/governance-step-up';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let prisma: PrismaClient;

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
      ? [ 'governance.review', 'governance.operation.read_all' ]
      : [ 'governance.operation.create' ]) as PermissionCode[],
  };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => { await clearTestApplicationData(prisma); });
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('commits review, audit, and reviewed-v1 event atomically without private review data', async () => {
  const requesterId = (await prisma.user.create({
    data: { username: `outbox.requester.${randomUUID()}`, password: 'x' },
  })).id;
  const reviewerId = (await prisma.user.create({
    data: { username: `outbox.reviewer.${randomUUID()}`, password: 'x' },
  })).id;
  const rootId = randomUUID();
  const branchId = randomUUID();
  await prisma.organization.create({
    data: { id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}` },
  });
  await prisma.organization.create({
    data: {
      id: branchId,
      code: 'BRANCH',
      name: 'Branch',
      type: 'BRANCH',
      parentId: rootId,
      path: `/${rootId}/${branchId}`,
      level: 1,
    },
  });
  await prisma.systemInitialization.create({
    data: { id: 'PRIMARY', rootOrganizationId: rootId, superAdminUserId: reviewerId, completedAt: new Date() },
  });

  const services = createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test',
    stepUp: allowTestGovernanceStepUp,
  });
  const created = await services.command.create(context(requesterId, false), {
    operationType: 'MASTER_DATA_STATUS_CORRECTION',
    targetType: 'ORGANIZATION',
    targetId: branchId,
    reason: 'reason text that must never enter the public event',
    expectedTargetVersion: 1,
    payload: { status: 'DISABLED' },
    idempotencyKey: randomUUID(),
  }, undefined, testGovernanceStepUp(requesterId));

  const rawRequestId = `  outbox-atomic-${'x'.repeat(220)}  `;
  const normalizedRequestId = rawRequestId.trim().slice(0, 200);

  await services.review.review(context(reviewerId, true), created.id, {
    decision: 'REJECT',
    comment: 'review comment that must remain in the private governance review',
    expectedOperationVersion: created.version,
  }, rawRequestId);

  const event = await prisma.eventLog.findFirstOrThrow({ where: { objectId: created.id } });
  assert.equal(event.eventType, 'admin.operation.reviewed');
  assert.equal(event.eventVersion, 1);
  assert.equal(event.objectType, 'ADMIN_OPERATION');
  assert.equal(event.operatorUserId, reviewerId);
  assert.equal(event.traceId, normalizedRequestId);
  assert.deepEqual(event.payload, {
    operationId: created.id,
    operationType: 'MASTER_DATA_STATUS_CORRECTION',
    riskLevel: 'HIGH',
    decision: 'REJECT',
    status: 'REJECTED',
    requesterUserId: requesterId,
    routeUrl: `/security/admin-governance?operationId=${created.id}`,
  });
  assert.equal(await prisma.adminOperationReview.count({ where: { operationId: created.id } }), 1);
  assert.equal(await prisma.operationLog.count({
    where: { action: 'ADMIN_GOVERNANCE_REJECT', targetId: created.id },
  }), 1);
  assert.doesNotMatch(JSON.stringify(event), /reason text|review comment|token/i);
});

test('persists a post-review CONFIRM decision without changing its meaning', async () => {
  const requesterId = (await prisma.user.create({
    data: { username: `confirm.requester.${randomUUID()}`, password: 'x' },
  })).id;
  const reviewerId = (await prisma.user.create({
    data: { username: `confirm.reviewer.${randomUUID()}`, password: 'x' },
  })).id;
  const rootId = randomUUID();
  const branchId = randomUUID();
  await prisma.organization.create({
    data: { id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}` },
  });
  await prisma.organization.create({
    data: {
      id: branchId,
      code: 'BRANCH',
      name: 'Branch',
      type: 'BRANCH',
      parentId: rootId,
      path: `/${rootId}/${branchId}`,
      level: 1,
    },
  });
  await prisma.systemInitialization.create({
    data: { id: 'PRIMARY', rootOrganizationId: rootId, superAdminUserId: reviewerId, completedAt: new Date() },
  });

  const services = createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test',
    stepUp: allowTestGovernanceStepUp,
  });
  const created = await services.command.create(context(requesterId, false), {
    operationType: 'MASTER_DATA_METADATA_CORRECTION',
    targetType: 'ORGANIZATION',
    targetId: branchId,
    reason: 'Apply a low risk sort correction and require independent post review',
    expectedTargetVersion: 1,
    payload: { sort: 12 },
    idempotencyKey: randomUUID(),
  });
  assert.equal(created.status, 'PENDING_POST_REVIEW');

  const confirmed = await services.review.review(context(reviewerId, true), created.id, {
    decision: 'CONFIRM',
    expectedOperationVersion: created.version,
  }, 'outbox-confirm-request');

  assert.equal(confirmed.status, 'CONFIRMED');
  const event = await prisma.eventLog.findFirstOrThrow({ where: { objectId: created.id } });
  assert.equal((event.payload as Record<string, unknown>).decision, 'CONFIRM');
  assert.equal((event.payload as Record<string, unknown>).status, 'CONFIRMED');
  assert.equal(await prisma.adminOperationReview.count({ where: { operationId: created.id } }), 1);
  assert.equal(await prisma.operationLog.count({
    where: { action: 'ADMIN_GOVERNANCE_CONFIRM', targetId: created.id },
  }), 1);
});
