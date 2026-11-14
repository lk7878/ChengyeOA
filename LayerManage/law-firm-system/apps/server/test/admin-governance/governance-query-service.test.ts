import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { GovernanceQueryService } from '../../app/application/admin-governance/governance-query-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CODES } from '../../app/domain/authorization/permission-catalog';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { hashPayload } from '../../app/domain/admin-governance/canonical-json';
import { GovernanceError } from '../../app/domain/admin-governance/governance-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let prisma: PrismaClient;

function createService(): GovernanceQueryService {
  return new GovernanceQueryService(prisma, 'chengye_oa_test');
}

async function createUser(label: string): Promise<string> {
  return prisma.user.create({
    data: { username: `${label}.${randomUUID()}`, password: 'unused', status: 'ENABLED' },
    select: { id: true },
  }).then(user => user.id);
}

function context(
  userId: string,
  input: { superAdmin?: boolean; systemAdmin?: boolean; permissionCodes?: PermissionCode[] } = {},
): AuthorizationContext {
  return {
    userId,
    employeeId: null,
    isSystemSuperAdmin: input.superAdmin ?? false,
    isSystemAdmin: input.systemAdmin ?? false,
    grants: [],
    fieldRules: [],
    permissionCodes: input.permissionCodes ?? [],
    evaluatedAt: new Date('2026-07-21T12:00:00.000Z'),
  };
}

async function createOperation(input: {
  id: string;
  requesterUserId: string;
  operationType?: string;
  targetId?: string;
  status?: string;
  createdAt?: Date;
  payloadSnapshot?: Prisma.InputJsonObject;
}): Promise<void> {
  const payloadSnapshot = input.payloadSnapshot ?? { field: 'safe' };
  await prisma.adminOperation.create({
    data: {
      id: input.id,
      operationNo: `GOV-${randomUUID().toUpperCase()}`,
      operationType: input.operationType ?? 'MASTER_DATA_STATUS_CORRECTION',
      riskLevel: 'HIGH',
      reviewMode: 'PRE',
      status: input.status ?? 'PENDING_REVIEW',
      requesterUserId: input.requesterUserId,
      targetType: 'USER',
      targetId: input.targetId ?? 'target-user',
      reason: '治理查询服务测试业务原因',
      payloadSnapshot,
      payloadHash: hashPayload(payloadSnapshot),
      expectedTargetVersion: 1,
      idempotencyKey: `idem-${input.id}`,
      createdAt: input.createdAt ?? new Date('2026-07-21T10:00:00.000Z'),
    },
  });
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

test('mine scope is self-only and paginates by createdAt desc then id desc', async () => {
  const requester = await createUser('mine');
  const other = await createUser('other');
  const createdAt = new Date('2026-07-21T10:00:00.000Z');
  await createOperation({ id: 'op-001', requesterUserId: requester, createdAt });
  await createOperation({ id: 'op-003', requesterUserId: requester, createdAt });
  await createOperation({ id: 'op-002', requesterUserId: requester, createdAt });
  await createOperation({ id: 'op-other', requesterUserId: other, createdAt });
  const service = createService();
  const actor = context(requester, {
    systemAdmin: true,
    permissionCodes: ['governance.operation.read_self'],
  });

  const first = await service.list(actor, { scope: 'mine', page: 1, pageSize: 2 });
  const second = await service.list(actor, { scope: 'mine', page: 2, pageSize: 2 });

  assert.deepEqual(first.list.map(item => item.id), ['op-003', 'op-002']);
  assert.deepEqual(second.list.map(item => item.id), ['op-001']);
  assert.equal(first.pagination.total, 3);
  assert.equal('payloadSnapshot' in first.list[0], false);
  assert.equal('payloadHash' in first.list[0], false);
  await assert.rejects(() => service.list(actor, { scope: 'mine', page: 1, pageSize: 101 }));
});

test('reviewable and all scopes are super-admin only and exclude reviewer conflicts', async () => {
  const reviewer = await createUser('reviewer');
  const other = await createUser('requester');
  await createOperation({ id: 'self-request', requesterUserId: reviewer });
  await createOperation({
    id: 'target-conflict',
    requesterUserId: other,
    operationType: 'SYSTEM_ADMIN_ACCOUNT_DISABLE',
    targetId: reviewer,
  });
  await createOperation({ id: 'reviewable', requesterUserId: other, targetId: 'safe-target' });
  const service = createService();
  const superAdmin = context(reviewer, {
    superAdmin: true,
    permissionCodes: [...PERMISSION_CODES],
  });
  const systemAdmin = context(reviewer, {
    systemAdmin: true,
    permissionCodes: ['governance.operation.read_self'],
  });

  const reviewable = await service.list(superAdmin, { scope: 'reviewable', page: 1, pageSize: 20 });
  assert.deepEqual(reviewable.list.map(item => item.id), ['reviewable']);
  const all = await service.list(superAdmin, { scope: 'all', page: 1, pageSize: 20 });
  assert.equal(all.pagination.total, 3);
  await assert.rejects(
    () => service.list(systemAdmin, { scope: 'all', page: 1, pageSize: 20 }),
    (error: unknown) => error instanceof GovernanceError
      && error.code === 'GOVERNANCE_OPERATION_NOT_ALLOWED'
      && error.status === 403,
  );
});

test('detail enforces visibility, redacts snapshots, orders history, and writes an access audit', async () => {
  const requester = await createUser('detail-requester');
  const reviewer = await createUser('detail-reviewer');
  await createOperation({
    id: 'detail-op',
    requesterUserId: requester,
    payloadSnapshot: {
      username: 'target.user',
      passwordHash: 'secret-password-hash',
      nested: { apiKey: 'secret-api-key', safe: 'visible' },
    },
  });
  await prisma.adminOperationReview.createMany({ data: [
    {
      id: 'review-later', operationId: 'detail-op', reviewerUserId: reviewer, decision: 'APPROVE', operationVersion: 2,
      createdAt: new Date('2026-07-21T11:00:00.000Z'),
    },
    {
      id: 'review-earlier', operationId: 'detail-op', reviewerUserId: reviewer, decision: 'REJECT', operationVersion: 1,
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
    },
  ] });
  await prisma.adminOperationExecution.create({
    data: {
      id: 'execution-1', operationId: 'detail-op', attemptNo: 1, executorType: 'SYSTEM', status: 'FAILED',
      beforeSnapshot: { token: 'secret-token', status: 'ENABLED' },
      afterSnapshot: { databaseUrl: 'postgresql://secret@localhost/db', status: 'DISABLED' },
      errorMessage: 'safe error',
    },
  });
  const service = createService();
  const owner = context(requester, { permissionCodes: ['governance.operation.read_self'] });
  const stranger = context(reviewer, { permissionCodes: ['governance.operation.read_self'] });

  const detail = await service.detail(owner, 'detail-op', '127.0.0.1');
  const serialized = JSON.stringify(detail);
  assert.equal(serialized.includes('secret-password-hash'), false);
  assert.equal(serialized.includes('secret-api-key'), false);
  assert.equal(serialized.includes('secret-token'), false);
  assert.equal(serialized.includes('postgresql://secret'), false);
  assert.equal(serialized.includes('[REDACTED]'), true);
  assert.equal('payloadHash' in detail, false);
  assert.deepEqual(detail.reviews.map(item => item.id), ['review-earlier', 'review-later']);
  const audit = await prisma.operationLog.findFirstOrThrow({ where: { action: 'VIEW_ADMIN_GOVERNANCE_DETAIL' } });
  assert.equal(audit.userId, requester);
  assert.equal(audit.targetType, 'ADMIN_GOVERNANCE');
  assert.equal(audit.targetId, 'detail-op');
  assert.equal(audit.ip, '127.0.0.1');
  await assert.rejects(
    () => service.detail(stranger, 'detail-op', '127.0.0.2'),
    (error: unknown) => error instanceof GovernanceError
      && error.code === 'RESOURCE_NOT_FOUND_OR_FORBIDDEN'
      && error.status === 404,
  );
});

test('detail fails when its mandatory access audit cannot be written', async () => {
  const requester = await createUser('audit-failure');
  await createOperation({ id: 'audit-failure-op', requesterUserId: requester });
  const service = createService();
  const owner = context(requester, { permissionCodes: ['governance.operation.read_self'] });
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION reject_governance_detail_audit_for_test() RETURNS trigger AS $$
    BEGIN
      IF NEW.action = 'VIEW_ADMIN_GOVERNANCE_DETAIL' THEN
        RAISE EXCEPTION 'injected governance detail audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER reject_governance_detail_audit_for_test_trigger
    BEFORE INSERT ON "operation_log"
    FOR EACH ROW EXECUTE FUNCTION reject_governance_detail_audit_for_test()
  `);

  try {
    await assert.rejects(() => service.detail(owner, 'audit-failure-op', '127.0.0.1'));
    assert.equal(await prisma.operationLog.count(), 0);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_governance_detail_audit_for_test_trigger ON "operation_log"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_governance_detail_audit_for_test()');
  }
});

test('catalog is requester-role filtered and expands only stable confirmation tokens', async () => {
  const systemAdminId = await createUser('catalog-system');
  const superAdminId = await createUser('catalog-super');
  const service = createService();

  const systemCatalog = service.catalog(context(systemAdminId, {
    systemAdmin: true,
    permissionCodes: ['governance.catalog.read'],
  }));
  assert.deepEqual(
    systemCatalog.map(item => item.operationType).sort(),
    ['MASTER_DATA_METADATA_CORRECTION', 'MASTER_DATA_STATUS_CORRECTION'],
  );

  const superCatalog = service.catalog(context(superAdminId, {
    superAdmin: true,
    permissionCodes: [...PERMISSION_CODES],
  }));
  assert.equal(superCatalog.length, 9);
  const critical = superCatalog.find(item => item.operationType === 'SUPER_ADMIN_GRANT');
  assert.ok(critical);
  assert.ok(critical.confirmationTemplate.includes('chengye_oa_test'));
  assert.ok(critical.confirmationTemplate.includes('SUPER_ADMIN_GRANT'));
  assert.ok(critical.confirmationTemplate.includes('{targetUsername}'));
  assert.equal(critical.confirmationTemplate.includes('{databaseName}'), false);
  assert.equal(critical.confirmationTemplate.includes('{operationType}'), false);
});
