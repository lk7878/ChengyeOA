import { basicOfficeCodes } from '../../app/application/authorization/office-role-template';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { RoleAuthorizationService } from '../../app/application/authorization/role-authorization-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let prisma: PrismaClient;
let service: RoleAuthorizationService;

test.before(() => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await dropAuditTrigger();
  await clearTestApplicationData(prisma);
  service = new RoleAuthorizationService(prisma, { actorUserId: 'role-admin', ip: '127.0.0.1' });
});
test.after(async () => {
  await dropAuditTrigger();
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('creates normalized business roles with immutable non-reserved stable codes', async () => {
  const created = await service.create({ name: ' Branch Manager ', code: ' branch_manager ', description: ' Branch role ' });
  assert.equal(created.code, 'BRANCH_MANAGER');
  assert.equal(created.name, 'Branch Manager');
  assert.equal(created.type, 'BUSINESS');
  assert.equal(created.version, 1);
  const createAudit = await prisma.operationLog.findFirstOrThrow({ where: { targetId: created.id, action: 'CREATE_ROLE' } });
  assert.doesNotMatch(createAudit.newValues ?? '', /Branch Manager|Branch role/);
  const updated = await service.update(created.id, { name: 'Office Manager', description: null, version: 1 });
  assert.equal(updated.code, 'BRANCH_MANAGER');
  assert.equal(updated.version, 2);

  await assert.rejects(
    () => service.create({ name: 'System', code: 'SYSTEM_SUPER_ADMIN' }),
    hasCode('TRUST_ROOT_PROTECTED'),
  );
  await assert.rejects(
    () => service.create({ name: 'Future System', code: 'SYSTEM_ADMIN' }),
    hasCode('PRIVILEGE_ESCALATION_BLOCKED'),
  );
  await assert.rejects(
    () => service.create({ name: 'Duplicate', code: 'branch_manager' }),
    hasCode('AUTHORIZATION_IN_USE'),
  );
  await assert.rejects(
    () => service.update(created.id, { name: 'Stale', version: 1 }),
    hasCode('VERSION_CONFLICT'),
  );
});

test('recreates a deleted role name with a new identity and no inherited grants or permissions', async () => {
  let old = await service.create({ name: '律师', code: 'LAWYER', basicOffice: false });
  old = await service.replacePermissions(old.id, { permissionCodes: ['employee.read'], version: old.version });
  const user = await prisma.user.create({ data: { username: 'historical.lawyer', password: 'unused' } });
  const grant = await prisma.userRole.create({ data: { userId: user.id, roleId: old.id, revokedAt: new Date(), revokedByUserId: user.id, revokeReason: 'Historical grant revoked for regression test' } });
  await service.remove(old.id, { version: old.version });

  const created = await service.create({ name: '律师', description: '总所律师', basicOffice: true, worksheets: [] });
  assert.notEqual(created.id, old.id);
  assert.notEqual(created.code, old.code);
  assert.deepEqual(created.permissionCodes, [...basicOfficeCodes].sort());
  assert.equal(await prisma.userRole.count({ where: { roleId: created.id } }), 0);
  assert.equal((await prisma.userRole.findUniqueOrThrow({ where: { id: grant.id } })).roleId, old.id);
  const historical = await prisma.role.findUniqueOrThrow({ where: { id: old.id } });
  assert.equal(historical.name, '律师');
  assert.equal(historical.status, 'DELETED');
  assert.equal(await prisma.rolePermission.count({ where: { roleId: old.id } }), 1);
  await assert.rejects(() => service.enable(old.id, historical.version), hasCode('AUTHORIZATION_OBJECT_NOT_FOUND'));
  await assert.rejects(() => service.create({ name: '其他律师', code: 'LAWYER' }), hasCode('AUTHORIZATION_IN_USE'));
});

test('allows reuse of legacy deleted names but preserves enabled and disabled name uniqueness', async () => {
  await prisma.role.create({ data: { name: '历史律师', code: 'OLD_LAWYER', type: 'BUSINESS', status: 'DELETED' } });
  const created = await service.create({ name: '历史律师' });
  await assert.rejects(() => service.create({ name: '历史律师' }), hasCode('AUTHORIZATION_IN_USE'));
  await service.disable(created.id, created.version);
  await assert.rejects(() => service.create({ name: '历史律师' }), hasCode('AUTHORIZATION_IN_USE'));
  const other = await service.create({ name: '助理律师' });
  await assert.rejects(() => service.update(other.id, { name: '历史律师', version: other.version }), hasCode('AUTHORIZATION_IN_USE'));
});

test('allows only one concurrent replacement of a deleted role name', async () => {
  await prisma.role.create({ data: { name: '并发律师', code: 'OLD_CONCURRENT', type: 'BUSINESS', status: 'DELETED' } });
  const results = await Promise.allSettled([service.create({ name: '并发律师' }), service.create({ name: '并发律师' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.ok(rejected && hasCode('AUTHORIZATION_IN_USE')(rejected.reason));
  assert.equal(await prisma.role.count({ where: { name: '并发律师', status: { not: 'DELETED' } } }), 1);
});

test('atomically replaces business permissions, allows self trace, and blocks governance permissions', async () => {
  const role = await service.create({ name: 'HR', code: 'HR_STAFF' });
  const changed = await service.replacePermissions(role.id, {
    permissionCodes: ['employee.read', 'employee.update', 'permission.trace.self'],
    version: role.version,
  });
  assert.deepEqual(changed.permissionCodes, ['employee.read', 'employee.update', 'permission.trace.self']);
  assert.equal(changed.version, 2);
  await assert.rejects(
    () => service.replacePermissions(role.id, {
      permissionCodes: ['employee.read', 'role.permission.manage'],
      version: changed.version,
    }),
    hasCode('PRIVILEGE_ESCALATION_BLOCKED'),
  );
  assert.deepEqual((await service.detail(role.id)).permissionCodes, ['employee.read', 'employee.update', 'permission.trace.self']);
  await assert.rejects(
    () => service.replacePermissions(role.id, { permissionCodes: ['employee.read'], version: 1 }),
    hasCode('VERSION_CONFLICT'),
  );

  const races = await Promise.allSettled([
    service.replacePermissions(role.id, { permissionCodes: ['employee.read'], version: changed.version }),
    service.replacePermissions(role.id, { permissionCodes: ['employee.update'], version: changed.version }),
  ]);
  assert.equal(races.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = races.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  assert.ok(rejected);
  assert.equal(hasCode('VERSION_CONFLICT')(rejected.reason), true);
});

test('replaces validated resource scopes and field capabilities as complete sets', async () => {
  let role = await service.create({ name: 'Employee Reader', code: 'EMPLOYEE_READER' });
  role = await service.replacePermissions(role.id, { permissionCodes: ['employee.read'], version: role.version });
  const allScope = await prisma.dataScope.create({ data: { name: 'All employees', scopeType: 'ALL' } });
  const rootId = randomUUID();
  const root = await prisma.organization.create({
    data: { id: rootId, code: 'SCOPE_ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}` },
  });
  const team = await prisma.professionalTeam.create({
    data: { code: 'SCOPE_TEAM', name: 'Scope Team', categoryCode: 'OTHER', homeOrganizationId: root.id },
  });
  const teamScope = await prisma.dataScope.create({
    data: {
      name: 'Invalid position team',
      scopeType: 'TEAM',
      professionalTeamId: team.id,
    },
  });
  role = await service.replaceDataScopes(role.id, {
    bindings: [{ resource: 'employee', dataScopeId: allScope.id }],
    version: role.version,
  });
  assert.deepEqual(role.dataScopeBindings, [{ resource: 'employee', dataScopeId: allScope.id, scopeType: 'ALL' }]);
  await assert.rejects(
    () => service.replaceDataScopes(role.id, {
      bindings: [{ resource: 'position', dataScopeId: teamScope.id }], version: role.version,
    }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );

  role = await service.replaceFieldPermissions(role.id, {
    fields: [{ resource: 'employee', fieldCode: 'employee.phone', readLevel: 'NONE', canWrite: false, canExport: false }],
    version: role.version,
  });
  assert.deepEqual(role.fieldPermissions, [{
    resource: 'employee', fieldCode: 'employee.phone', readLevel: 'NONE', canWrite: false, canExport: false,
  }]);
  await assert.rejects(
    () => service.replaceFieldPermissions(role.id, {
      fields: [{ resource: 'employee', fieldCode: 'user.password', readLevel: 'READ', canWrite: false, canExport: false }],
      version: role.version,
    }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
});

test('blocks disabling an assigned role and rolls back a replacement when audit fails', async () => {
  let role = await service.create({ name: 'Assigned Role', code: 'ASSIGNED_ROLE' });
  const user = await prisma.user.create({ data: { username: 'assigned.user', password: 'unused' } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  await assert.rejects(() => service.disable(role.id, role.version), hasCode('AUTHORIZATION_IN_USE'));
  await prisma.userRole.updateMany({ data: {
    revokedAt: new Date(), revokedByUserId: user.id, revokeReason: 'Revoke assigned role for test',
  } });
  role = await service.disable(role.id, role.version);
  assert.equal(role.status, 'DISABLED');
  role = await service.enable(role.id, role.version);
  assert.equal(role.status, 'ENABLED');

  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_role_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_role_audit_trigger BEFORE INSERT ON "operation_log" FOR EACH ROW EXECUTE FUNCTION fail_role_audit()`);
  await assert.rejects(() => service.replacePermissions(role.id, {
    permissionCodes: ['employee.read'], version: role.version,
  }));
  const unchanged = await service.detail(role.id);
  assert.equal(unchanged.version, role.version);
  assert.deepEqual(unchanged.permissionCodes, [...basicOfficeCodes].sort());
});

function hasCode(code: string) {
  return (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

test('role deletion preserves history, checks versions, and protects assigned and system roles', async () => {
  const role = await service.create({ name: 'Delete candidate', code: 'DELETE_CANDIDATE' });
  const user = await prisma.user.create({ data: { username: 'role-member', password: 'unused', status: 'DISABLED' } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  await assert.rejects(() => service.remove(role.id, { version: 0 }), hasCode('AUTHORIZATION_INPUT_INVALID'));
  await assert.rejects(() => service.remove(role.id, { version: role.version }), hasCode('AUTHORIZATION_IN_USE'));
  await prisma.user.update({ where: { id: user.id }, data: { status: 'DELETED' } });
  await assert.rejects(() => service.remove(role.id, { version: 2 }), hasCode('VERSION_CONFLICT'));
  await service.remove(role.id, { version: role.version });
  assert.equal((await prisma.role.findUniqueOrThrow({ where: { id: role.id } })).status, 'DELETED');
  assert.equal(await prisma.userRole.count({ where: { roleId: role.id } }), 1);
  assert.equal((await service.list(1, 100)).list.some(item => item.id === role.id), false);
  await assert.rejects(() => service.enable(role.id, 2));
  const system = await prisma.role.create({ data: { name: 'Super', code: 'SYSTEM_SUPER_ADMIN', type: 'SYSTEM' } });
  await assert.rejects(() => service.remove(system.id, { version: system.version }), hasCode('TRUST_ROOT_PROTECTED'));
});

async function dropAuditTrigger() {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_role_audit_trigger ON "operation_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_role_audit()');
}
