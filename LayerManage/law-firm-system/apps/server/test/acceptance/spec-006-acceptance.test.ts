import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { hashPayload } from '../../app/domain/admin-governance/canonical-json';
import { decodeBase32 } from '../../app/domain/security/base32';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
const origin = 'http://localhost:3000';
const initialPassword = 'Initial-Horse-92!';
const replacementPassword = 'Replacement-Horse-93!';
const hasher = new BcryptPasswordHasher(4);
let prisma: PrismaClient;

function totpCode(secret: string, time: Date): string {
  const counter = BigInt(Math.floor(time.getTime() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

function browserCookie(response: { headers: Record<string, unknown> }): string {
  const values = (response.headers['set-cookie'] ?? []) as string[];
  return values.map(value => value.split(';', 1)[0]).join('; ');
}

function cookieValue(cookie: string, name: string): string {
  return cookie.split('; ').find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
}

test.before(async () => { prisma = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => { await clearTestApplicationData(prisma); });
test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('password change, enrollment, TOTP login, refresh rotation, HIGH step-up, and logout form one revocable flow', async () => {
  const username = `spec006.admin.${randomUUID()}`;
  const user = await prisma.user.create({ data: {
    username, password: await hasher.hash(initialPassword), mustChangePassword: true,
  } });
  const role = await prisma.role.create({ data: {
    id: 'role:system-admin', code: 'SYSTEM_ADMIN', name: 'System Admin', type: 'SYSTEM',
  } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const rootId = randomUUID();
  const branchId = randomUUID();
  await prisma.organization.create({ data: { id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}` } });
  await prisma.organization.create({ data: {
    id: branchId, code: 'BRANCH', name: 'Branch', type: 'BRANCH', parentId: rootId,
    path: `/${rootId}/${branchId}`, level: 1,
  } });

  const passwordStage = await app.httpRequest().post('/api/v1/auth/login')
    .send({ username, password: initialPassword }).expect(200);
  assert.equal(passwordStage.body.data.mode, 'PASSWORD_CHANGE_REQUIRED');
  const passwordChallenge = passwordStage.body.data.challengeToken as string;
  const changed = await app.httpRequest().post('/api/v1/auth/password/forced-change')
    .send({ challengeToken: passwordChallenge, password: replacementPassword, confirmation: replacementPassword })
    .expect(200);
  assert.equal(changed.body.data.mode, 'MFA_ENROLLMENT_REQUIRED');

  const enrollmentChallenge = changed.body.data.challengeToken as string;
  const enrollment = await app.httpRequest().post('/api/v1/auth/mfa/enrollment')
    .send({ challengeToken: enrollmentChallenge }).expect(200);
  const secret = enrollment.body.data.secret as string;
  const enrolled = await app.httpRequest().post('/api/v1/auth/mfa/enrollment/confirm')
    .send({ challengeToken: enrollmentChallenge, code: totpCode(secret, new Date(Date.now() - 30_000)) })
    .expect(200);
  assert.equal(enrolled.body.data.mode, 'AUTHENTICATED');
  const recoveryCodes = enrolled.body.data.recoveryCodes as string[];
  assert.equal(recoveryCodes.length, 10);

  await app.httpRequest().post('/api/v1/auth/logout')
    .set('Authorization', `Bearer ${enrolled.body.data.token}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', enrolled.body.data.csrfToken)
    .set('Cookie', browserCookie(enrolled))
    .expect(200);

  const nextPasswordStage = await app.httpRequest().post('/api/v1/auth/login')
    .send({ username, password: replacementPassword }).expect(200);
  assert.equal(nextPasswordStage.body.data.mode, 'MFA_CHALLENGE_REQUIRED');
  const loginChallenge = nextPasswordStage.body.data.challengeToken as string;
  const verified = await app.httpRequest().post('/api/v1/auth/mfa/verify')
    .send({ challengeToken: loginChallenge, credential: { kind: 'TOTP', code: totpCode(secret, new Date()) } })
    .expect(200);
  const beforeRefreshCookie = browserCookie(verified);
  const refreshed = await app.httpRequest().post('/api/v1/auth/refresh')
    .set('Origin', origin)
    .set('X-CSRF-Token', verified.body.data.csrfToken)
    .set('Cookie', beforeRefreshCookie)
    .expect(200);
  const afterRefreshCookie = browserCookie(refreshed);
  assert.notEqual(cookieValue(afterRefreshCookie, 'chengye_refresh'), cookieValue(beforeRefreshCookie, 'chengye_refresh'));

  const governanceInput = {
    operationType: 'MASTER_DATA_STATUS_CORRECTION', targetType: 'ORGANIZATION', targetId: branchId,
    reason: 'Disable verified inactive branch through purpose-bound step-up', expectedTargetVersion: 1,
    payload: { status: 'DISABLED' }, idempotencyKey: randomUUID(),
  };
  const stepUp = await app.httpRequest().post('/api/v1/auth/step-up')
    .set('Authorization', `Bearer ${refreshed.body.data.token}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', refreshed.body.data.csrfToken)
    .set('Cookie', afterRefreshCookie)
    .send({
      purpose: 'ADMIN_GOVERNANCE_CREATE',
      target: {
        operationType: governanceInput.operationType, targetType: governanceInput.targetType,
        targetId: branchId, expectedTargetVersion: 1, payloadHash: hashPayload(governanceInput.payload),
      },
      code: totpCode(secret, new Date(Date.now() + 30_000)),
    })
    .expect(200);
  const stepUpToken = stepUp.body.data.stepUpToken as string;
  const created = await app.httpRequest().post('/api/v1/admin-governance/operations')
    .set('Authorization', `Bearer ${refreshed.body.data.token}`)
    .set('X-Step-Up-Token', stepUpToken)
    .send(governanceInput)
    .expect(200);
  assert.equal(created.body.data.status, 'PENDING_REVIEW');

  await app.httpRequest().post('/api/v1/auth/logout')
    .set('Authorization', `Bearer ${refreshed.body.data.token}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', refreshed.body.data.csrfToken)
    .set('Cookie', afterRefreshCookie)
    .expect(200);
  const rejected = await app.httpRequest().get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${refreshed.body.data.token}`).expect(401);
  assert.equal(rejected.body.message, 'SESSION_REVOKED');

  const sensitiveFixtures = [
    passwordChallenge, enrollmentChallenge, loginChallenge, secret, stepUpToken,
    cookieValue(beforeRefreshCookie, 'chengye_refresh'), cookieValue(afterRefreshCookie, 'chengye_refresh'),
    ...recoveryCodes,
  ].filter(Boolean);
  const audit = JSON.stringify(await prisma.operationLog.findMany({ where: { userId: user.id } }));
  for (const fixture of sensitiveFixtures) assert.equal(audit.includes(fixture), false);
});
