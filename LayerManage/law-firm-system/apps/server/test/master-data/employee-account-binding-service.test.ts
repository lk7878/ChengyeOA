import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { EmployeeAccountBindingService } from '../../app/application/master-data/employee-account-binding-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { authorizationContext, hasCode } from './test-helpers';

let prisma: PrismaClient;
let rootOrganizationId: string;
let positionId: string;
let employeeAId: string;
let employeeBId: string;
let userAId: string;
let userBId: string;
let service: EmployeeAccountBindingService;

async function createEmployee(employeeNo: string): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      employeeNo,
      name: employeeNo,
      phone: '13800000000',
      type: 'LAWYER',
      entryDate: new Date('2026-01-01'),
    },
  });
  await prisma.employeeAssignment.create({
    data: {
      employeeId: employee.id,
      organizationId: rootOrganizationId,
      positionId,
      assignmentType: 'PRIMARY',
      startedAt: employee.entryDate,
    },
  });
  return employee.id;
}

async function createUser(username: string): Promise<string> {
  return (await prisma.user.create({ data: { username, password: 'test-password-hash' } })).id;
}

async function dropAuditTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_account_binding_audit_trigger ON "operation_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_account_binding_audit()');
}

test.before(async () => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await dropAuditTrigger();
  await clearTestApplicationData(prisma);
  rootOrganizationId = randomUUID();
  await prisma.organization.create({
    data: {
      id: rootOrganizationId,
      code: 'ROOT',
      name: 'Root',
      type: 'FIRM',
      path: `/${rootOrganizationId}`,
    },
  });
  positionId = (await prisma.position.create({
    data: {
      organizationId: rootOrganizationId,
      code: 'LAWYER',
      name: 'Lawyer',
      categoryCode: 'LEGAL',
    },
  })).id;
  employeeAId = await createEmployee('EMP-A');
  employeeBId = await createEmployee('EMP-B');
  userAId = await createUser('user_a');
  userBId = await createUser('user_b');
  service = new EmployeeAccountBindingService(
    prisma,
    { actorUserId: 'binding-actor', ip: '127.0.0.1' },
    authorizationContext({
      userId: 'binding-actor', permissionCodes: ['employee.account_binding.manage'],
      resource: 'employee_account_binding', superAdmin: true,
    }),
  );
});

test.after(async () => {
  await dropAuditTrigger();
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('binds and unbinds an ordinary account while versioning the employee and auditing both actions', async () => {
  const bound = await service.bind(employeeAId, { userId: userAId, employeeVersion: 1 });
  assert.equal(bound.account?.id, userAId);
  assert.equal(bound.version, 2);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userAId } })).employeeId, employeeAId);

  const unbound = await service.unbind(employeeAId, { employeeVersion: 2 });
  assert.equal(unbound.account, null);
  assert.equal(unbound.version, 3);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userAId } })).employeeId, null);

  const logs = await prisma.operationLog.findMany({
    where: { targetType: 'USER', targetId: userAId },
    orderBy: { createdAt: 'asc' },
  });
  assert.deepEqual(logs.map(log => log.action), ['BIND_ACCOUNT', 'UNBIND_ACCOUNT']);
  assert.ok(logs.every(log => !`${log.oldValues}${log.newValues}`.includes('test-password-hash')));
});

test('rejects binding when either the user or employee is already bound', async () => {
  await service.bind(employeeAId, { userId: userAId, employeeVersion: 1 });

  await assert.rejects(
    () => service.bind(employeeBId, { userId: userAId, employeeVersion: 1 }),
    hasCode('ACCOUNT_BINDING_CONFLICT'),
  );
  await assert.rejects(
    () => service.bind(employeeAId, { userId: userBId, employeeVersion: 2 }),
    hasCode('ACCOUNT_BINDING_CONFLICT'),
  );
});

test('hides employees outside account-binding data scope before reading account state', async () => {
  const branchId = randomUUID();
  await prisma.organization.create({ data: {
    id: branchId, code: 'BRANCH_A', name: 'Branch A', type: 'BRANCH', parentId: rootOrganizationId,
    path: `/${rootOrganizationId}/${branchId}`, level: 1,
  } });
  const branchPosition = await prisma.position.create({ data: {
    organizationId: branchId, code: 'BRANCH_LAWYER', name: 'Branch lawyer', categoryCode: 'LEGAL',
  } });
  await prisma.employeeAssignment.updateMany({
    where: { employeeId: employeeAId, endedAt: null },
    data: { organizationId: branchId, positionId: branchPosition.id },
  });
  const scope = await prisma.dataScope.create({ data: {
    name: 'Branch A account binding', scopeType: 'BRANCH', organizationId: branchId, includeDescendants: true,
  } });
  const scoped = new EmployeeAccountBindingService(
    prisma,
    { actorUserId: 'binding-actor', ip: '127.0.0.1' },
    authorizationContext({
      userId: 'binding-actor', permissionCodes: ['employee.account_binding.manage'],
      resource: 'employee_account_binding', scopeIds: [scope.id],
    }),
  );

  assert.equal((await scoped.bind(employeeAId, { userId: userAId, employeeVersion: 1 })).account?.id, userAId);
  await assert.rejects(
    () => scoped.bind(employeeBId, { userId: userBId, employeeVersion: 1 }),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userBId } })).employeeId, null);
});

test('field-projects employee details returned by account-binding mutations', async () => {
  const context = authorizationContext({
    userId: 'binding-reader', permissionCodes: ['employee.account_binding.manage'],
    resource: 'employee_account_binding', scopeIds: ['ALL'], superAdmin: false,
  });
  context.permissionCodes.push('employee.read');
  context.grants.push({
    sourceType: 'ROLE', sourceId: 'binding-reader-grant', sourceRoleId: 'binding-reader-role',
    permissionCode: 'employee.read', resource: 'employee', scopeIds: ['ALL'], validUntil: null,
  });
  const scoped = new EmployeeAccountBindingService(
    prisma, { actorUserId: 'binding-reader' }, context,
  );
  const detail = await scoped.bind(employeeAId, { userId: userAId, employeeVersion: 1 });
  assert.equal(detail.phone, '138****0000');
});

test('returns stable errors for missing objects, stale versions, and unbound employees', async () => {
  await assert.rejects(
    () => service.bind(randomUUID(), { userId: userAId, employeeVersion: 1 }),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
  await assert.rejects(
    () => service.bind(employeeAId, { userId: randomUUID(), employeeVersion: 1 }),
    hasCode('USER_NOT_FOUND'),
  );
  await assert.rejects(
    () => service.bind(employeeAId, { userId: userAId, employeeVersion: 2 }),
    hasCode('VERSION_CONFLICT'),
  );
  await assert.rejects(
    () => service.unbind(employeeAId, { employeeVersion: 1 }),
    hasCode('ACCOUNT_BINDING_CONFLICT'),
  );
});

test('binds the initialized super-admin without changing trust-root identity or credentials', async () => {
  const role = await prisma.role.create({
    data: { code: 'SYSTEM_SUPER_ADMIN', name: 'System Super Admin', type: 'SYSTEM' },
  });
  await prisma.userRole.create({ data: { userId: userAId, roleId: role.id } });
  await prisma.systemInitialization.create({
    data: {
      id: 'PRIMARY',
      rootOrganizationId,
      superAdminUserId: userAId,
      completedAt: new Date('2026-01-01'),
    },
  });
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userAId } });

  const result = await service.bind(employeeAId, { userId: userAId, employeeVersion: 1 });

  const after = await prisma.user.findUniqueOrThrow({ where: { id: userAId } });
  assert.equal(result.account?.id, userAId);
  assert.deepEqual(
    {
      id: after.id,
      username: after.username,
      password: after.password,
      status: after.status,
      mustChangePassword: after.mustChangePassword,
      credentialVersion: after.credentialVersion,
      failedLoginCount: after.failedLoginCount,
      lockedUntil: after.lockedUntil,
    },
    {
      id: before.id,
      username: before.username,
      password: before.password,
      status: before.status,
      mustChangePassword: before.mustChangePassword,
      credentialVersion: before.credentialVersion,
      failedLoginCount: before.failedLoginCount,
      lockedUntil: before.lockedUntil,
    },
  );
  assert.equal(after.employeeId, employeeAId);
  assert.equal((await prisma.systemInitialization.findUniqueOrThrow({ where: { id: 'PRIMARY' } })).superAdminUserId, userAId);
  assert.equal(await prisma.userRole.count({ where: { userId: userAId, roleId: role.id } }), 1);
});

test('rolls back account and employee changes when audit insertion fails', async () => {
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION fail_account_binding_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER fail_account_binding_audit_trigger BEFORE INSERT ON "operation_log" FOR EACH ROW EXECUTE FUNCTION fail_account_binding_audit()`,
  );

  await assert.rejects(() => service.bind(employeeAId, { userId: userAId, employeeVersion: 1 }));

  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userAId } })).employeeId, null);
  assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employeeAId } })).version, 1);
});
