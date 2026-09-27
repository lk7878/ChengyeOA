import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PositionService } from '../../app/application/master-data/position-service';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { hasCode } from './test-helpers';

let prisma: PrismaClient;
let rootId: string;
let branchId: string;
let disabledOrganizationId: string;
let service: PositionService;

const POSITION_PERMISSIONS: PermissionCode[] = [
  'position.read',
  'position.create',
  'position.update',
  'position.delete',
  'position.status.manage',
];

test('deletes unused positions with version and administrator protection and writes an audit', async () => {
  const position = await createPosition();
  const denied = new PositionService(prisma, { actorUserId: 'position-test-actor' }, { ...authorizationContext(POSITION_PERMISSIONS.filter(code => code !== 'position.delete')), isSystemSuperAdmin: false });
  await assert.rejects(() => denied.remove(position.id, position.version), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => service.remove(position.id, 99), hasCode('VERSION_CONFLICT'));
  await service.remove(position.id, position.version);
  assert.ok((await prisma.position.findUniqueOrThrow({ where: { id: position.id } })).deletedAt);
  assert.equal((await service.list({})).length, 0);
  assert.equal(await prisma.operationLog.count({ where: { targetId: position.id, targetType: 'POSITION', action: 'DELETE' } }), 1);
});

test('deletes positions while preserving ended assignment history', async () => {
  const position = await createPosition();
  const employee = await prisma.employee.create({ data: { employeeNo: 'HISTORY-001', name: 'Old employee', phone: '13800000000', type: 'LAWYER', status: 'LEAVED', entryDate: new Date('2026-01-01') } });
  await prisma.employeeAssignment.create({ data: { employeeId: employee.id, organizationId: position.organizationId, positionId: position.id, assignmentType: 'PRIMARY', startedAt: new Date('2026-01-01'), endedAt: new Date('2026-08-01') } });
  await service.remove(position.id, position.version);
  assert.equal(await prisma.employeeAssignment.count({ where: { positionId: position.id } }), 1);
  assert.ok(await prisma.position.findUnique({ where: { id: position.id } }));
});

function authorizationContext(permissionCodes: PermissionCode[], scopeIds = ['ALL']): AuthorizationContext {
  return {
    userId: 'position-test-actor',
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: scopeIds.includes('ALL'),
    grants: permissionCodes.map(permissionCode => ({
      sourceType: 'ROLE',
      sourceId: 'position-test-role',
      permissionCode,
      resource: 'position',
      scopeIds,
      validUntil: null as Date | null,
    })),
    fieldRules: [],
    permissionCodes,
    evaluatedAt: new Date('2026-07-18T12:00:00.000Z'),
  };
}

async function createOrganization(input: { code: string; status?: string; sort?: number }) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      code: input.code,
      name: `${input.code} name`,
      type: input.code === 'ROOT' ? 'FIRM' : 'BRANCH',
      parentId: input.code === 'ROOT' ? null : rootId,
      path: input.code === 'ROOT' ? `/${id}` : `/${rootId}/${id}`,
      level: input.code === 'ROOT' ? 0 : 1,
      status: input.status ?? 'ENABLED',
      sort: input.sort,
    },
  });
}

async function createPosition(organizationId = branchId, code = 'LAWYER', level = 1) {
  return service.create({
    organizationId,
    code,
    name: `${code} position`,
    categoryCode: 'LEGAL',
    level,
  });
}

async function dropAuditFailureTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_position_audit_trigger ON "operation_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_position_audit()');
}

test.before(async () => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await dropAuditFailureTrigger();
  await clearTestApplicationData(prisma);
  rootId = (await createOrganization({ code: 'ROOT' })).id;
  branchId = (await createOrganization({ code: 'BRANCH_A' })).id;
  disabledOrganizationId = (await createOrganization({ code: 'BRANCH_DISABLED', status: 'DISABLED' })).id;
  service = new PositionService(
    prisma,
    { actorUserId: 'position-test-actor', ip: '127.0.0.1' },
    authorizationContext(POSITION_PERMISSIONS),
  );
});

test.after(async () => {
  await dropAuditFailureTrigger();
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('scopes stable position codes to one organization and maps the write race', async () => {
  const otherBranch = await createOrganization({ code: 'BRANCH_B' });
  await Promise.all([createPosition(branchId, 'LAWYER'), createPosition(otherBranch.id, 'LAWYER')]);

  const results = await Promise.allSettled([
    createPosition(branchId, 'ASSISTANT'),
    createPosition(branchId, 'ASSISTANT'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.ok(rejected);
  assert.equal(hasCode('MASTER_DATA_CODE_CONFLICT')(rejected.reason), true);
});

test('rejects creation and enable when the owning organization is disabled', async () => {
  await assert.rejects(
    () => createPosition(disabledOrganizationId),
    hasCode('MASTER_DATA_IN_USE'),
  );
  const position = await prisma.position.create({
    data: {
      organizationId: disabledOrganizationId,
      code: 'DISABLED_POSITION',
      name: 'Disabled position',
      categoryCode: 'LEGAL',
      status: 'DISABLED',
    },
  });
  await assert.rejects(() => service.enable(position.id, 1), hasCode('MASTER_DATA_IN_USE'));
});

test('keeps organization immutable and supports a custom position code', async () => {
  const position = await createPosition();
  await assert.rejects(
    () => service.update(position.id, { organizationId: rootId, name: 'Moved', version: 1 } as never),
    hasCode('VALIDATION_FAILED'),
  );


  const updated = await service.update(position.id, {
    code: '律师-2026',
    name: '  Senior Lawyer  ',
    categoryCode: ' senior_legal ',
    level: 3,
    responsibilities: '  Lead matters  ',
    version: 1,
  });
  assert.equal(updated.organizationId, branchId);
  assert.equal(updated.code, '律师-2026');
  assert.equal(updated.name, 'Senior Lawyer');
  assert.equal(updated.categoryCode, 'SENIOR_LEGAL');
  assert.equal(updated.responsibilities, 'Lead matters');
  assert.equal(updated.version, 2);
});

test('rejects stale versions and blocks disable while an assignment is active', async () => {
  const position = await createPosition();
  const employee = await prisma.employee.create({
    data: {
      employeeNo: 'EMP-001',
      name: 'Employee One',
      phone: '13800000000',
      type: 'LAWYER',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  await prisma.employeeAssignment.create({
    data: {
      employeeId: employee.id,
      organizationId: branchId,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: employee.entryDate,
    },
  });

  await assert.rejects(() => service.disable(position.id, 1), hasCode('MASTER_DATA_IN_USE'));
  await assert.rejects(
    () => service.update(position.id, { name: 'Stale', version: 2 }),
    hasCode('VERSION_CONFLICT'),
  );
});

test('lists positions deterministically with filters and active assignment counts', async () => {
  const lowB = await createPosition(branchId, 'B_CODE', 1);
  const high = await createPosition(branchId, 'HIGH', 3);
  const lowA = await createPosition(branchId, 'A_CODE', 1);
  await service.disable(lowB.id, lowB.version);

  const enabled = await service.list({ organizationId: branchId, status: 'ENABLED' });
  assert.deepEqual(enabled.map(item => item.id), [high.id, lowA.id]);
  assert.equal((await service.detail(high.id)).activeAssignmentCount, 0);
  assert.deepEqual((await service.list({ keyword: 'high' })).map(item => item.id), [high.id]);
});

test('keeps branch-scoped position list and detail boundaries identical', async () => {
  const branchB = await createOrganization({ code: 'BRANCH_B' });
  const branchAPosition = await createPosition(branchId, 'BRANCH_A_LAWYER');
  const branchBPosition = await createPosition(branchB.id, 'BRANCH_B_LAWYER');
  const branchScope = await prisma.dataScope.create({
    data: {
      name: 'Branch A scope',
      scopeType: 'BRANCH',
      organizationId: branchId,
      includeDescendants: true,
    },
  });
  const scoped = new PositionService(
    prisma,
    { actorUserId: 'position-test-actor', ip: '127.0.0.1' },
    authorizationContext(['position.read'], [branchScope.id]),
  );

  assert.deepEqual((await scoped.list({})).map(item => item.id), [branchAPosition.id]);
  assert.equal((await scoped.detail(branchAPosition.id)).id, branchAPosition.id);
  await assert.rejects(
    () => scoped.detail(branchBPosition.id),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
});

test('enforces branch scope for position create, update, and status operations', async () => {
  const branchB = await createOrganization({ code: 'BRANCH_B' });
  const branchAPosition = await createPosition(branchId, 'BRANCH_A_LAWYER');
  const branchBPosition = await createPosition(branchB.id, 'BRANCH_B_LAWYER');
  const scope = await prisma.dataScope.create({
    data: { name: 'Branch A manage', scopeType: 'BRANCH', organizationId: branchId, includeDescendants: true },
  });
  const scoped = new PositionService(
    prisma,
    { actorUserId: 'position-test-actor', ip: '127.0.0.1' },
    authorizationContext(POSITION_PERMISSIONS, [scope.id]),
  );

  const created = await scoped.create({
    organizationId: branchId, code: 'ASSISTANT_A', name: 'Assistant A', categoryCode: 'LEGAL', level: 1,
  });
  assert.equal(created.organizationId, branchId);
  assert.equal((await scoped.update(branchAPosition.id, { name: 'Updated A', version: 1 })).name, 'Updated A');

  await assert.rejects(
    () => scoped.create({
      organizationId: branchB.id, code: 'DENIED', name: 'Denied', categoryCode: 'LEGAL', level: 1,
    }),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
  await assert.rejects(
    () => scoped.update(branchBPosition.id, { name: 'Denied', version: 1 }),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
  await assert.rejects(
    () => scoped.disable(branchBPosition.id, 1),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
});

test('honors exact organization, HQ, and super-admin position scopes', async () => {
  const departmentId = randomUUID();
  await prisma.organization.create({
    data: {
      id: departmentId, code: 'BRANCH_A_DEPT', name: 'Branch A department', type: 'DEPARTMENT',
      parentId: branchId, path: `/${rootId}/${branchId}/${departmentId}`, level: 2,
    },
  });
  const directPosition = await createPosition(branchId, 'DIRECT');
  const childPosition = await createPosition(departmentId, 'CHILD');
  const hqId = randomUUID();
  const hqDepartmentId = randomUUID();
  const nestedBranchId = randomUUID();
  await prisma.organization.createMany({ data: [
    { id: hqId, code: 'HQ', name: 'HQ', type: 'HQ_CENTER', parentId: rootId, path: `/${rootId}/${hqId}`, level: 1 },
    { id: hqDepartmentId, code: 'HQ_DEPT', name: 'HQ department', type: 'DEPARTMENT', parentId: hqId, path: `/${rootId}/${hqId}/${hqDepartmentId}`, level: 2 },
    { id: nestedBranchId, code: 'HQ_BRANCH', name: 'HQ branch', type: 'BRANCH', parentId: hqId, path: `/${rootId}/${hqId}/${nestedBranchId}`, level: 2 },
  ] });
  const hqPosition = await createPosition(hqDepartmentId, 'HQ_POSITION');
  const nestedBranchPosition = await createPosition(nestedBranchId, 'HQ_BRANCH_POSITION');
  const exactScope = await prisma.dataScope.create({
    data: { name: 'Branch A exact', scopeType: 'ORG', organizationId: branchId, includeDescendants: false },
  });
  const hqScope = await prisma.dataScope.create({ data: { name: 'HQ scope', scopeType: 'HQ_SCOPE' } });

  const exact = new PositionService(
    prisma, { actorUserId: 'position-test-actor' }, authorizationContext(['position.read'], [exactScope.id]),
  );
  assert.deepEqual((await exact.list({})).map(item => item.id), [directPosition.id]);
  await assert.rejects(() => exact.detail(childPosition.id), hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));

  const hqOnly = new PositionService(
    prisma, { actorUserId: 'position-test-actor' }, authorizationContext(['position.read'], [hqScope.id]),
  );
  assert.deepEqual((await hqOnly.list({})).map(item => item.id), [hqPosition.id]);
  await assert.rejects(() => hqOnly.detail(nestedBranchPosition.id), hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));

  assert.equal((await service.detail(nestedBranchPosition.id)).id, nestedBranchPosition.id);
});

test('rolls back position creation when audit writing fails', async () => {
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_position_audit() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected position audit failure';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_position_audit_trigger
    BEFORE INSERT ON "operation_log"
    FOR EACH ROW EXECUTE FUNCTION fail_position_audit()
  `);

  await assert.rejects(() => createPosition(branchId, 'ROLLBACK_POSITION'));
  assert.equal(await prisma.position.count({ where: { code: 'ROLLBACK_POSITION' } }), 0);
});

test('characterizes governance-shared responsibilities and status mutations with audit output', async () => {
  const position = await createPosition(branchId, 'SHARED_POSITION');
  const updated = await service.update(position.id, {
    responsibilities: '  Review governance matters  ', version: position.version,
  });
  const disabled = await service.disable(position.id, updated.version);
  const enabled = await service.enable(position.id, disabled.version);

  assert.equal(updated.responsibilities, 'Review governance matters');
  assert.equal(disabled.status, 'DISABLED');
  assert.equal(enabled.status, 'ENABLED');
  assert.equal(enabled.version, 4);
  const logs = await prisma.operationLog.findMany({ where: { targetId: position.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(logs.map(log => log.action), ['CREATE', 'UPDATE', 'DISABLE', 'ENABLE']);
  assert.deepEqual(JSON.parse(logs[1].newValues ?? '{}'), {
    organizationId: branchId,
    code: 'SHARED_POSITION',
    categoryCode: 'LEGAL',
    status: 'ENABLED',
    version: 2,
  });
});
