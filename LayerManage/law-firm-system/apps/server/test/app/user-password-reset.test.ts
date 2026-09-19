import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { SystemBootstrapService } from '../../app/application/system/system-bootstrap-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
const hasher = new BcryptPasswordHasher(4);
const initialPassword = 'Correct-Horse-92';
const staffPassword = 'Plain-User-12!';
let prisma: PrismaClient;

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function bootstrapTrustRoot(): Promise<void> {
  await new SystemBootstrapService(
    prisma,
    hasher,
    { databaseName: 'chengye_oa_test', hostname: 'localhost' },
  ).execute({
    organizationName: 'Chengye Test Firm',
    username: 'root.admin',
    password: initialPassword,
  });
}

async function createPlainUser(username: string): Promise<{ id: string }> {
  return prisma.user.create({
    data: {
      username,
      password: await hasher.hash(staffPassword),
      status: 'ENABLED',
      mustChangePassword: false,
      credentialVersion: 1,
    },
    select: { id: true },
  });
}

async function createPasswordAdmin(username: string, scopeType: 'ALL' | 'SELF' = 'ALL'): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { username, password: await hasher.hash(staffPassword), status: 'ENABLED', mustChangePassword: false, credentialVersion: 1 },
  });
  const scope = await prisma.dataScope.create({ data: { name: `密码重置-${scopeType}`, scopeType } });
  const role = await prisma.role.create({
    data: {
      name: `密码管理员-${username}`,
      code: `PWADM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: { create: [{ permission: { connect: { code: 'user.password.reset' } } }] },
    },
  });
  await prisma.roleDataScope.create({ data: { roleId: role.id, resource: 'user', dataScopeId: scope.id } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function superAdminToken(): Promise<string> {
  const root = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  await prisma.user.update({ where: { id: root.id }, data: { mustChangePassword: false } });
  return (await createApiSession(prisma, root.id, 'MFA')).token;
}

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  await bootstrapTrustRoot();
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('super admin resets a plain user password, forces change and revokes sessions', async () => {
  const adminToken = await superAdminToken();
  const target = await createPlainUser('staff.one');
  const targetToken = (await createApiSession(prisma, target.id)).token;

  const nextPassword = 'New-Staff-Pass-42!';
  const response = await app.httpRequest()
    .post(`/api/v1/users/${target.id}/password-reset`)
    .set(bearer(adminToken))
    .send({ password: nextPassword, confirmation: nextPassword })
    .expect(200);
  assert.equal(response.body.data, null);

  const updated = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  assert.equal(updated.mustChangePassword, true);
  assert.equal(updated.credentialVersion, 2);
  assert.equal(await hasher.compare(nextPassword, updated.password), true);
  assert.equal(await hasher.compare(staffPassword, updated.password), false);

  await app.httpRequest().get('/api/v1/auth/me').set(bearer(targetToken)).expect(401);

  const audit = await prisma.operationLog.findFirst({ where: { action: 'PASSWORD_RESET_BY_ADMIN', targetId: target.id } });
  assert.ok(audit);
  assert.equal(audit.userId, (await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } })).id);
  assert.equal(JSON.stringify(audit).includes(nextPassword), false);
  assert.equal(JSON.stringify(audit).includes(staffPassword), false);
});

test('user without the password reset permission is denied', async () => {
  const plain = await createPlainUser('plain.nobody');
  const plainToken = (await createApiSession(prisma, plain.id)).token;
  const target = await createPlainUser('victim.two');
  const response = await app.httpRequest()
    .post(`/api/v1/users/${target.id}/password-reset`)
    .set(bearer(plainToken))
    .send({ password: 'New-Victim-42!', confirmation: 'New-Victim-42!' })
    .expect(403);
  assert.equal(response.body.message, 'PERMISSION_DENIED');
});

test('operator cannot reset their own password through this endpoint', async () => {
  const admin = await createPasswordAdmin('pw.admin.self');
  const token = (await createApiSession(prisma, admin.id)).token;
  const response = await app.httpRequest()
    .post(`/api/v1/users/${admin.id}/password-reset`)
    .set(bearer(token))
    .send({ password: 'New-Self-42!', confirmation: 'New-Self-42!' })
    .expect(400);
  assert.equal(response.body.message, 'SELF_PASSWORD_RESET_FORBIDDEN');
});

test('system administrator accounts cannot be reset online', async () => {
  const adminToken = await superAdminToken();
  const sysAdmin = await prisma.user.create({
    data: { username: 'sys.admin', password: await hasher.hash(staffPassword), status: 'ENABLED', mustChangePassword: false },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_ADMIN' } });
  await prisma.userRole.create({ data: { userId: sysAdmin.id, roleId: role.id } });
  const response = await app.httpRequest()
    .post(`/api/v1/users/${sysAdmin.id}/password-reset`)
    .set(bearer(adminToken))
    .send({ password: 'New-Sys-42!', confirmation: 'New-Sys-42!' })
    .expect(409);
  assert.equal(response.body.message, 'TRUST_ROOT_PROTECTED');
});

test('primary trust root cannot be reset online', async () => {
  const adminToken = await superAdminToken();
  const root = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  const response = await app.httpRequest()
    .post(`/api/v1/users/${root.id}/password-reset`)
    .set(bearer(adminToken))
    .send({ password: 'New-Root-42!', confirmation: 'New-Root-42!' })
    .expect(409);
  assert.equal(response.body.message, 'TRUST_ROOT_PROTECTED');
});

test('weak, mismatched, and reused passwords are rejected without changing the account', async () => {
  const adminToken = await superAdminToken();
  const target = await createPlainUser('staff.three');
  const url = `/api/v1/users/${target.id}/password-reset`;

  await app.httpRequest().post(url).set(bearer(adminToken)).send({ password: 'short', confirmation: 'short' }).expect(400);
  await app.httpRequest().post(url).set(bearer(adminToken)).send({ password: 'New-Staff-42!', confirmation: 'New-Staff-43!' }).expect(400);
  const reused = await app.httpRequest().post(url).set(bearer(adminToken)).send({ password: staffPassword, confirmation: staffPassword }).expect(400);
  assert.equal(reused.body.message, 'PASSWORD_REUSED');

  const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  assert.equal(unchanged.credentialVersion, 1);
  assert.equal(unchanged.mustChangePassword, false);
  assert.equal(await hasher.compare(staffPassword, unchanged.password), true);
});

test('out-of-scope target is hidden as 404', async () => {
  const admin = await createPasswordAdmin('pw.admin.scope', 'SELF');
  const token = (await createApiSession(prisma, admin.id)).token;
  const target = await createPlainUser('staff.four');
  await app.httpRequest()
    .post(`/api/v1/users/${target.id}/password-reset`)
    .set(bearer(token))
    .send({ password: 'New-Staff-42!', confirmation: 'New-Staff-42!' })
    .expect(404);
});
