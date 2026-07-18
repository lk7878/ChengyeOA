import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
const jwtSecret = '01234567890123456789012345678901';
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
  return new JwtTokenService(jwtSecret).signAccess(user.id, user.credentialVersion);
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
      employeeType: 'LAWYER',
      entryDate: '2026-07-18',
      primaryOrganizationId: branch.id,
      primaryPositionId: position.id,
    })
    .expect(200);
  const employee = employeeResponse.body.data;
  assert.equal(employee.primaryAssignment.organizationId, branch.id);
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

  const accountToken = new JwtTokenService(jwtSecret).signAccess(account.id, account.credentialVersion);
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
});

test('rejects ordinary users for every SPEC-003 resource prefix', async () => {
  const ordinaryToken = await tokenForRole('BUSINESS_ADMIN', 'BUSINESS');
  for (const path of [
    '/api/v1/organizations/tree',
    '/api/v1/positions',
    '/api/v1/employees',
    '/api/v1/professional-teams',
  ]) {
    const response = await app.httpRequest().get(path).set(bearer(ordinaryToken)).expect(403);
    assert.equal(response.body.message, 'SYSTEM_SUPER_ADMIN_REQUIRED');
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
  assert.equal(missing.body.message, 'EMPLOYEE_NOT_FOUND');

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

test('does not expose physical delete routes for organization, position, or employee', async () => {
  for (const path of [
    `/api/v1/organizations/${randomUUID()}`,
    `/api/v1/positions/${randomUUID()}`,
    `/api/v1/employees/${randomUUID()}`,
  ]) {
    await app.httpRequest().delete(path).set(bearer()).expect(404);
  }
});
