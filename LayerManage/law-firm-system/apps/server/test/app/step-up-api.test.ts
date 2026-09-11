import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { decodeBase32 } from '../../app/domain/security/base32';
import { hashOpaqueToken } from '../../app/domain/security/opaque-token';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
const origin = 'http://localhost:3000';
const password = 'Correct-Horse-92!';
const hasher = new BcryptPasswordHasher(4);
let prisma: PrismaClient;

function totpCode(secret: string, time = new Date()): string {
  const counter = BigInt(Math.floor(time.getTime() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

function browserCookie(response: { headers: Record<string, unknown> }): string {
  const values = response.headers['set-cookie'] as string[];
  return values.map(value => value.split(';', 1)[0]).join('; ');
}

test.before(async () => { prisma = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => { await clearTestApplicationData(prisma); });
test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('issues a session-bound step-up token through an authenticated CSRF-protected API', async () => {
  const admin = await prisma.user.create({
    data: { username: `stepup.api.${randomUUID()}`, password: await hasher.hash(password) },
  });
  const role = await prisma.role.create({
    data: { id: 'role:system-admin', name: 'System Admin', code: 'SYSTEM_ADMIN', type: 'SYSTEM' },
  });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });

  const login = await app.httpRequest().post('/api/v1/auth/login')
    .send({ username: admin.username, password }).expect(200);
  const challengeToken = login.body.data.challengeToken as string;
  const enrollment = await app.httpRequest().post('/api/v1/auth/mfa/enrollment')
    .send({ challengeToken }).expect(200);
  const secret = enrollment.body.data.secret as string;
  const confirmed = await app.httpRequest().post('/api/v1/auth/mfa/enrollment/confirm')
    .send({ challengeToken, code: totpCode(secret) }).expect(200);
  await prisma.mfaFactor.updateMany({ where: { userId: admin.id }, data: { lastAcceptedCounter: null } });

  const rejected = await app.httpRequest().post('/api/v1/auth/step-up')
    .set('Authorization', `Bearer ${confirmed.body.data.token}`)
    .send({ purpose: 'SESSION_REVOKE', target: { sessionId: 'target-session' }, code: totpCode(secret) })
    .expect(403);
  assert.equal(rejected.body.message, 'CSRF_INVALID');

  const response = await app.httpRequest().post('/api/v1/auth/step-up')
    .set('Authorization', `Bearer ${confirmed.body.data.token}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', confirmed.body.data.csrfToken)
    .set('Cookie', browserCookie(confirmed))
    .send({ purpose: 'SESSION_REVOKE', target: { sessionId: 'target-session' }, code: totpCode(secret) })
    .expect(200);

  assert.equal(response.body.data.expiresIn, 300);
  assert.equal(typeof response.body.data.stepUpToken, 'string');
  const grant = await prisma.stepUpGrant.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(response.body.data.stepUpToken) },
  });
  const session = await prisma.authSession.findFirstOrThrow({ where: { userId: admin.id } });
  assert.equal(grant.sessionId, session.id);
  assert.equal(grant.purpose, 'SESSION_REVOKE');
});
