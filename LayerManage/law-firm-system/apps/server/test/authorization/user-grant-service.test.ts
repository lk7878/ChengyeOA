import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { UserGrantService } from '../../app/application/authorization/user-grant-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let prisma: PrismaClient;
let actor: Awaited<ReturnType<typeof createUser>>;
let target: Awaited<ReturnType<typeof createUser>>;
let service: UserGrantService;

test.before(() => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  actor = await createUser('grant.admin');
  target = await createUser('grant.target');
  service = new UserGrantService(prisma, superAdminContext(actor.id));
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('grants permanent and temporary business roles and revokes without deleting history', async () => {
  const role = await prisma.role.create({ data: { name: 'Branch Staff', code: 'BRANCH_STAFF', type: 'BUSINESS' } });
  const permanent = await service.grantRole(target.id, role.id, {
    source: 'PERMANENT', validFrom: '2026-07-18T00:00:00.000Z', validUntil: null, reason: null,
  });
  assert.equal(permanent.source, 'PERMANENT');
  await assert.rejects(() => service.grantRole(target.id, role.id, {
    source: 'TEMPORARY', validFrom: '2026-07-19T00:00:00.000Z', validUntil: '2026-07-20T00:00:00.000Z',
    reason: 'Temporary branch coverage',
  }), hasCode('AUTHORIZATION_IN_USE'));
  const revoked = await service.revokeRole(target.id, permanent.id, { reason: 'Role no longer required', version: 1 });
  assert.ok(revoked.revokedAt);
  assert.equal(await prisma.userRole.count({ where: { id: permanent.id } }), 1);
  const temporary = await service.grantRole(target.id, role.id, {
    source: 'TEMPORARY', validFrom: '2026-07-19T00:00:00.000Z', validUntil: '2026-07-20T00:00:00.000Z',
    reason: 'Temporary branch coverage',
  });
  assert.equal(temporary.source, 'TEMPORARY');
  await assert.rejects(
    () => service.grantRole(actor.id, role.id, {
      source: 'PERMANENT', validFrom: '2026-07-18T00:00:00.000Z', validUntil: null, reason: null,
    }),
    hasCode('PRIVILEGE_ESCALATION_BLOCKED'),
  );
});

test('blocks reserved disabled and concurrent overlapping role grants', async () => {
  const role = await prisma.role.create({ data: { name: 'Concurrent', code: 'CONCURRENT_ROLE', type: 'BUSINESS' } });
  const results = await Promise.allSettled([
    service.grantRole(target.id, role.id, { source: 'PERMANENT', validFrom: '2026-07-18T00:00:00.000Z', validUntil: null, reason: null }),
    service.grantRole(target.id, role.id, { source: 'PERMANENT', validFrom: '2026-07-18T00:00:00.000Z', validUntil: null, reason: null }),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = results.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  assert.ok(rejected);
  assert.equal(hasCode('AUTHORIZATION_IN_USE')(rejected.reason), true);
  const reserved = await prisma.role.create({ data: { name: 'System', code: 'SYSTEM_ADMIN', type: 'SYSTEM' } });
  await assert.rejects(
    () => service.grantRole(target.id, reserved.id, { source: 'PERMANENT', validFrom: '2026-07-18T00:00:00.000Z', validUntil: null, reason: null }),
    hasCode('PRIVILEGE_ESCALATION_BLOCKED'),
  );
});

test('grants only allowed temporary SPECIAL permissions with scope and revokes them', async () => {
  const scope = await prisma.dataScope.create({ data: { name: 'All employees', scopeType: 'ALL' } });
  const grant = await service.grantSpecial(target.id, {
    permissionCode: 'employee.high_sensitive.read', dataScopeId: scope.id,
    validFrom: '2026-07-18T00:00:00.000Z', validUntil: '2026-07-19T00:00:00.000Z',
    reason: 'Temporary identity verification',
  });
  assert.equal(grant.permissionCode, 'employee.high_sensitive.read');
  await assert.rejects(() => service.grantSpecial(target.id, {
    permissionCode: 'employee.read', dataScopeId: scope.id,
    validFrom: '2026-07-18T00:00:00.000Z', validUntil: '2026-07-19T00:00:00.000Z',
    reason: 'Invalid ordinary permission',
  }), hasCode('AUTHORIZATION_INPUT_INVALID'));
  const revoked = await service.revokeSpecial(target.id, grant.id, { reason: 'Sensitive access completed', version: 1 });
  assert.ok(revoked.revokedAt);
});

function superAdminContext(userId: string): AuthorizationContext {
  return { userId, employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: true, grants: [], fieldRules: [], permissionCodes: [], evaluatedAt: new Date() };
}
function createUser(username: string) { return prisma.user.create({ data: { username, password: 'unused' } }); }
function hasCode(code: string) { return (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code); }

// SPEC-015 follow-up（业务角色成员指派）：非 super-admin 但持有可委派权限码的上下文。
function membershipManagerContext(userId: string): AuthorizationContext {
  return {
    userId, employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: false, grants: [], fieldRules: [],
    permissionCodes: ['user_role.membership.manage'], evaluatedAt: new Date(),
  };
}

test('a delegated operator holding user_role.membership.manage can grant and revoke business role membership', async () => {
  const actor = await createUser('grant.hr');
  const delegated = new UserGrantService(prisma, membershipManagerContext(actor.id));
  const role = await prisma.role.create({ data: { name: 'HR Member', code: 'HR_MEMBER', type: 'BUSINESS' } });

  const granted = await delegated.grantRole(target.id, role.id, {
    source: 'PERMANENT', validFrom: '2026-07-18T00:00:00.000Z', validUntil: null, reason: null,
  });
  assert.equal(granted.source, 'PERMANENT');
  assert.equal(await prisma.userRole.count({ where: { id: granted.id } }), 1, 'grant persists');

  const revoked = await delegated.revokeRole(target.id, granted.id, { reason: 'member left the HR role', version: 1 });
  assert.ok(revoked.revokedAt, 'delegated revoke soft-revokes');
});

test('a non-super-admin WITHOUT user_role.membership.manage is still blocked from role membership management', async () => {
  const actor = await createUser('grant.plain');
  const plain = new UserGrantService(prisma, {
    userId: actor.id, employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: false, grants: [], fieldRules: [],
    permissionCodes: ['user.read'], evaluatedAt: new Date(),
  });
  const role = await prisma.role.create({ data: { name: 'Plain', code: 'PLAIN_ROLE', type: 'BUSINESS' } });

  await assert.rejects(
    () => plain.grantRole(target.id, role.id, {
      source: 'PERMANENT', validFrom: '2026-07-18T00:00:00.000Z', validUntil: null, reason: null,
    }),
    hasCode('PRIVILEGE_ESCALATION_BLOCKED'),
    'operator without the delegable permission is blocked',
  );
});

test('a delegated operator cannot grant membership to themselves (self-edit guard preserved)', async () => {
  const actor = await createUser('grant.self');
  const delegated = new UserGrantService(prisma, membershipManagerContext(actor.id));
  const role = await prisma.role.create({ data: { name: 'Self', code: 'SELF_ROLE', type: 'BUSINESS' } });

  await assert.rejects(
    () => delegated.grantRole(actor.id, role.id, {
      source: 'PERMANENT', validFrom: '2026-07-18T00:00:00.000Z', validUntil: null, reason: null,
    }),
    hasCode('PRIVILEGE_ESCALATION_BLOCKED'),
    'delegated operator cannot assign themselves a role',
  );
});

test('listRoleMembers returns the role members with user identity and derived grant state', async () => {
  const role = await prisma.role.create({ data: { name: 'HR Team', code: 'HR_TEAM', type: 'BUSINESS' } });
  const member1 = await createUser('member.one');
  const member2 = await createUser('member.two');
  // 一个永久 ACTIVE 成员 + 一个已撤销成员 + 一个未来生效 PENDING 成员。
  const active = await service.grantRole(member1.id, role.id, {
    source: 'PERMANENT', validFrom: '2026-07-18T00:00:00.000Z', validUntil: null, reason: null,
  });
  await service.grantRole(member2.id, role.id, {
    source: 'TEMPORARY', validFrom: '2026-07-19T00:00:00.000Z', validUntil: '2026-07-20T00:00:00.000Z',
    reason: 'Temporary coverage',
  });
  const pending = await service.grantRole(member2.id, role.id, {
    source: 'TEMPORARY', validFrom: '2099-01-01T00:00:00.000Z', validUntil: '2099-01-02T00:00:00.000Z',
    reason: 'Future assignment',
  });

  const members = await service.listRoleMembers(role.id);

  // 按 validFrom desc：pending(2099) > active(2026-07-18) > temporary(2026-07-19 revoked? no) —— 实际 3 条。
  assert.equal(members.length, 3, 'all role members listed');
  const activeView = members.find(member => member.id === active.id)!;
  assert.equal(activeView.username, 'member.one');
  assert.equal(activeView.state, 'ACTIVE', 'permanent active member is ACTIVE');
  const pendingView = members.find(member => member.id === pending.id)!;
  assert.equal(pendingView.state, 'PENDING', 'future grant is PENDING');
  assert.equal(members[0].id, pending.id, 'newest validFrom sorts first');

  // 撤销后状态变 REVOKED。
  await service.revokeRole(member1.id, active.id, { reason: 'left the HR team role', version: 1 });
  const after = await service.listRoleMembers(role.id);
  assert.equal(after.find(member => member.id === active.id)!.state, 'REVOKED', 'revoked grant is REVOKED');
});
