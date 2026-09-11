import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { decodeBase32 } from '../../app/domain/security/base32';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();

function hasRefreshCookie(value: string | string[] | undefined): boolean {
  const cookies = Array.isArray(value) ? value : value ? [value] : [];
  return cookies.some(cookie => cookie.startsWith('chengye_refresh='));
}

function cookieHeader(value: string | string[] | undefined): string {
  const cookies = Array.isArray(value) ? value : value ? [value] : [];
  return cookies.map(cookie => cookie.split(';')[0]).join('; ');
}
const password = 'Correct-Horse-92!';
const hasher = new BcryptPasswordHasher(4);
let prisma: PrismaClient;
let adminId: string;

function totpCode(secret: string, time = new Date()): string {
  const counter = BigInt(Math.floor(time.getTime() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

test.before(async () => { prisma = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  const passwordHash = await hasher.hash(password);
  await prisma.user.create({
    data: { username: `ordinary.${randomUUID()}`, password: passwordHash },
  });
  const admin = await prisma.user.create({
    data: { username: `admin.${randomUUID()}`, password: passwordHash },
  });
  adminId = admin.id;
  const role = await prisma.role.create({
    data: { id: 'role:system-admin', name: 'System Admin', code: 'SYSTEM_ADMIN', type: 'SYSTEM' },
  });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });
});
test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('authenticates an ordinary user without persisting a refresh token in the response body', async () => {
  const user = await prisma.user.findFirstOrThrow({ where: { username: { startsWith: 'ordinary.' } } });
  const response = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: user.username, password })
    .expect(200);

  assert.equal(response.body.data.mode, 'AUTHENTICATED');
  assert.equal(response.body.data.expiresIn, 900);
  assert.equal(typeof response.body.data.token, 'string');
  assert.equal(typeof response.body.data.csrfToken, 'string');
  assert.equal('refreshToken' in response.body.data, false);
  assert.ok(hasRefreshCookie(response.headers['set-cookie']));
});

test('requires an administrator without a factor to enroll before creating a session', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
  const response = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: admin.username, password })
    .expect(200);

  assert.equal(response.body.data.mode, 'MFA_ENROLLMENT_REQUIRED');
  assert.equal(response.body.data.expiresIn, 600);
  assert.equal(typeof response.body.data.challengeToken, 'string');
  assert.equal(await prisma.authSession.count({ where: { userId: adminId } }), 0);
});

test('allows an authenticated ordinary user to opt into MFA and revokes the password-only session', async () => {
  const user = await prisma.user.findFirstOrThrow({ where: { username: { startsWith: 'ordinary.' } } });
  const login = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: user.username, password })
    .expect(200);
  const oldSession = await prisma.authSession.findFirstOrThrow({ where: { userId: user.id } });

  const started = await app.httpRequest()
    .post('/api/v1/auth/mfa/enrollment/start')
    .set('Authorization', `Bearer ${login.body.data.token}`)
    .set('Origin', 'http://localhost:3000')
    .set('X-CSRF-Token', login.body.data.csrfToken)
    .set('Cookie', cookieHeader(login.headers['set-cookie']))
    .expect(200);

  assert.equal(started.body.data.expiresIn, 600);
  assert.equal(typeof started.body.data.challengeToken, 'string');
  const challengeToken = started.body.data.challengeToken as string;
  const enrollment = await app.httpRequest()
    .post('/api/v1/auth/mfa/enrollment')
    .send({ challengeToken })
    .expect(200);
  const confirmed = await app.httpRequest()
    .post('/api/v1/auth/mfa/enrollment/confirm')
    .send({ challengeToken, code: totpCode(enrollment.body.data.secret) })
    .expect(200);

  assert.equal(confirmed.body.data.mode, 'AUTHENTICATED');
  const revoked = await prisma.authSession.findUniqueOrThrow({ where: { id: oldSession.id } });
  assert.equal(revoked.revokedReason, 'MFA_ENROLLED');
  await app.httpRequest()
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${login.body.data.token}`)
    .expect(401);

  const nextLogin = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: user.username, password })
    .expect(200);
  assert.equal(nextLogin.body.data.mode, 'MFA_CHALLENGE_REQUIRED');
});

test('enrolls an administrator and requires MFA on the next login', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
  const login = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: admin.username, password })
    .expect(200);
  const challengeToken = login.body.data.challengeToken as string;
  const enrollment = await app.httpRequest()
    .post('/api/v1/auth/mfa/enrollment')
    .send({ challengeToken })
    .expect(200);
  const confirmed = await app.httpRequest()
    .post('/api/v1/auth/mfa/enrollment/confirm')
    .send({ challengeToken, code: totpCode(enrollment.body.data.secret) })
    .expect(200);

  assert.equal(confirmed.body.data.mode, 'AUTHENTICATED');
  assert.equal(confirmed.body.data.recoveryCodes.length, 10);
  assert.equal('secret' in confirmed.body.data, false);
  assert.ok(hasRefreshCookie(confirmed.headers['set-cookie']));

  const nextLogin = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: admin.username, password })
    .expect(200);
  assert.equal(nextLogin.body.data.mode, 'MFA_CHALLENGE_REQUIRED');
  const verified = await app.httpRequest()
    .post('/api/v1/auth/mfa/verify')
    .send({
      challengeToken: nextLogin.body.data.challengeToken,
      credential: { kind: 'TOTP', code: totpCode(enrollment.body.data.secret, new Date(Date.now() + 30_000)) },
    })
    .expect(200);
  assert.equal(verified.body.data.mode, 'AUTHENTICATED');
});
