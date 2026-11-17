import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;
let superAdminId: string;
let superAdminToken: string;

function bearer(token = superAdminToken): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function createUserWithRole(roleCode: string, roleType: string): Promise<{ id: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { username: `authz.${suffix}`, password: 'not-used' } });
  const role = await prisma.role.create({ data: { name: `Role ${suffix}`, code: roleCode, type: roleType } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const assurance = roleCode === 'SYSTEM_ADMIN' || roleCode === 'SYSTEM_SUPER_ADMIN' ? 'MFA' : 'PASSWORD';
  return { id: user.id, token: (await createApiSession(prisma, user.id, assurance)).token };
}

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  const root = await createUserWithRole('SYSTEM_SUPER_ADMIN', 'SYSTEM');
  superAdminId = root.id;
  superAdminToken = root.token;
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('requires authentication and explicit action permission for authorization APIs', async () => {
  const unauthenticated = await app.httpRequest().get('/api/v1/authorization/me').expect(401);
  assert.equal(unauthenticated.body.code, 401);
  assert.doesNotMatch(JSON.stringify(unauthenticated.body), /Prisma|SELECT|password|secret-hash|Bearer/i);

  const ordinary = await createUserWithRole(`ORDINARY_${randomUUID().replaceAll('-', '').slice(0, 12)}`, 'BUSINESS');
  const summary = await app.httpRequest()
    .get('/api/v1/authorization/me')
    .set(bearer(ordinary.token))
    .expect(200);
  assert.deepEqual(summary.body.data.permissionCodes, []);
  await app.httpRequest()
    .get('/api/v1/authorization/me/trace')
    .set(bearer(ordinary.token))
    .expect(403);
  const denied = await app.httpRequest()
    .get('/api/v1/permissions/catalog')
    .set(bearer(ordinary.token))
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
});

test('account role assignment endpoint preserves history and refuses system-role escalation', async () => {
  const user = await prisma.user.create({ data: { username: 'assign-account', password: 'unused' } });
  const role = await prisma.role.create({ data: { code: 'ASSIGN_BUSINESS', name: '分配角色验收', type: 'BUSINESS' } });
  await app.httpRequest().post(`/api/v1/users/${user.id}/roles`).set(bearer()).send({ roleIds: [role.id] }).expect(200);
  assert.equal(await prisma.userRole.count({ where: { userId: user.id, roleId: role.id, revokedAt: null } }), 1);
  await app.httpRequest().post(`/api/v1/users/${user.id}/roles`).set(bearer()).send({ roleIds: [] }).expect(200);
  assert.equal(await prisma.userRole.count({ where: { userId: user.id, roleId: role.id } }), 1);
  assert.equal(await prisma.userRole.count({ where: { userId: user.id, revokedAt: null } }), 0);
  const root = await prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_SUPER_ADMIN' } });
  await app.httpRequest().post(`/api/v1/users/${user.id}/roles`).set(bearer()).send({ roleIds: [root.id] }).expect(403);
  const response = await app.httpRequest().get(`/api/v1/roles/${root.id}`).set(bearer()).expect(200);
  assert.ok(response.body.data.permissionCodes.includes('position.delete'));
});

test('lists safe field and data-scope catalogs for authorization editors', async () => {
  const organizationId = randomUUID();
  const organization = await prisma.organization.create({ data: {
    id: organizationId, code: 'SCOPE_CATALOG_ROOT', name: 'Scope catalog root', type: 'FIRM',
    path: `/${organizationId}`,
  } });
  const scope = await prisma.dataScope.create({ data: {
    name: 'Scope catalog branch', scopeType: 'ORG', organizationId: organization.id,
    includeDescendants: true,
  } });

  const fields = await app.httpRequest()
    .get('/api/v1/permissions/fields')
    .set(bearer())
    .expect(200);
  assert.ok(fields.body.data.some((field: { code: string; classification: string }) => (
    field.code === 'employee.idCard' && field.classification === 'L4'
  )));
  assert.ok(fields.body.data.every((field: { code: string }) => !/password|credential|locked/i.test(field.code)));

  const scopes = await app.httpRequest()
    .get('/api/v1/permissions/data-scopes')
    .set(bearer())
    .expect(200);
  assert.deepEqual(scopes.body.data, [{
    id: scope.id,
    name: 'Scope catalog branch',
    scopeType: 'ORG',
    includeDescendants: true,
    organization: { id: organization.id, name: 'Scope catalog root' },
    professionalTeam: null,
  }]);
  assert.doesNotMatch(JSON.stringify([fields.body, scopes.body]), /password|token|credentialVersion|Prisma|SELECT/i);
});

test('creates a reusable standard data scope without synthesizing roles or grants', async () => {
  const organizationId = randomUUID();
  await prisma.organization.create({ data: {
    id: organizationId, code: `SCOPE_${organizationId.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
    name: 'Reusable scope branch', type: 'BRANCH', path: `/${organizationId}`,
  } });
  const created = await app.httpRequest()
    .post('/api/v1/permissions/data-scopes')
    .set(bearer())
    .send({ name: 'Reusable branch access', scopeType: 'BRANCH', organizationId, professionalTeamId: null, includeDescendants: true })
    .expect(200);
  assert.equal(created.body.data.scopeType, 'BRANCH');
  assert.equal(created.body.data.organization.id, organizationId);
  assert.equal(await prisma.roleDataScope.count({ where: { dataScopeId: created.body.data.id } }), 0);
  assert.equal(await prisma.userPermissionGrant.count({ where: { dataScopeId: created.body.data.id } }), 0);

  await app.httpRequest()
    .post('/api/v1/permissions/data-scopes')
    .set(bearer())
    .send({ name: 'Invalid branch access', scopeType: 'BRANCH', organizationId: null, professionalTeamId: null, includeDescendants: true })
    .expect(400);
});

test('creates a replacement for a historically deleted role from the role wizard payload', async () => {
  const old = await prisma.role.create({ data: { name: '律师', code: 'LAWYER', type: 'BUSINESS', status: 'DELETED' } });
  const payload = { name: '律师', description: '总所律师', basicOffice: true, worksheets: [] };
  const created = await app.httpRequest().post('/api/v1/roles').set(bearer()).send(payload).expect(200);
  assert.notEqual(created.body.data.id, old.id);
  assert.match(created.body.data.code, /^ROLE_[A-F0-9]{24}$/);
  assert.equal(created.body.data.name, '律师');
  assert.equal(created.body.data.description, '总所律师');
  assert.equal(await prisma.userRole.count({ where: { roleId: created.body.data.id } }), 0);
  const duplicate = await app.httpRequest().post('/api/v1/roles').set(bearer()).send(payload).expect(409);
  assert.equal(duplicate.body.message, 'AUTHORIZATION_IN_USE');
  const listing = await app.httpRequest().get('/api/v1/roles?keyword=' + encodeURIComponent('律师')).set(bearer()).expect(200);
  assert.deepEqual(listing.body.data.list.map((r: { id: string }) => r.id), [created.body.data.id]);
});

test('creates and versions a business role through strict DTOs without leaking secrets', async () => {
  const invalid = await app.httpRequest()
    .post('/api/v1/roles')
    .set(bearer())
    .send({ name: 'Branch Reader', code: 'BRANCH_READER', unexpected: true })
    .expect(400);
  assert.equal(invalid.body.message, 'AUTHORIZATION_INPUT_INVALID');

  const created = await app.httpRequest()
    .post('/api/v1/roles')
    .set(bearer())
    .send({ name: 'Branch Reader', code: 'BRANCH_READER', description: 'Branch read access' })
    .expect(200);
  assert.equal(created.body.data.version, 1);
  assert.deepEqual(created.body.data.permissionCodes, []);

  const changed = await app.httpRequest()
    .patch(`/api/v1/roles/${created.body.data.id}`)
    .set(bearer())
    .send({ name: 'Branch Reader Updated', version: 1 })
    .expect(200);
  assert.equal(changed.body.data.version, 2);

  const stale = await app.httpRequest()
    .patch(`/api/v1/roles/${created.body.data.id}`)
    .set(bearer())
    .send({ name: 'Stale Update', version: 1 })
    .expect(409);
  assert.equal(stale.body.message, 'VERSION_CONFLICT');
  assert.doesNotMatch(JSON.stringify([created.body, changed.body, stale.body]), /password|token|idCard|Prisma|SELECT/i);
});

test('grants and revokes one role history record and explains the target permissions', async () => {
  const target = await prisma.user.create({ data: { username: 'grant.api.target', password: 'secret-hash' } });
  const role = await prisma.role.create({ data: {
    name: 'Employee Reader', code: 'EMPLOYEE_API_READER', type: 'BUSINESS',
    permissions: { create: { permission: { connect: { code: 'employee.read' } } } },
  } });
  const grant = await app.httpRequest()
    .post(`/api/v1/users/${target.id}/role-grants`)
    .set(bearer())
    .send({ roleId: role.id, source: 'PERMANENT', validFrom: new Date().toISOString(), validUntil: null, reason: null })
    .expect(200);
  assert.equal(grant.body.data.roleId, role.id);

  const trace = await app.httpRequest()
    .get(`/api/v1/authorization/trace/users/${target.id}?permissionCode=employee.read`)
    .set(bearer())
    .expect(200);
  assert.equal(trace.body.data.allowed, true);
  assert.equal(trace.body.data.sources[0].sourceId, grant.body.data.id);
  assert.doesNotMatch(JSON.stringify(trace.body), /secret-hash|password|token|SELECT|where/i);

  const revoked = await app.httpRequest()
    .post(`/api/v1/users/${target.id}/role-grants/${grant.body.data.id}/revoke`)
    .set(bearer())
    .send({ reason: 'Access no longer required', version: grant.body.data.version })
    .expect(200);
  assert.ok(revoked.body.data.revokedAt);
  assert.equal(await prisma.userRole.count({ where: { id: grant.body.data.id } }), 1);
});

test('hides an employee outside a temporary sensitive grant scope without leaking L4 data', async () => {
  const rootId = randomUUID();
  const branchAId = randomUUID();
  const branchBId = randomUUID();
  await prisma.organization.create({
    data: {
      id: rootId,
      code: 'AUTH_ROOT',
      name: 'Authorization Root',
      type: 'FIRM',
      path: `/${rootId}`,
      children: {
        create: [
          { id: branchAId, code: 'AUTH_BRANCH_A', name: 'Branch A', type: 'BRANCH', path: `/${rootId}/${branchAId}`, level: 1 },
          { id: branchBId, code: 'AUTH_BRANCH_B', name: 'Branch B', type: 'BRANCH', path: `/${rootId}/${branchBId}`, level: 1 },
        ],
      },
    },
  });
  const position = await prisma.position.create({
    data: { organizationId: branchBId, code: 'AUTH_LAWYER', name: 'Lawyer', categoryCode: 'LEGAL' },
  });
  const outsideEmployee = await prisma.employee.create({
    data: {
      employeeNo: 'AUTH-OUTSIDE-001',
      name: 'Outside Employee',
      phone: '13800000000',
      idCard: '500000199001010000',
      type: 'LAWYER',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
      assignments: {
        create: {
          organizationId: branchBId,
          positionId: position.id,
          assignmentType: 'PRIMARY',
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      },
    },
  });
  const grantee = await prisma.user.create({ data: { username: 'sensitive.scope.user', password: 'not-used' } });
  const scope = await prisma.dataScope.create({
    data: { name: 'Branch A only', scopeType: 'BRANCH', organizationId: branchAId, includeDescendants: true },
  });
  const now = Date.now();
  await prisma.userPermissionGrant.create({
    data: {
      userId: grantee.id,
      permissionId: 'permission:employee.high_sensitive.read',
      dataScopeId: scope.id,
      validFrom: new Date(now - 60_000),
      validUntil: new Date(now + 60 * 60 * 1000),
      reason: 'Temporary employee identity verification',
      grantedByUserId: superAdminId,
    },
  });
  const token = (await createApiSession(prisma, grantee.id)).token;

  const hidden = await app.httpRequest()
    .post('/api/v1/authorization/sensitive-view')
    .set(bearer(token))
    .send({
      resource: 'employee',
      resourceId: outsideEmployee.id,
      fieldCodes: ['employee.idCard'],
      purpose: 'Verify employee identity for filing',
    })
    .expect(404);
  assert.equal(hidden.body.message, 'RESOURCE_NOT_FOUND_OR_FORBIDDEN');
  assert.doesNotMatch(JSON.stringify(hidden.body), /500000199001010000|Outside Employee|Prisma|SELECT|where/i);
});

test('scopes user list and detail through bound employees while hiding unbound governance accounts', async () => {
  const rootId = randomUUID();
  const branchAId = randomUUID();
  const branchBId = randomUUID();
  await prisma.organization.createMany({ data: [
    { id: rootId, code: 'USER_ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}`, level: 0 },
    { id: branchAId, code: 'USER_BRANCH_A', name: 'Branch A', type: 'BRANCH', parentId: rootId, path: `/${rootId}/${branchAId}`, level: 1 },
    { id: branchBId, code: 'USER_BRANCH_B', name: 'Branch B', type: 'BRANCH', parentId: rootId, path: `/${rootId}/${branchBId}`, level: 1 },
  ] });
  const positionA = await prisma.position.create({ data: {
    organizationId: branchAId, code: 'USER_POSITION_A', name: 'A', categoryCode: 'LEGAL',
  } });
  const positionB = await prisma.position.create({ data: {
    organizationId: branchBId, code: 'USER_POSITION_B', name: 'B', categoryCode: 'LEGAL',
  } });
  const employeeA = await prisma.employee.create({ data: {
    employeeNo: 'USER-EMP-A', name: 'Employee A', phone: '13800000001', type: 'LAWYER',
    entryDate: new Date('2026-01-01'),
    assignments: { create: { organizationId: branchAId, positionId: positionA.id, assignmentType: 'PRIMARY', startedAt: new Date('2026-01-01') } },
  } });
  const employeeB = await prisma.employee.create({ data: {
    employeeNo: 'USER-EMP-B', name: 'Employee B', phone: '13800000002', type: 'LAWYER',
    entryDate: new Date('2026-01-01'),
    assignments: { create: { organizationId: branchBId, positionId: positionB.id, assignmentType: 'PRIMARY', startedAt: new Date('2026-01-01') } },
  } });
  const userA = await prisma.user.create({ data: { username: 'branch.a.user', password: 'secret-a', employeeId: employeeA.id } });
  const userB = await prisma.user.create({ data: { username: 'branch.b.user', password: 'secret-b', employeeId: employeeB.id } });
  const unbound = await prisma.user.create({ data: { username: 'unbound.governance', password: 'secret-unbound' } });
  const reader = await prisma.user.create({ data: { username: 'branch.a.reader', password: 'secret-reader' } });
  const scope = await prisma.dataScope.create({ data: {
    name: 'Branch A users', scopeType: 'BRANCH', organizationId: branchAId, includeDescendants: true,
  } });
  const role = await prisma.role.create({ data: {
    name: 'Branch A User Reader', code: 'BRANCH_A_USER_READER', type: 'BUSINESS',
    permissions: { create: [
      { permission: { connect: { code: 'user.read' } } },
      { permission: { connect: { code: 'user.update' } } },
    ] },
  } });
  await prisma.roleDataScope.create({ data: { roleId: role.id, resource: 'user', dataScopeId: scope.id } });
  await prisma.userRole.create({ data: { userId: reader.id, roleId: role.id } });
  const token = (await createApiSession(prisma, reader.id)).token;

  const list = await app.httpRequest().get('/api/v1/users').set(bearer(token)).expect(200);
  assert.deepEqual(list.body.data.list.map((item: { id: string }) => item.id), [userA.id]);
  assert.doesNotMatch(
    JSON.stringify(list.body),
    /secret-a|secret-b|secret-unbound|credentialVersion|mustChangePassword|passwordChangedAt|13800000001/i,
  );
  assert.equal((await app.httpRequest().get(`/api/v1/users/${userA.id}`).set(bearer(token)).expect(200)).body.data.id, userA.id);
  await app.httpRequest().get(`/api/v1/users/${userB.id}`).set(bearer(token)).expect(404);
  await app.httpRequest().get(`/api/v1/users/${unbound.id}`).set(bearer(token)).expect(404);
  await app.httpRequest().put(`/api/v1/users/${userA.id}`).set(bearer(token)).send({ status: 'DISABLED' }).expect(200);
  await app.httpRequest().put(`/api/v1/users/${userB.id}`).set(bearer(token)).send({ status: 'DISABLED' }).expect(404);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userB.id } })).status, 'ENABLED');
});

test('does not expose legacy destructive authorization endpoints', async () => {
  const role = await prisma.role.create({ data: { name: 'Legacy Block', code: 'LEGACY_BLOCK', type: 'BUSINESS' } });
  const target = await prisma.user.create({ data: { username: 'legacy.target', password: 'not-used' } });
  await app.httpRequest().delete(`/api/v1/roles/${role.id}`).set(bearer()).expect(400);
  // Role assignment is now a supported, audited command (covered above).
  await app.httpRequest().post(`/api/v1/users/${target.id}/roles`).set(bearer()).send({ roleIds: [] }).expect(200);
  await app.httpRequest().post(`/api/v1/roles/${role.id}/permissions`).set(bearer()).send({ permissionIds: [] }).expect(404);
  assert.ok(await prisma.role.findUnique({ where: { id: role.id } }));
  assert.equal(superAdminId === target.id, false);
});

test('retires disabled accounts with session and grant history without breaking references', async () => {
  const role = await prisma.role.create({ data: { name: 'Removable', code: 'REMOVABLE', type: 'BUSINESS' } });
  const employee = await prisma.employee.create({ data: { employeeNo: 'RETIRE', name: 'Retire employee', phone: '13800000000', type: 'ADMIN', status: 'FORMAL', entryDate: new Date() } });
  const user = await prisma.user.create({ data: { username: 'retire-account', password: 'unused', employeeId: employee.id } });
  const session = await createApiSession(prisma, user.id);
  const grant = await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, grantedByUserId: superAdminId } });
  await app.httpRequest().delete(`/api/v1/users/${user.id}`).set(bearer()).expect(409);
  await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
  await app.httpRequest().delete(`/api/v1/users/${user.id}`).set(bearer()).send({}).expect(200);
  const removed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(removed.status, 'DELETED');
  assert.equal(removed.employeeId, null);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: session.sessionId } })).revokedAt);
  assert.ok((await prisma.userRole.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt);
  await app.httpRequest().get(`/api/v1/users/${user.id}`).set(bearer()).expect(404);
  await app.httpRequest().put(`/api/v1/users/${user.id}`).set(bearer()).send({ status: 'ENABLED' }).expect(404);
  const list = await app.httpRequest().get('/api/v1/users?keyword=retire-account').set(bearer()).expect(200);
  assert.equal(list.body.data.pagination.total, 0);
  assert.equal(await prisma.user.findUnique({ where: { username: 'retire-account' } }), null);
  const replacement = await app.httpRequest().post('/api/v1/users').set(bearer()).send({ username: 'retire-account', password: 'Replacement-94!' }).expect(200);
  assert.notEqual(replacement.body.data.id, user.id);
  assert.equal(await prisma.userRole.count({ where: { userId: replacement.body.data.id } }), 0);
  await app.httpRequest().get('/api/v1/authorization/me').set(bearer(session.token)).expect(401);
  await app.httpRequest().delete(`/api/v1/roles/${role.id}`).set(bearer()).send({ version: role.version }).expect(200);
  await app.httpRequest().get(`/api/v1/roles/${role.id}`).set(bearer()).expect(404);
  await app.httpRequest().delete(`/api/v1/users/${superAdminId}`).set(bearer()).expect(409);
  const protectedAccount = await prisma.user.create({ data: { username: 'disabled-super-admin', password: 'unused', status: 'DISABLED' } });
  const rootRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_SUPER_ADMIN' } });
  await prisma.userRole.create({ data: { userId: protectedAccount.id, roleId: rootRole.id } });
  await app.httpRequest().put(`/api/v1/users/${protectedAccount.id}`).set(bearer()).send({ status: 'ENABLED' }).expect(200);
  await app.httpRequest().put(`/api/v1/users/${protectedAccount.id}`).set(bearer()).send({ status: 'DISABLED' }).expect(200);
  await app.httpRequest().delete(`/api/v1/users/${protectedAccount.id}`).set(bearer()).expect(200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: protectedAccount.id } })).status, 'DELETED');
});

test('initial admin remains protected when another super administrator attempts disable or deletion', async () => {
  const rootId = randomUUID();
  await prisma.organization.create({ data: { id: rootId, code: 'PROTECTED_ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}` } });
  const admin = await prisma.user.create({ data: { username: 'admin', password: 'unused' } });
  await prisma.systemInitialization.create({ data: { id: 'PRIMARY', rootOrganizationId: rootId, superAdminUserId: admin.id, completedAt: new Date() } });
  await app.httpRequest().put(`/api/v1/users/${admin.id}`).set(bearer()).send({ status: 'DISABLED' }).expect(409);
  await app.httpRequest().delete(`/api/v1/users/${admin.id}`).set(bearer()).expect(409);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).status, 'ENABLED');
});

test('account retirement requires and atomically transfers private documents to an active employee', async () => {
  const source = await prisma.user.create({ data: { username: 'private-owner', password: 'unused', status: 'DISABLED' } });
  const employee = await prisma.employee.create({ data: { employeeNo: 'RECEIVER', name: 'Recipient', phone: '13800000000', type: 'ADMIN', status: 'FORMAL', entryDate: new Date() } });
  const recipient = await prisma.user.create({ data: { username: 'recipient', password: 'unused', employeeId: employee.id } });
  const organizationId = randomUUID();
  await prisma.organization.create({ data: { id: organizationId, code: 'PRIVATE_ROOT', name: 'Root', type: 'FIRM', path: `/${organizationId}` } });
  const workspace = await prisma.collabWorkspace.create({ data: { name: 'Private material', ownerId: source.id, organizationId } });
  const node = await prisma.driveNode.create({ data: { workspaceId: workspace.id, ownerId: source.id, kind: 'FOLDER', folderName: 'Unshared', accessPolicy: { restricted: true, grants: [] } } });
  await app.httpRequest().delete(`/api/v1/users/${source.id}`).set(bearer()).send({}).expect(409);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: source.id } })).status, 'DISABLED');
  await app.httpRequest().delete(`/api/v1/users/${source.id}`).set(bearer()).send({ recipientUserId: 'missing' }).expect(400);
  assert.equal((await prisma.driveNode.findUniqueOrThrow({ where: { id: node.id } })).ownerId, source.id);
  await app.httpRequest().delete(`/api/v1/users/${source.id}`).set(bearer()).send({ recipientUserId: recipient.id }).expect(200);
  assert.equal((await prisma.driveNode.findUniqueOrThrow({ where: { id: node.id } })).ownerId, recipient.id);
  assert.equal((await prisma.collabWorkspace.findUniqueOrThrow({ where: { id: workspace.id } })).ownerId, recipient.id);
  assert.equal((await prisma.collabMember.findFirstOrThrow({ where: { workspaceId: workspace.id, principalId: recipient.id } })).role, 'OWNER');
});
