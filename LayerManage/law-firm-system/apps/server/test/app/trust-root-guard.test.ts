import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { SystemBootstrapService } from '../../app/application/system/system-bootstrap-service';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
const jwtSecret = '01234567890123456789012345678901';
const hasher = new BcryptPasswordHasher(4);
let prisma: PrismaClient;
let bearer: string;
let rootOrganizationId: string;
let superAdminUserId: string;
let superAdminRoleId: string;

async function bootstrapAuthenticatedTrustRoot(): Promise<void> {
  await new SystemBootstrapService(
    prisma,
    hasher,
    { databaseName: 'chengye_oa_test', hostname: 'localhost' },
  ).execute({
    organizationName: 'Chengye Test Firm',
    username: 'root.admin',
    password: 'Correct-Horse-92',
  });

  const initialization = await prisma.systemInitialization.findUniqueOrThrow({ where: { id: 'PRIMARY' } });
  const user = await prisma.user.update({
    where: { id: initialization.superAdminUserId },
    data: { mustChangePassword: false },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_SUPER_ADMIN' } });
  rootOrganizationId = initialization.rootOrganizationId;
  superAdminUserId = initialization.superAdminUserId;
  superAdminRoleId = role.id;
  bearer = `Bearer ${new JwtTokenService(jwtSecret).signAccess(user.id, user.credentialVersion)}`;
}

function assertTrustRootProtected(response: { body: Record<string, unknown> }): void {
  assert.equal(response.body.code, 409);
  assert.equal(response.body.message, 'TRUST_ROOT_PROTECTED');
}

function assertNoPasswordProperty(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.prototype.hasOwnProperty.call(value, 'password'), false);
  for (const nested of Object.values(value)) {
    assertNoPasswordProperty(nested);
  }
}

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  await bootstrapAuthenticatedTrustRoot();
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('cannot disable the current first super-admin', async () => {
  const response = await app.httpRequest()
    .put(`/api/v1/users/${superAdminUserId}`)
    .set('Authorization', bearer)
    .send({ status: 'DISABLED' })
    .expect(409);

  assertTrustRootProtected(response);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: superAdminUserId } })).status, 'ENABLED');
});

test('cannot update other mutable state on the current first super-admin', async () => {
  const response = await app.httpRequest()
    .put(`/api/v1/users/${superAdminUserId}`)
    .set('Authorization', bearer)
    .send({ employeeId: null })
    .expect(409);

  assertTrustRootProtected(response);
});

test('cannot delete the current first super-admin', async () => {
  const response = await app.httpRequest()
    .delete(`/api/v1/users/${superAdminUserId}`)
    .set('Authorization', bearer)
    .expect(409);

  assertTrustRootProtected(response);
  assert.ok(await prisma.user.findUnique({ where: { id: superAdminUserId } }));
});

test('cannot replace roles of the current first super-admin', async () => {
  const response = await app.httpRequest()
    .post(`/api/v1/users/${superAdminUserId}/roles`)
    .set('Authorization', bearer)
    .send({ roleIds: [] })
    .expect(409);

  assertTrustRootProtected(response);
  assert.equal(await prisma.userRole.count({ where: { userId: superAdminUserId, roleId: superAdminRoleId } }), 1);
});

for (const mutation of [
  { name: 'rename', body: { name: 'Changed system role' } },
  { name: 'disable', body: { status: 'DISABLED' } },
  { name: 'update', body: { description: 'Changed description' } },
]) {
  test(`cannot ${mutation.name} the SYSTEM_SUPER_ADMIN role`, async () => {
    const before = await prisma.role.findUniqueOrThrow({ where: { id: superAdminRoleId } });
    const response = await app.httpRequest()
      .put(`/api/v1/roles/${superAdminRoleId}`)
      .set('Authorization', bearer)
      .send(mutation.body)
      .expect(409);

    assertTrustRootProtected(response);
    assert.deepEqual(await prisma.role.findUniqueOrThrow({ where: { id: superAdminRoleId } }), before);
  });
}

test('cannot delete the SYSTEM_SUPER_ADMIN role', async () => {
  const response = await app.httpRequest()
    .delete(`/api/v1/roles/${superAdminRoleId}`)
    .set('Authorization', bearer)
    .expect(409);

  assertTrustRootProtected(response);
  assert.ok(await prisma.role.findUnique({ where: { id: superAdminRoleId } }));
});

test('cannot replace permissions of the SYSTEM_SUPER_ADMIN role', async () => {
  const permission = await prisma.permission.create({
    data: { code: 'SYSTEM_TEST', name: 'System test', type: 'API' },
  });
  const response = await app.httpRequest()
    .post(`/api/v1/roles/${superAdminRoleId}/permissions`)
    .set('Authorization', bearer)
    .send({ permissionIds: [permission.id] })
    .expect(409);

  assertTrustRootProtected(response);
  assert.equal(await prisma.rolePermission.count({ where: { roleId: superAdminRoleId } }), 0);
});

test('cannot recreate the protected role through role creation', async () => {
  const response = await app.httpRequest()
    .post('/api/v1/roles')
    .set('Authorization', bearer)
    .send({ name: 'Another system super admin', code: ' system_super_admin ', type: 'BUSINESS' })
    .expect(409);

  assertTrustRootProtected(response);
  assert.equal(await prisma.role.count({ where: { code: 'SYSTEM_SUPER_ADMIN' } }), 1);
});

test('cannot assign SYSTEM_SUPER_ADMIN through the mutable user-role endpoint', async () => {
  const user = await prisma.user.create({
    data: { username: 'business.user', password: 'not-used-by-this-test', mustChangePassword: true },
  });
  const response = await app.httpRequest()
    .post(`/api/v1/users/${user.id}/roles`)
    .set('Authorization', bearer)
    .send({ roleIds: [superAdminRoleId] })
    .expect(409);

  assertTrustRootProtected(response);
  assert.equal(await prisma.userRole.count({ where: { userId: user.id } }), 0);
});

test('cannot delete the current root organization but can update its name', async () => {
  const deleteResponse = await app.httpRequest()
    .delete(`/api/v1/organizations/${rootOrganizationId}`)
    .set('Authorization', bearer)
    .expect(409);
  assertTrustRootProtected(deleteResponse);

  const updateResponse = await app.httpRequest()
    .put(`/api/v1/organizations/${rootOrganizationId}`)
    .set('Authorization', bearer)
    .send({ name: 'Renamed Test Firm' })
    .expect(200);
  assert.equal(updateResponse.body.data.name, 'Renamed Test Firm');
});

test('user endpoints use safe projections and creation applies shared credential policy', async () => {
  const role = await prisma.role.create({
    data: { name: 'Business lawyer', code: 'BUSINESS_LAWYER', type: 'BUSINESS' },
  });
  const created = await app.httpRequest()
    .post('/api/v1/users')
    .set('Authorization', bearer)
    .send({ username: '  Business.Admin  ', password: 'Business-Horse-94!', status: 'ENABLED' })
    .expect(200);

  assert.equal(created.body.data.username, 'business.admin');
  assert.equal(created.body.data.mustChangePassword, true);
  const userId = created.body.data.id as string;
  const responses = [
    created,
    await app.httpRequest().get('/api/v1/users').set('Authorization', bearer).expect(200),
    await app.httpRequest().get(`/api/v1/users/${userId}`).set('Authorization', bearer).expect(200),
    await app.httpRequest().put(`/api/v1/users/${userId}`).set('Authorization', bearer).send({ status: 'DISABLED' }).expect(200),
    await app.httpRequest().post(`/api/v1/users/${userId}/roles`).set('Authorization', bearer).send({ roleIds: [role.id] }).expect(200),
    await app.httpRequest().get(`/api/v1/roles/${role.id}`).set('Authorization', bearer).expect(200),
  ];
  for (const response of responses) {
    assertNoPasswordProperty(response.body);
  }

  const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.match(stored.password, /^chengye\$bcrypt-sha256\$v1\$\$2[aby]\$12\$/);
  assert.equal(await new BcryptPasswordHasher().compare('Business-Horse-94!', stored.password), true);
  assert.equal(stored.mustChangePassword, true);
});

test('user creation rejects invalid usernames and weak passwords through shared validation', async () => {
  const invalidUsername = await app.httpRequest()
    .post('/api/v1/users')
    .set('Authorization', bearer)
    .send({ username: 'NO SPACES', password: 'Business-Horse-94!' })
    .expect(400);
  assert.equal(invalidUsername.body.message, 'USERNAME_INVALID');

  const weakPassword = await app.httpRequest()
    .post('/api/v1/users')
    .set('Authorization', bearer)
    .send({ username: 'business.admin', password: 'password123' })
    .expect(400);
  assert.equal(weakPassword.body.message, 'PASSWORD_INVALID');
  assert.equal(await prisma.user.count({ where: { username: 'business.admin' } }), 0);
});

test('business roles require normalized immutable codes and remain mutable otherwise', async () => {
  const created = await app.httpRequest()
    .post('/api/v1/roles')
    .set('Authorization', bearer)
    .send({ name: 'Business lawyer', code: ' business_lawyer ', type: 'SYSTEM' })
    .expect(200);
  assert.equal(created.body.data.code, 'BUSINESS_LAWYER');
  assert.equal(created.body.data.type, 'BUSINESS');

  const roleId = created.body.data.id as string;
  const updated = await app.httpRequest()
    .put(`/api/v1/roles/${roleId}`)
    .set('Authorization', bearer)
    .send({ name: 'Senior business lawyer', code: 'CHANGED_CODE', status: 'DISABLED' })
    .expect(200);
  assert.equal(updated.body.data.name, 'Senior business lawyer');
  assert.equal(updated.body.data.status, 'DISABLED');
  assert.equal(updated.body.data.code, 'BUSINESS_LAWYER');

  const invalid = await app.httpRequest()
    .post('/api/v1/roles')
    .set('Authorization', bearer)
    .send({ name: 'Invalid role', code: 'bad-code' })
    .expect(400);
  assert.equal(invalid.body.message, 'ROLE_CODE_INVALID');
});
