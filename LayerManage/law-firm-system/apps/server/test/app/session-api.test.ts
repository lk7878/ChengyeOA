import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { SessionService } from '../../app/application/auth/session-service';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { TotpService } from '../../app/domain/security/totp-service';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
const origin = 'http://localhost:3000';
const password = 'Correct-Horse-92!';
const hasher = new BcryptPasswordHasher(4);
let prisma: PrismaClient;
let username: string;

interface BrowserSession {
  token: string;
  csrfToken: string;
  cookie: string;
}

interface MfaBrowserSession extends BrowserSession {
  userId: string;
  secret: string;
  sessionId: string;
}

async function mfaSession(): Promise<MfaBrowserSession> {
  const user = await prisma.user.create({
    data: { username: `session.mfa.${randomUUID()}`, password: 'x' },
  });
  const secret = new TotpService().generateSecret();
  const encrypted = new MfaSecretCrypto(new Map([
    [1, Buffer.from('0123456789abcdef0123456789abcdef')],
  ])).encrypt(secret);
  await prisma.mfaFactor.create({ data: {
    userId: user.id,
    encryptedSecret: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    verifiedAt: new Date(),
  } });
  const credentials = await new SessionService(
    prisma, new JwtTokenService('01234567890123456789012345678901'),
  ).create(user.id, 'MFA', {});
  return {
    userId: user.id,
    secret,
    token: credentials.accessToken,
    csrfToken: credentials.csrfToken,
    cookie: `chengye_csrf=${credentials.csrfToken}`,
    sessionId: credentials.sessionId,
  };
}

function browserCookie(response: { headers: Record<string, unknown> }): string {
  return (response.headers['set-cookie'] as string[]).map(value => value.split(';', 1)[0]).join('; ');
}

async function login(): Promise<BrowserSession> {
  const response = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username, password })
    .expect(200);
  const cookies = response.headers['set-cookie'] as string[];
  assert.ok(cookies.some(cookie => cookie.startsWith('chengye_csrf=') && /Path=\/(?:;|$)/i.test(cookie) && !/HttpOnly/i.test(cookie)));
  assert.ok(cookies.some(cookie => cookie.startsWith('chengye_refresh=') && /Path=\/api\/v1\/auth(?:;|$)/i.test(cookie) && /HttpOnly/i.test(cookie)));
  return {
    token: response.body.data.token,
    csrfToken: response.body.data.csrfToken,
    cookie: browserCookie(response),
  };
}

test.before(async () => { prisma = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  username = `session.api.${randomUUID()}`;
  await prisma.user.create({ data: { username, password: await hasher.hash(password) } });
});
test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('requires trusted-origin double-submit CSRF for refresh and rotates its cookie', async () => {
  const authenticated = await login();
  const rejected = await app.httpRequest()
    .post('/api/v1/auth/refresh')
    .set('Cookie', authenticated.cookie)
    .expect(403);
  assert.equal(rejected.body.message, 'CSRF_INVALID');

  const refreshed = await app.httpRequest()
    .post('/api/v1/auth/refresh')
    .set('Origin', origin)
    .set('X-CSRF-Token', authenticated.csrfToken)
    .set('Cookie', authenticated.cookie)
    .expect(200);
  assert.equal(refreshed.body.data.expiresIn, 900);
  assert.equal(typeof refreshed.body.data.token, 'string');
  assert.equal('refreshToken' in refreshed.body.data, false);
  assert.notEqual(browserCookie(refreshed), authenticated.cookie);
});

test('lists sessions and performs real logout', async () => {
  const first = await login();
  await login();
  const listed = await app.httpRequest()
    .get('/api/v1/auth/sessions')
    .set('Authorization', `Bearer ${first.token}`)
    .expect(200);
  assert.equal(listed.body.data.length, 2);
  await app.httpRequest()
    .post('/api/v1/auth/logout')
    .set('Authorization', `Bearer ${first.token}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', first.csrfToken)
    .set('Cookie', first.cookie)
    .expect(200);
  const rejected = await app.httpRequest()
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${first.token}`)
    .expect(401);
  assert.equal(rejected.body.message, 'SESSION_REVOKED');
});

test('revokes another owned device without step-up', async () => {
  const actor = await mfaSession();
  const target = await new SessionService(
    prisma, new JwtTokenService('01234567890123456789012345678901'),
  ).create(actor.userId, 'MFA', {});
  await app.httpRequest()
    .delete(`/api/v1/auth/sessions/${target.sessionId}`)
    .set('Authorization', `Bearer ${actor.token}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', actor.csrfToken)
    .set('Cookie', actor.cookie)
    .expect(200);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: target.sessionId } })).revokedAt);
});

test('logout-all preserves the current device without step-up', async () => {
  const actor = await mfaSession();
  const other = await new SessionService(
    prisma, new JwtTokenService('01234567890123456789012345678901'),
  ).create(actor.userId, 'MFA', {});
  const response = await app.httpRequest()
    .post('/api/v1/auth/logout-all')
    .set('Authorization', `Bearer ${actor.token}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', actor.csrfToken)
    .set('Cookie', actor.cookie)
    .send({ preserveCurrent: true })
    .expect(200);
  assert.equal(response.body.data.revokedCount, 1);
  await app.httpRequest().get('/api/v1/auth/me').set('Authorization', `Bearer ${actor.token}`).expect(200);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: other.sessionId } })).revokedAt);
});
