import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { SecondSuperAdminService } from '../../app/application/system/second-super-admin-service';
import { GovernanceError } from '../../app/domain/admin-governance/governance-errors';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { PasswordHasher } from '../../app/domain/security/password-hasher';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { allowTestGovernanceStepUp, testGovernanceStepUp } from '../helpers/governance-step-up';

const NOW = new Date('2026-07-21T12:00:00.000Z');
const hasher: PasswordHasher = {
  hash: async value => `hash:${value}`,
  compare: async (value, hash) => hash === `hash:${value}`,
};

let prisma: PrismaClient;
let rootUserId: string;
let secondUserId: string;
let adminUserId: string;
let ordinaryUserId: string;
let branchId: string;

function governance() {
  return createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test', clock: () => new Date(NOW), stepUp: allowTestGovernanceStepUp,
  });
}

function superContext(userId: string): AuthorizationContext {
  return context(userId, false, true, [
    'governance.catalog.read', 'governance.operation.create', 'governance.operation.read_self',
    'governance.operation.read_all', 'governance.review', 'governance.retry', 'governance.audit.read',
  ]);
}

function adminContext(userId: string): AuthorizationContext {
  return context(userId, true, false, [
    'governance.catalog.read', 'governance.operation.create', 'governance.operation.read_self',
  ]);
}

function ordinaryContext(userId: string): AuthorizationContext {
  return context(userId, false, false, []);
}

function context(userId: string, isSystemAdmin: boolean, isSystemSuperAdmin: boolean, permissionCodes: PermissionCode[]): AuthorizationContext {
  return { userId, employeeId: null, isSystemAdmin, isSystemSuperAdmin, permissionCodes, grants: [], fieldRules: [], evaluatedAt: NOW };
}

function secondSeatService() {
  return new SecondSuperAdminService(
    prisma, hasher, { databaseName: 'chengye_oa_test', hostname: 'acceptance-host' }, () => new Date(NOW),
  );
}

async function addSecondSeat() {
  return secondSeatService().execute({
    actorUsername: 'root.admin', actorPassword: 'root-secret', targetUsername: 'second.admin',
    reason: 'Approved acceptance recovery for independent second governance seat',
    confirmation: 'ADD SECOND SUPER ADMIN chengye_oa_test second.admin',
  });
}

function statusInput(idempotencyKey = randomUUID(), expectedTargetVersion = 1) {
  return {
    operationType: 'MASTER_DATA_STATUS_CORRECTION' as const, targetType: 'ORGANIZATION', targetId: branchId,
    reason: 'Disable verified inactive branch through independent governance review', expectedTargetVersion,
    payload: { status: 'DISABLED' }, idempotencyKey,
  };
}

function metadataInput(idempotencyKey = randomUUID(), expectedTargetVersion = 1) {
  return {
    operationType: 'MASTER_DATA_METADATA_CORRECTION' as const, targetType: 'ORGANIZATION', targetId: branchId,
    reason: 'Correct verified organization ordering through governed intervention', expectedTargetVersion,
    payload: { sort: 22 }, idempotencyKey,
  };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  await prisma.role.createMany({ data: [
    { id: 'role:super-admin', code: 'SYSTEM_SUPER_ADMIN', name: 'Super Admin', type: 'SYSTEM' },
    { id: 'role:system-admin', code: 'SYSTEM_ADMIN', name: 'System Admin', type: 'SYSTEM' },
  ] });
  const root = await prisma.user.create({ data: { username: 'root.admin', password: 'hash:root-secret', credentialVersion: 3 } });
  const second = await prisma.user.create({ data: { username: 'second.admin', password: 'hash:second-secret' } });
  const admin = await prisma.user.create({ data: { username: 'governance.admin', password: 'hash:admin-secret' } });
  const ordinary = await prisma.user.create({ data: { username: 'ordinary.user', password: 'hash:ordinary-secret' } });
  rootUserId = root.id; secondUserId = second.id; adminUserId = admin.id; ordinaryUserId = ordinary.id;
  await prisma.userRole.create({ data: { userId: root.id, roleId: 'role:super-admin', source: 'PERMANENT', validFrom: new Date(NOW.getTime() - 1_000) } });
  const rootOrganizationId = randomUUID(); branchId = randomUUID();
  await prisma.organization.create({ data: { id: rootOrganizationId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootOrganizationId}` } });
  await prisma.organization.create({ data: { id: branchId, code: 'BRANCH', name: 'Branch', type: 'BRANCH', parentId: rootOrganizationId, path: `/${rootOrganizationId}/${branchId}`, level: 1, sort: 1 } });
  await prisma.systemInitialization.create({ data: { id: 'PRIMARY', rootOrganizationId, superAdminUserId: root.id, completedAt: NOW } });
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('recovers exactly one independent second super-admin seat with redacted audit evidence', async () => {
  const result = await addSecondSeat();
  assert.deepEqual(result, { actorUsername: 'root.admin', targetUsername: 'second.admin' });
  const grant = await prisma.userRole.findFirstOrThrow({ where: { userId: secondUserId, roleId: 'role:super-admin' } });
  assert.equal(grant.source, 'RECOVERY');
  const audit = await prisma.operationLog.findFirstOrThrow({ where: { action: 'SUPER_ADMIN_SECOND_SEAT_RECOVERY' } });
  assert.doesNotMatch(JSON.stringify(audit), /root-secret|ADD SECOND SUPER ADMIN|postgresql:\/\//i);
});

test('requires two people to grant and revoke system administration and preserves an audit timeline', async () => {
  await addSecondSeat();
  const { command, review, query } = governance();
  const grantRequest = await command.create(superContext(rootUserId), {
    operationType: 'SYSTEM_ADMIN_GRANT', targetType: 'USER', targetId: adminUserId,
    reason: 'Grant verified operations administrator access after independent approval', expectedTargetVersion: 1,
    payload: { validUntil: null as string | null }, idempotencyKey: randomUUID(),
  }, undefined, testGovernanceStepUp(rootUserId));
  assert.equal(grantRequest.status, 'PENDING_REVIEW');
  assert.equal(await prisma.userRole.count({ where: { userId: adminUserId, roleId: 'role:system-admin', revokedAt: null } }), 0);
  await assert.rejects(
    () => review.review(superContext(rootUserId), grantRequest.id, { decision: 'APPROVE', expectedOperationVersion: 1 }),
    (error: unknown) => error instanceof GovernanceError && error.code === 'GOVERNANCE_SELF_REVIEW_FORBIDDEN',
  );
  const granted = await review.review(superContext(secondUserId), grantRequest.id, { decision: 'APPROVE', expectedOperationVersion: 1 }, undefined, testGovernanceStepUp(secondUserId));
  assert.equal(granted.status, 'SUCCEEDED');
  assert.equal(await prisma.userRole.count({ where: { userId: adminUserId, roleId: 'role:system-admin', revokedAt: null } }), 1);

  const revokeRequest = await command.create(superContext(rootUserId), {
    operationType: 'SYSTEM_ADMIN_REVOKE', targetType: 'USER', targetId: adminUserId,
    reason: 'Revoke completed operations administrator assignment with independent approval', expectedTargetVersion: 1,
    payload: {}, idempotencyKey: randomUUID(),
  }, undefined, testGovernanceStepUp(rootUserId));
  const revoked = await review.review(superContext(secondUserId), revokeRequest.id, { decision: 'APPROVE', expectedOperationVersion: 1 }, undefined, testGovernanceStepUp(secondUserId));
  assert.equal(revoked.status, 'SUCCEEDED');
  assert.equal(await prisma.userRole.count({ where: { userId: adminUserId, roleId: 'role:system-admin', revokedAt: null } }), 0);

  const detail = await query.detail(superContext(secondUserId), grantRequest.id, '127.0.0.1');
  assert.equal(detail.reviews.length, 1);
  assert.equal(detail.executions.length, 1);
  assert.equal(await prisma.operationLog.count({ where: { action: 'VIEW_ADMIN_GOVERNANCE_DETAIL', targetId: grantRequest.id } }), 1);
});

test('enforces PRE inertness, LOW post-review, idempotency, flag semantics, and ordinary-user denial', async () => {
  const { command, review } = governance();
  const high = await command.create(adminContext(adminUserId), statusInput(), undefined, testGovernanceStepUp(adminUserId));
  assert.equal(high.status, 'PENDING_REVIEW');
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).status, 'ENABLED');
  const approved = await review.review(superContext(rootUserId), high.id, { decision: 'APPROVE', expectedOperationVersion: 1 }, undefined, testGovernanceStepUp(rootUserId));
  assert.equal(approved.status, 'SUCCEEDED');

  await prisma.organization.update({ where: { id: branchId }, data: { status: 'ENABLED' } });
  const branch = await prisma.organization.findUniqueOrThrow({ where: { id: branchId } });
  const key = randomUUID();
  const lowInput = metadataInput(key, branch.version);
  const low = await command.create(adminContext(adminUserId), lowInput);
  const repeated = await command.create(adminContext(adminUserId), lowInput);
  assert.equal(repeated.id, low.id);
  assert.equal(low.status, 'PENDING_POST_REVIEW');
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).sort, 22);
  const flagged = await review.review(superContext(rootUserId), low.id, {
    decision: 'FLAG', comment: 'Ordering source evidence requires an additional independent check', expectedOperationVersion: low.version,
  });
  assert.equal(flagged.status, 'FLAGGED');
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).sort, 22);
  await assert.rejects(
    () => command.create(ordinaryContext(ordinaryUserId), statusInput()),
    (error: unknown) => error instanceof GovernanceError && error.code === 'GOVERNANCE_OPERATION_NOT_ALLOWED',
  );
});

test('serializes concurrent review to exactly one mutation', async () => {
  const { command, review } = governance();
  const created = await command.create(adminContext(adminUserId), statusInput(), undefined, testGovernanceStepUp(adminUserId));
  const results = await Promise.allSettled([
    review.review(superContext(rootUserId), created.id, { decision: 'APPROVE', expectedOperationVersion: 1 }, undefined, testGovernanceStepUp(rootUserId)),
    review.review(superContext(secondUserId), created.id, { decision: 'APPROVE', expectedOperationVersion: 1 }, undefined, testGovernanceStepUp(secondUserId)),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await prisma.adminOperationExecution.count({ where: { operationId: created.id, status: 'SUCCEEDED' } }), 1);
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).version, 2);
});

test('rejects tampering and stale targets without partial commit and protects the last super-admin', async () => {
  const { command, review } = governance();
  const tampered = await command.create(adminContext(adminUserId), statusInput(), undefined, testGovernanceStepUp(adminUserId));
  await prisma.adminOperation.update({ where: { id: tampered.id }, data: { payloadSnapshot: { status: 'ENABLED' } } });
  await assert.rejects(
    () => review.review(superContext(rootUserId), tampered.id, { decision: 'APPROVE', expectedOperationVersion: 1 }, undefined, testGovernanceStepUp(rootUserId)),
    (error: unknown) => error instanceof GovernanceError && error.code === 'PAYLOAD_HASH_MISMATCH',
  );
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).status, 'ENABLED');

  const staleKey = randomUUID();
  await assert.rejects(() => command.create(adminContext(adminUserId), metadataInput(staleKey, 2)));
  const failed = await prisma.adminOperation.findUniqueOrThrow({
    where: { requesterUserId_idempotencyKey: { requesterUserId: adminUserId, idempotencyKey: staleKey } }, include: { executions: true },
  });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.executions[0].resultCode, 'STALE_TARGET_VERSION');
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).sort, 1);

  const lastSeatRequest = await command.create(superContext(secondUserId), {
    operationType: 'SUPER_ADMIN_REVOKE', targetType: 'USER', targetId: rootUserId,
    reason: 'Attempt to revoke the only effective root governance seat', expectedTargetVersion: 3,
    payload: {}, idempotencyKey: randomUUID(),
    confirmation: 'CONFIRM chengye_oa_test SUPER_ADMIN_REVOKE root.admin',
  }, undefined, testGovernanceStepUp(secondUserId));
  await assert.rejects(
    () => review.review(superContext(ordinaryUserId), lastSeatRequest.id, { decision: 'APPROVE', expectedOperationVersion: 1 }, undefined, testGovernanceStepUp(ordinaryUserId)),
    (error: unknown) => error instanceof GovernanceError && error.code === 'LAST_SUPER_ADMIN_PROTECTED',
  );
  assert.equal(await prisma.userRole.count({ where: { userId: rootUserId, roleId: 'role:super-admin', revokedAt: null } }), 1);
});
