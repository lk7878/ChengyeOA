import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
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

function highInput() {
  return {
    operationType: 'MASTER_DATA_STATUS_CORRECTION',
    targetType: 'ORGANIZATION',
    targetId: branchId,
    reason: 'Verify exempt state correction retains review and audit',
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

test('status correction creates, approves and retries without consuming a grant', async () => {
  let consumed = 0;
  const services = createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test', stepUp: { async consume() { consumed++; throw new Error('must not verify'); } },
  });
  const created = await services.command.create(context(requesterId, false), highInput());
  assert.equal(created.status, 'PENDING_REVIEW');
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).status, 'ENABLED');
  await assert.rejects(() => services.review.review(context(requesterId, true), created.id,
    { decision: 'APPROVE', expectedOperationVersion: created.version }));
  await services.review.review(context(reviewerId, true), created.id,
    { decision: 'APPROVE', expectedOperationVersion: created.version });
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).status, 'DISABLED');
  assert.equal((await prisma.adminOperation.findUniqueOrThrow({ where: { id: created.id } })).status, 'SUCCEEDED');
  await prisma.organization.update({ where: { id: branchId }, data: { status: 'ENABLED', version: 1 } });
  const retrySource = await services.command.create(context(requesterId, false), highInput());
  await prisma.adminOperation.update({ where: { id: retrySource.id }, data: { status: 'FAILED', version: 2 } });
  await services.review.resume(context(reviewerId, true), retrySource.id, { expectedOperationVersion: 2 });
  assert.equal((await prisma.adminOperation.findUniqueOrThrow({ where: { id: retrySource.id } })).status, 'SUCCEEDED');
  assert.equal(consumed, 0);
  assert.ok(await prisma.operationLog.count({ where: { targetId: created.id } }));
});
