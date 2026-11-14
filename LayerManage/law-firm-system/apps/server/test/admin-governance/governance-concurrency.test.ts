import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { GovernanceError } from '../../app/domain/admin-governance/governance-errors';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { allowTestGovernanceStepUp, testGovernanceStepUp } from '../helpers/governance-step-up';

let prisma: PrismaClient;
let requesterId: string;
let reviewerOneId: string;
let reviewerTwoId: string;
let branchId: string;

function ctx(userId: string, superAdmin: boolean): AuthorizationContext {
  return {
    userId, employeeId: null, isSystemAdmin: !superAdmin, isSystemSuperAdmin: superAdmin,
    grants: [], fieldRules: [], evaluatedAt: new Date(),
    permissionCodes: (superAdmin
      ? ['governance.review', 'governance.retry', 'governance.operation.read_all']
      : ['governance.operation.create']) as PermissionCode[],
  };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  requesterId = (await prisma.user.create({ data: { username: `requester.${randomUUID()}`, password: 'x' } })).id;
  reviewerOneId = (await prisma.user.create({ data: { username: `reviewer1.${randomUUID()}`, password: 'x' } })).id;
  reviewerTwoId = (await prisma.user.create({ data: { username: `reviewer2.${randomUUID()}`, password: 'x' } })).id;
  const rootId = randomUUID(); branchId = randomUUID();
  await prisma.organization.create({ data: { id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}` } });
  await prisma.organization.create({ data: { id: branchId, code: 'BRANCH', name: 'Branch', type: 'BRANCH', parentId: rootId, path: `/${rootId}/${branchId}`, level: 1 } });
  await prisma.systemInitialization.create({ data: { id: 'PRIMARY', rootOrganizationId: rootId, superAdminUserId: reviewerOneId, completedAt: new Date() } });
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('allows exactly one concurrent reviewer and one successful business mutation', async () => {
  const { command, review } = createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test', stepUp: allowTestGovernanceStepUp,
  });
  const created = await command.create(ctx(requesterId, false), {
    operationType: 'MASTER_DATA_STATUS_CORRECTION', targetType: 'ORGANIZATION', targetId: branchId,
    reason: 'Concurrent governance approval should execute only one mutation', expectedTargetVersion: 1,
    payload: { status: 'DISABLED' }, idempotencyKey: randomUUID(),
  }, undefined, testGovernanceStepUp(requesterId));
  const results = await Promise.allSettled([
    review.review(ctx(reviewerOneId, true), created.id, { decision: 'APPROVE', expectedOperationVersion: 1 }, undefined, testGovernanceStepUp(reviewerOneId)),
    review.review(ctx(reviewerTwoId, true), created.id, { decision: 'APPROVE', expectedOperationVersion: 1 }, undefined, testGovernanceStepUp(reviewerTwoId)),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(failure.reason instanceof GovernanceError);
  assert.equal(failure.reason.code, 'OPERATION_ALREADY_PROCESSED');
  assert.equal(await prisma.adminOperationReview.count({ where: { operationId: created.id } }), 1);
  assert.equal(await prisma.adminOperationExecution.count({ where: { operationId: created.id, status: 'SUCCEEDED' } }), 1);
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).version, 2);
});

test('allows exactly one concurrent resume from an APPROVED process-interruption state', async () => {
  const { command, review } = createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test', stepUp: allowTestGovernanceStepUp,
  });
  const created = await command.create(ctx(requesterId, false), {
    operationType: 'MASTER_DATA_STATUS_CORRECTION', targetType: 'ORGANIZATION', targetId: branchId,
    reason: 'Resume a committed approval after simulated process interruption', expectedTargetVersion: 1,
    payload: { status: 'DISABLED' }, idempotencyKey: randomUUID(),
  }, undefined, testGovernanceStepUp(requesterId));
  await prisma.adminOperation.update({ where: { id: created.id }, data: { status: 'APPROVED', version: 2 } });
  const results = await Promise.allSettled([
    review.resume(ctx(reviewerOneId, true), created.id, { expectedOperationVersion: 2 }, undefined, testGovernanceStepUp(reviewerOneId)),
    review.resume(ctx(reviewerTwoId, true), created.id, { expectedOperationVersion: 2 }, undefined, testGovernanceStepUp(reviewerTwoId)),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await prisma.adminOperationExecution.count({
    where: { operationId: created.id, status: 'SUCCEEDED' },
  }), 1);
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).version, 2);
});
