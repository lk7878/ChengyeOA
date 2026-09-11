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
let rootId: string;
let superAdminToken: string;

async function tokenForRole(code: string, type: string): Promise<string> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { username: `spec003.${suffix}`, password: 'not-used', status: 'ENABLED' },
  });
  const role = await prisma.role.create({
    data: { name: `SPEC-003 ${suffix}`, code, type, status: 'ENABLED' },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const assurance = code === 'SYSTEM_ADMIN' || code === 'SYSTEM_SUPER_ADMIN' ? 'MFA' : 'PASSWORD';
  return (await createApiSession(prisma, user.id, assurance)).token;
}

function bearer(token = superAdminToken): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  rootId = randomUUID();
  await prisma.organization.create({
    data: { id: rootId, code: 'ROOT', name: 'Root Firm', type: 'FIRM', path: `/${rootId}` },
  });
  superAdminToken = await tokenForRole('SYSTEM_SUPER_ADMIN', 'SYSTEM');
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('supports the complete organization-to-employee-to-team administration flow', async () => {
  const branchResponse = await app.httpRequest()
    .post('/api/v1/organizations')
    .set(bearer())
    .send({ code: 'SH_BRANCH', name: 'Shanghai Branch', type: 'BRANCH', parentId: rootId })
    .expect(200);
  const branch = branchResponse.body.data;

  const positionResponse = await app.httpRequest()
    .post('/api/v1/positions')
    .set(bearer())
    .send({ organizationId: branch.id, code: 'LAWYER', name: 'Lawyer', categoryCode: 'LEGAL', level: 1 })
    .expect(200);
  const position = positionResponse.body.data;

  const employeeResponse = await app.httpRequest()
    .post('/api/v1/employees')
    .set(bearer())
    .send({
      employeeNo: 'EMP-001',
      name: 'Test Lawyer',
      phone: '13800000000',
      idCard: '500000199001010000',
      employeeType: 'LAWYER',
      entryDate: '2026-07-18',
      primaryOrganizationId: branch.id,
      primaryPositionId: position.id,
    })
    .expect(200);
  const employee = employeeResponse.body.data;
  assert.equal(employee.primaryAssignment.organizationId, branch.id);
  assert.equal(employee.phone, '13800000000');
  assert.equal('idCard' in employee, false);
  assert.doesNotMatch(JSON.stringify(employeeResponse.body), /password/i);

  const secondPosition = await prisma.position.create({
    data: { organizationId: branch.id, code: 'EXPERT', name: 'Expert', categoryCode: 'LEGAL' },
  });
  const assignmentResponse = await app.httpRequest()
    .post(`/api/v1/employees/${employee.id}/assignments`)
    .set(bearer())
    .send({ organizationId: branch.id, positionId: secondPosition.id, assignmentType: 'SECONDARY' })
    .expect(200);
  assert.equal(assignmentResponse.body.data.assignments.length, 2);

  const account = await prisma.user.create({ data: { username: 'employee.account', password: 'secret-hash' } });
  const bindingResponse = await app.httpRequest()
    .put(`/api/v1/employees/${employee.id}/account-binding`)
    .set(bearer())
    .send({ userId: account.id, employeeVersion: assignmentResponse.body.data.version })
    .expect(200);
  assert.equal(bindingResponse.body.data.account.id, account.id);
  assert.doesNotMatch(JSON.stringify(bindingResponse.body), /secret-hash|password/i);

  const accountToken = (await createApiSession(prisma, account.id)).token;
  const meResponse = await app.httpRequest()
    .get('/api/v1/auth/me')
    .set(bearer(accountToken))
    .expect(200);
  assert.equal(meResponse.body.data.employee.primaryAssignment.organizationId, branch.id);
  assert.equal('orgId' in meResponse.body.data.employee, false);
  assert.equal('positionId' in meResponse.body.data.employee, false);
  assert.equal('organization' in meResponse.body.data.employee, false);
  assert.equal('position' in meResponse.body.data.employee, false);

  const teamResponse = await app.httpRequest()
    .post('/api/v1/professional-teams')
    .set(bearer())
    .send({ code: 'CIVIL_TEAM', name: 'Civil Team', categoryCode: 'CIVIL', homeOrganizationId: rootId })
    .expect(200);
  const memberResponse = await app.httpRequest()
    .post(`/api/v1/professional-teams/${teamResponse.body.data.id}/members`)
    .set(bearer())
    .send({ employeeId: employee.id, memberRole: 'LEAD' })
    .expect(200);
  assert.equal(memberResponse.body.data.members[0].employeeId, employee.id);

  const auditText = (await prisma.operationLog.findMany())
    .flatMap(log => [log.oldValues, log.newValues])
    .filter((value): value is string => value !== null)
    .join(' ');
  assert.doesNotMatch(auditText, /Test Lawyer|13800000000|secret-hash/);
  assert.equal(await prisma.operationLog.count({
    where: { userId: { not: null }, action: 'READ_L3_FIELDS', targetId: employee.id },
  }) > 0, true);
});

test('rejects users without formal permissions for every SPEC-003 resource prefix', async () => {
  const ordinaryToken = await tokenForRole('BUSINESS_ADMIN', 'BUSINESS');
  for (const path of [
    '/api/v1/organizations/tree',
    '/api/v1/positions',
    '/api/v1/employees',
    '/api/v1/professional-teams',
  ]) {
    const response = await app.httpRequest().get(path).set(bearer(ordinaryToken)).expect(403);
    assert.equal(response.body.message, path.includes('/organizations/') ? 'SUPER_ADMIN_REQUIRED' : 'PERMISSION_DENIED');
  }
});

test('maps validation, missing records, and optimistic conflicts to stable responses', async () => {
  const invalid = await app.httpRequest()
    .post('/api/v1/employees')
    .set(bearer())
    .send({ unexpected: true })
    .expect(400);
  assert.equal(invalid.body.message, 'VALIDATION_FAILED');

  const missing = await app.httpRequest()
    .get(`/api/v1/employees/${randomUUID()}`)
    .set(bearer())
    .expect(404);
  assert.equal(missing.body.message, 'RESOURCE_NOT_FOUND_OR_FORBIDDEN');

  for (const path of [
    `/api/v1/organizations/${randomUUID()}`,
    `/api/v1/positions/${randomUUID()}`,
  ]) {
    const hidden = await app.httpRequest().get(path).set(bearer()).expect(404);
    assert.equal(hidden.body.message, 'RESOURCE_NOT_FOUND_OR_FORBIDDEN');
  }

  const position = await prisma.position.create({
    data: { organizationId: rootId, code: 'STALE_TEST', name: 'Stale Test', categoryCode: 'TEST' },
  });
  const employee = await prisma.employee.create({
    data: {
      employeeNo: 'STALE-001',
      name: 'Stale Employee',
      phone: '13800000000',
      type: 'LAWYER',
      entryDate: new Date('2026-01-01'),
    },
  });
  await prisma.employeeAssignment.create({
    data: {
      employeeId: employee.id,
      organizationId: rootId,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: employee.entryDate,
    },
  });
  const stale = await app.httpRequest()
    .patch(`/api/v1/employees/${employee.id}`)
    .set(bearer())
    .send({ name: 'Changed Name', version: 2 })
    .expect(409);
  assert.equal(stale.body.message, 'VERSION_CONFLICT');
});

test('requires the dedicated account-binding endpoint for employee identity links', async () => {
  const position = await prisma.position.create({
    data: { organizationId: rootId, code: 'BIND_TEST', name: 'Bind Test', categoryCode: 'TEST' },
  });
  const employee = await prisma.employee.create({
    data: {
      employeeNo: 'BIND-001',
      name: 'Binding Employee',
      phone: '13800000000',
      type: 'LAWYER',
      entryDate: new Date('2026-01-01'),
    },
  });
  await prisma.employeeAssignment.create({
    data: {
      employeeId: employee.id,
      organizationId: rootId,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: employee.entryDate,
    },
  });
  const rejectedCreate = await app.httpRequest()
    .post('/api/v1/users')
    .set(bearer())
    .send({ username: 'bypass.create', password: 'Strong-Horse-94!', employeeId: employee.id })
    .expect(400);
  assert.equal(rejectedCreate.body.message, 'ACCOUNT_BINDING_REQUIRES_DEDICATED_ENDPOINT');

  const user = await prisma.user.create({ data: { username: 'bypass.update', password: 'not-used' } });
  const rejectedUpdate = await app.httpRequest()
    .put(`/api/v1/users/${user.id}`)
    .set(bearer())
    .send({ employeeId: employee.id })
    .expect(400);
  assert.equal(rejectedUpdate.body.message, 'ACCOUNT_BINDING_REQUIRES_DEDICATED_ENDPOINT');
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).employeeId, null);
});

test('delete endpoints require versioned commands rather than an unconfirmed empty request', async () => {
  for (const path of [
    `/api/v1/positions/${randomUUID()}`,
    `/api/v1/employees/${randomUUID()}`,
  ]) {
    await app.httpRequest().delete(path).set(bearer()).expect(400);
  }
});

test('deletes unused positions and employee profiles, preserving historical references and reusable numbers', async () => {
  const unused = await prisma.position.create({ data: { organizationId: rootId, code: 'UNUSED', name: 'Unused', categoryCode: 'LEGAL' } });
  await app.httpRequest().delete(`/api/v1/positions/${unused.id}`).set(bearer()).send({ version: 99 }).expect(409);
  await app.httpRequest().delete(`/api/v1/positions/${unused.id}`).set(bearer()).send({ version: 1 }).expect(200);
  const position = await prisma.position.create({ data: { organizationId: rootId, code: 'LAWYER', name: 'Lawyer', categoryCode: 'LEGAL' } });
  const input = { employeeNo: 'REUSE-API', name: 'Old employee', phone: '13800000000', employeeType: 'LAWYER', entryDate: '2026-01-01', primaryOrganizationId: rootId, primaryPositionId: position.id };
  const created = (await app.httpRequest().post('/api/v1/employees').set(bearer()).send(input).expect(200)).body.data;
  await app.httpRequest().delete(`/api/v1/employees/${created.id}`).set(bearer()).send({ version: 1 }).expect(400);
  await app.httpRequest().delete(`/api/v1/employees/${created.id}`).set(bearer()).send({ version: 1, confirmed: true }).expect(200);
  await app.httpRequest().get(`/api/v1/employees/${created.id}`).set(bearer()).expect(404);
  const replacement = (await app.httpRequest().post('/api/v1/employees').set(bearer()).send({ ...input, name: 'New employee' }).expect(200)).body.data;
  assert.notEqual(replacement.id, created.id);
  assert.ok((await prisma.employee.findUniqueOrThrow({ where: { id: created.id } })).deletedAt);
  const rejected = await app.httpRequest().delete(`/api/v1/positions/${position.id}`).set(bearer()).send({ version: 1 }).expect(409);
  assert.equal(rejected.body.message, 'POSITION_DELETE_IN_USE');
});

test('SPEC-003-A supports manager editing, nested copy and guarded deletion over HTTP', async () => {
  const source = (await app.httpRequest().post('/api/v1/organizations').set(bearer())
    .send({ code: 'SOURCE', name: '源部门', type: 'DEPARTMENT', parentId: rootId }).expect(200)).body.data;
  await app.httpRequest().post('/api/v1/organizations').set(bearer())
    .send({ code: 'CHILD', name: '下级工作组', type: 'GROUP', parentId: source.id }).expect(200);
  await prisma.position.create({ data: { organizationId: source.id, code: 'LAWYER', name: '律师岗位', categoryCode: 'LEGAL' } });
  const employee = await prisma.employee.create({ data: { employeeNo: 'MANAGER', name: '部门负责人', phone: '13800000000', type: 'LAWYER', status: 'FORMAL', entryDate: new Date() } });
  const updated = await app.httpRequest().patch('/api/v1/organizations/' + source.id).set(bearer())
    .send({ version: 1, managerEmployeeId: employee.id }).expect(200);
  assert.equal(updated.body.data.manager.id, employee.id);
  const candidates = await app.httpRequest().get('/api/v1/organizations/manager-options?keyword=MANAGER').set(bearer()).expect(200);
  assert.deepEqual(candidates.body.data.map((item: { id: string }) => item.id), [employee.id]);
  const copy = (await app.httpRequest().post('/api/v1/organizations/' + source.id + '/copy').set(bearer())
    .send({ sourceVersion: 2, code: 'COPIED', name: '复制部门', type: 'DEPARTMENT', parentId: rootId }).expect(200)).body.data;
  const detail = (await app.httpRequest().get('/api/v1/organizations/' + copy.id).set(bearer()).expect(200)).body.data;
  assert.equal(detail.children.length, 1);
  assert.equal(detail.counts.positions, 1);
  assert.equal(detail.managerEmployeeId, null);
  const blocked = await app.httpRequest().delete('/api/v1/organizations/' + copy.id).set(bearer()).send({ version: 1 }).expect(409);
  assert.deepEqual(blocked.body.errors.organizationDeleteBlockers, { children: 1, positions: 1 });
  await app.httpRequest().delete('/api/v1/organizations/' + detail.children[0].id).set(bearer()).send({ version: 1 }).expect(200);
  await app.httpRequest().delete('/api/v1/organizations/' + rootId).set(bearer()).send({ version: 1 }).expect(409);
});

test('SPEC-003-A rejects ordinary administrators on management endpoints while retaining scoped options', async () => {
  const token = await tokenForRole('SYSTEM_ADMIN', 'SYSTEM');
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_ADMIN' } });
  const scope = await prisma.dataScope.create({ data: { name: 'All organization options', scopeType: 'ALL' } });
  await prisma.roleDataScope.create({ data: { roleId: role.id, dataScopeId: scope.id, resource: 'organization' } });
  for (const code of ['organization.read', 'organization.create', 'organization.update']) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
  for (const path of ['/tree', '/' + rootId, '/manager-options']) {
    const result = await app.httpRequest().get('/api/v1/organizations' + path).set(bearer(token)).expect(403);
    assert.equal(result.body.message, 'SUPER_ADMIN_REQUIRED');
  }
  await app.httpRequest().post('/api/v1/organizations/' + rootId + '/copy').set(bearer(token)).send({}).expect(403);
  await app.httpRequest().patch('/api/v1/organizations/' + rootId).set(bearer(token)).send({}).expect(403);
  await app.httpRequest().delete('/api/v1/organizations/' + rootId).set(bearer(token)).send({ version: 1 }).expect(403);
  const options = await app.httpRequest().get('/api/v1/organizations/options').set(bearer(token)).expect(200);
  assert.equal(options.body.data[0].id, rootId);
  assert.equal('manager' in options.body.data[0], false);
});
