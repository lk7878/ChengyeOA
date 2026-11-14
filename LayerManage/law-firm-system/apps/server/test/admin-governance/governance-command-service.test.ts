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
let rootId: string;
let branchId: string;
let events: InMemoryGovernanceEventSink;

function context(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    userId: requesterId,
    employeeId: null,
    isSystemAdmin: true,
    isSystemSuperAdmin: false,
    grants: [],
    fieldRules: [],
    permissionCodes: ['governance.operation.create', 'governance.operation.read_self'] as PermissionCode[],
    evaluatedAt: new Date('2026-07-21T12:00:00.000Z'),
    ...overrides,
  };
}

function services() {
  return createGovernanceServices(prisma, {
    databaseName: 'chengye_oa_test', eventSink: events, stepUp: allowTestGovernanceStepUp,
  });
}

function metadataInput(idempotencyKey = randomUUID(), sort = 9) {
  return {
    operationType: 'MASTER_DATA_METADATA_CORRECTION',
    targetType: 'ORGANIZATION',
    targetId: branchId,
    reason: 'Correct display ordering after verified administration request',
    expectedTargetVersion: 1,
    payload: { sort },
    idempotencyKey,
  };
}

function statusInput(idempotencyKey = randomUUID()) {
  return {
    operationType: 'MASTER_DATA_STATUS_CORRECTION',
    targetType: 'ORGANIZATION',
    targetId: branchId,
    reason: 'Disable inactive branch after governance verification completed',
    expectedTargetVersion: 1,
    payload: { status: 'DISABLED' },
    idempotencyKey,
  };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  events = new InMemoryGovernanceEventSink();
  requesterId = (await prisma.user.create({ data: {
    username: `governance.requester.${randomUUID()}`, password: 'unused',
  } })).id;
  rootId = randomUUID();
  branchId = randomUUID();
  await prisma.organization.create({ data: {
    id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}`,
  } });
  await prisma.organization.create({ data: {
    id: branchId, code: 'BRANCH', name: 'Branch', type: 'BRANCH', parentId: rootId,
    path: `/${rootId}/${branchId}`, level: 1, sort: 1,
  } });
  await prisma.systemInitialization.create({ data: {
    id: 'PRIMARY', rootOrganizationId: rootId, superAdminUserId: requesterId, completedAt: new Date(),
  } });
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('keeps PRE operations inert, executes LOW operations immediately, and emits safe events', async () => {
  const { command } = services();
  const pre = await command.create(context(), statusInput(), undefined, testGovernanceStepUp(requesterId));
  assert.equal(pre.status, 'PENDING_REVIEW');
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).status, 'ENABLED');

  const low = await command.create(context(), metadataInput());
  assert.equal(low.status, 'PENDING_POST_REVIEW');
  assert.equal(low.executions.length, 1);
  assert.equal(low.executions[0].status, 'SUCCEEDED');
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).sort, 9);
  assert.ok(events.events.some(event => event.eventType === 'EXECUTION_SUCCEEDED'));
  assert.equal(/payload|reason|password/i.test(JSON.stringify(events.events)), false);
});

test('returns the same record for an identical idempotent create and rejects changed parameters', async () => {
  const { command } = services();
  const key = randomUUID();
  const first = await command.create(context(), statusInput(key), undefined, testGovernanceStepUp(requesterId));
  const repeated = await command.create(context(), statusInput(key), undefined, testGovernanceStepUp(requesterId));
  assert.equal(repeated.id, first.id);
  await assert.rejects(
    () => command.create(context(), { ...statusInput(key), reason: 'A different sufficiently long governance reason' }),
    (error: unknown) => error instanceof GovernanceError && error.code === 'IDEMPOTENCY_KEY_REUSED',
  );
});

test('allows only the requester to cancel a pending PRE operation with the expected version', async () => {
  const { command } = services();
  const created = await command.create(context(), statusInput(), undefined, testGovernanceStepUp(requesterId));
  const cancelled = await command.cancel(context(), created.id, { expectedOperationVersion: created.version });
  assert.equal(cancelled.status, 'CANCELLED');
  await assert.rejects(
    () => command.cancel(context({ userId: randomUUID() }), created.id, { expectedOperationVersion: 2 }),
    (error: unknown) => error instanceof GovernanceError && error.code === 'RESOURCE_NOT_FOUND_OR_FORBIDDEN',
  );
});

test('requires the exact code-owned confirmation for CRITICAL operations', async () => {
  await prisma.role.create({ data: {
    id: 'role:super-admin', code: 'SYSTEM_SUPER_ADMIN', name: 'Super Admin', type: 'SYSTEM',
  } });
  const target = await prisma.user.create({ data: { username: 'critical.target', password: 'unused' } });
  const superContext = context({ isSystemAdmin: false, isSystemSuperAdmin: true });
  const base = {
    operationType: 'SUPER_ADMIN_GRANT', targetType: 'USER', targetId: target.id,
    reason: 'Add a separately verified governance administrator account', expectedTargetVersion: 1,
    payload: { validUntil: null as string | null }, idempotencyKey: randomUUID(),
  };
  await assert.rejects(
    () => services().command.create(superContext, base),
    (error: unknown) => error instanceof GovernanceError && error.code === 'TARGET_NOT_ELIGIBLE',
  );
  const created = await services().command.create(superContext, {
    ...base,
    confirmation: 'CONFIRM chengye_oa_test SUPER_ADMIN_GRANT critical.target',
  }, undefined, testGovernanceStepUp(requesterId));
  assert.equal(created.status, 'PENDING_REVIEW');
  assert.ok(created.secondConfirmationAt);
});

test('persists a failed LOW attempt without business change and retries only after the target is eligible', async () => {
  const { command, review } = services();
  const key = randomUUID();
  await assert.rejects(
    () => command.create(context(), {
      ...metadataInput(key, 31),
      expectedTargetVersion: 2,
    }),
  );
  const failed = await prisma.adminOperation.findUniqueOrThrow({
    where: { requesterUserId_idempotencyKey: { requesterUserId: requesterId, idempotencyKey: key } },
    include: { executions: true },
  });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.executions.length, 1);
  assert.equal(failed.executions[0].status, 'FAILED');
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).sort, 1);

  await prisma.organization.update({ where: { id: branchId }, data: { version: 2 } });
  const retried = await review.resume(context({
    isSystemAdmin: false,
    isSystemSuperAdmin: true,
    permissionCodes: ['governance.retry'] as PermissionCode[],
  }), failed.id, { expectedOperationVersion: failed.version });
  assert.equal(retried.status, 'PENDING_POST_REVIEW');
  assert.deepEqual(retried.executions.map(item => item.status), ['FAILED', 'SUCCEEDED']);
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).sort, 31);
});
