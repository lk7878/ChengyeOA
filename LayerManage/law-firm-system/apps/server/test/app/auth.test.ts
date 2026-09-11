import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import * as jwt from 'jsonwebtoken';
import type { AuthChallengeService } from '../../app/application/auth/auth-challenge-service';
import { AuthenticationService } from '../../app/application/auth/authentication-service';
import type { MfaService } from '../../app/application/auth/mfa-service';
import type { SessionService } from '../../app/application/auth/session-service';
import { BcryptPasswordHasher, PasswordHasher } from '../../app/domain/security/password-hasher';
import { SecurityError } from '../../app/domain/security/security-errors';
import { SystemBootstrapService } from '../../app/application/system/system-bootstrap-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
const initialPassword = 'Correct-Horse-92';
const replacementPassword = 'Better-Horse-93!';
const jwtSecret = '01234567890123456789012345678901';
const hasher = new BcryptPasswordHasher(4);
let prisma: PrismaClient;

function createPasswordStageService(passwordHasher: PasswordHasher): AuthenticationService {
  return new AuthenticationService(
    prisma,
    passwordHasher,
    {} as AuthChallengeService,
    {} as MfaService,
    {} as SessionService,
  );
}

class BlockingPasswordHasher implements PasswordHasher {
  readonly compareStarted: Promise<void>;
  private signalCompareStarted!: () => void;
  private releaseCompare!: () => void;
  private readonly compareRelease: Promise<void>;

  constructor() {
    this.compareStarted = new Promise(resolve => { this.signalCompareStarted = resolve; });
    this.compareRelease = new Promise(resolve => { this.releaseCompare = resolve; });
  }

  async hash(): Promise<string> {
    throw new Error('hash is not used by this test');
  }

  async compare(): Promise<boolean> {
    this.signalCompareStarted();
    await this.compareRelease;
    return true;
  }

  release(): void {
    this.releaseCompare();
  }
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

async function passwordChangeToken(): Promise<string> {
  const response = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: 'root.admin', password: initialPassword })
    .expect(200);
  return response.body.data.challengeToken as string;
}

async function authenticatedSession() {
  const user = await prisma.user.update({
    where: { username: 'root.admin' },
    data: { mustChangePassword: false },
  });
  return createApiSession(prisma, user.id, 'MFA');
}

function assertSecurityError(response: { body: Record<string, unknown> }, status: number, message: string): void {
  assert.equal(response.body.code, status);
  assert.equal(response.body.message, message);
  assert.equal(response.body.errors, null);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(initialPassword), false);
  assert.equal(serialized.includes(replacementPassword), false);
  assert.equal(serialized.includes('credentialVersion'), false);
  assert.equal(serialized.includes('tokenType'), false);
}

async function dropInjectedFailureTriggers(): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_login_log_for_test ON "login_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_login_log_for_test()');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_auth_challenge_for_test ON "auth_challenge"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_auth_challenge_for_test()');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_forced_change_audit_for_test ON "operation_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_forced_change_audit_for_test()');
}

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
});

test.beforeEach(async () => {
  await dropInjectedFailureTriggers();
  await clearTestApplicationData(prisma);
  await bootstrapTrustRoot();
});

test.after(async () => {
  await dropInjectedFailureTriggers();
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('initial login normalizes username and returns only a password-change challenge', async () => {
  const response = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: '  Root.Admin  ', password: initialPassword })
    .expect(200);

  assert.equal(response.body.data.mode, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal(response.body.data.expiresIn, 300);
  assert.equal(typeof response.body.data.challengeToken, 'string');
  assert.equal('token' in response.body.data, false);
  assert.equal('refreshToken' in response.body.data, false);
  assert.equal('user' in response.body.data, false);
});

test('unknown, wrong-password, disabled, and locked logins share one safe HTTP response', async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });

  const unknown = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: ' Missing.User ', password: initialPassword })
    .expect(401);
  const wrongPassword = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: 'ROOT.ADMIN', password: 'Wrong-Horse-92' })
    .expect(401);

  await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
  const disabled = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: 'root.admin', password: initialPassword })
    .expect(401);

  const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.user.update({
    where: { id: user.id },
    data: { status: 'ENABLED', lockedUntil },
  });
  const locked = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: 'root.admin', password: initialPassword })
    .expect(401);

  for (const response of [unknown, wrongPassword, disabled, locked]) {
    assertSecurityError(response, 401, 'AUTHENTICATION_FAILED');
  }

  const logs = await prisma.loginLog.findMany({ orderBy: { createdAt: 'asc' } });
  assert.equal(logs.length, 4);
  assert.deepEqual(
    logs.map(log => ({
      userId: log.userId,
      usernameSnapshot: log.usernameSnapshot,
      outcome: log.outcome,
      reasonCode: log.reasonCode,
    })),
    [
      { userId: null, usernameSnapshot: 'missing.user', outcome: 'FAILURE', reasonCode: 'UNKNOWN_USER' },
      { userId: user.id, usernameSnapshot: 'root.admin', outcome: 'FAILURE', reasonCode: 'INVALID_PASSWORD' },
      { userId: user.id, usernameSnapshot: 'root.admin', outcome: 'FAILURE', reasonCode: 'USER_DISABLED' },
      { userId: user.id, usernameSnapshot: 'root.admin', outcome: 'LOCKED', reasonCode: 'ACCOUNT_LOCKED' },
    ],
  );
});

test('missing-user login performs one compare against the current versioned dummy hash', async () => {
  const comparisons: Array<{ value: string; stored: string }> = [];
  const recordingHasher: PasswordHasher = {
    async hash(): Promise<string> {
      throw new Error('hash is not used by this test');
    },
    async compare(value: string, stored: string): Promise<boolean> {
      comparisons.push({ value, stored });
      return false;
    },
  };
  const service = createPasswordStageService(recordingHasher);

  await assert.rejects(
    service.login('missing.user', 'Candidate-Horse-92!', {}),
    (error: unknown) => error instanceof SecurityError && error.code === 'AUTHENTICATION_FAILED',
  );

  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0].value, 'Candidate-Horse-92!');
  assert.match(comparisons[0].stored, /^chengye\$bcrypt-sha256\$v1\$\$2[aby]\$12\$/);
});

test('five wrong passwords atomically lock the user for fifteen minutes', async () => {
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await app.httpRequest()
      .post('/api/v1/auth/login')
      .send({ username: 'root.admin', password: `Wrong-Horse-${attempt}` })
      .expect(401);
    assertSecurityError(response, 401, 'AUTHENTICATION_FAILED');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  assert.equal(user.failedLoginCount, 5);
  assert.ok(user.lockedUntil);
  assert.ok(user.lockedUntil.getTime() >= startedAt + 14 * 60 * 1000);
  assert.ok(user.lockedUntil.getTime() <= Date.now() + 16 * 60 * 1000);

  const logs = await prisma.loginLog.findMany({ orderBy: { createdAt: 'asc' } });
  assert.deepEqual(logs.map(log => log.outcome), ['FAILURE', 'FAILURE', 'FAILURE', 'FAILURE', 'LOCKED']);
  assert.ok(logs.every(log => log.reasonCode === 'INVALID_PASSWORD'));
});

test('a concurrent sixth wrong request observes the fifth lock without extending it', async () => {
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: 'root.admin', password: `Concurrent-Wrong-${index}` })));

  assert.ok(responses.every(response => response.status === 401));
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  assert.equal(user.failedLoginCount, 5);
  assert.ok(user.lockedUntil);
  const logs = await prisma.loginLog.findMany({ orderBy: { createdAt: 'asc' } });
  assert.equal(logs.length, 6);
  assert.equal(logs.filter(log => log.reasonCode === 'INVALID_PASSWORD').length, 5);
  assert.equal(logs.filter(log => log.reasonCode === 'ACCOUNT_LOCKED').length, 1);
});

test('a valid password stage clears expired lock state without recording success before a session exists', async () => {
  await prisma.user.update({
    where: { username: 'root.admin' },
    data: { failedLoginCount: 4, lockedUntil: new Date(Date.now() - 1000) },
  });

  await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: 'ROOT.ADMIN', password: initialPassword })
    .expect(200);

  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  assert.equal(user.failedLoginCount, 0);
  assert.equal(user.lockedUntil, null);
  assert.equal(user.lastLoginAt, null);
  assert.equal(await prisma.loginLog.count(), 0);
});

test('login rechecks account state after password comparison before committing success', async () => {
  const blockingHasher = new BlockingPasswordHasher();
  const service = createPasswordStageService(blockingHasher);
  const login = service.login('root.admin', initialPassword, { ip: '127.0.0.1', userAgent: 'state-race-test' });
  await blockingHasher.compareStarted;
  await prisma.user.update({ where: { username: 'root.admin' }, data: { status: 'DISABLED' } });
  blockingHasher.release();

  await assert.rejects(login, (error: unknown) => (
    error instanceof SecurityError && error.code === 'AUTHENTICATION_FAILED'
  ));
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  assert.equal(user.lastLoginAt, null);
  const log = await prisma.loginLog.findFirstOrThrow();
  assert.deepEqual(
    { outcome: log.outcome, reasonCode: log.reasonCode },
    { outcome: 'FAILURE', reasonCode: 'USER_DISABLED' },
  );
});

test('password-change challenge cannot authenticate, refresh, or log out a session', async () => {
  const token = await passwordChangeToken();
  const csrf = 'test-csrf-value';

  const me = await app.httpRequest()
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(401);
  const business = await app.httpRequest()
    .get('/api/v1/users')
    .set('Authorization', `Bearer ${token}`)
    .expect(401);
  const refresh = await app.httpRequest()
    .post('/api/v1/auth/refresh')
    .set('Origin', 'http://localhost:3000')
    .set('X-CSRF-Token', csrf)
    .set('Cookie', `chengye_csrf=${csrf}; chengye_refresh=${token}`)
    .expect(401);
  const logout = await app.httpRequest()
    .post('/api/v1/auth/logout')
    .set('Authorization', `Bearer ${token}`)
    .set('Origin', 'http://localhost:3000')
    .set('X-CSRF-Token', csrf)
    .set('Cookie', `chengye_csrf=${csrf}`)
    .expect(401);

  assertSecurityError(me, 401, 'TOKEN_INVALID');
  assertSecurityError(business, 401, 'TOKEN_INVALID');
  assertSecurityError(refresh, 401, 'AUTHENTICATION_FAILED');
  assertSecurityError(logout, 401, 'TOKEN_INVALID');
});

test('forced change rejects confirmation mismatch, weak password, and password reuse without writes', async () => {
  const token = await passwordChangeToken();
  const mismatch = await app.httpRequest()
    .post('/api/v1/auth/password/forced-change')
    .send({ challengeToken: token, password: replacementPassword, confirmation: `${replacementPassword}x` })
    .expect(400);
  const weak = await app.httpRequest()
    .post('/api/v1/auth/password/forced-change')
    .send({ challengeToken: token, password: 'password123', confirmation: 'password123' })
    .expect(400);
  const reused = await app.httpRequest()
    .post('/api/v1/auth/password/forced-change')
    .send({ challengeToken: token, password: initialPassword, confirmation: initialPassword })
    .expect(400);

  assertSecurityError(mismatch, 400, 'PASSWORD_INVALID');
  assertSecurityError(weak, 400, 'PASSWORD_INVALID');
  assertSecurityError(reused, 400, 'PASSWORD_REUSED');
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  assert.equal(user.mustChangePassword, true);
  assert.equal(user.credentialVersion, 1);
  assert.equal(user.passwordChangedAt, null);
  assert.equal(await hasher.compare(initialPassword, user.password), true);
  assert.equal(await prisma.operationLog.count({ where: { action: 'FORCED_PASSWORD_CHANGE' } }), 0);
});

test('forced change updates credentials and audit atomically, then continues to mandatory MFA enrollment', async () => {
  const token = await passwordChangeToken();
  const response = await app.httpRequest()
    .post('/api/v1/auth/password/forced-change')
    .send({ challengeToken: token, password: replacementPassword, confirmation: replacementPassword })
    .expect(200);

  assert.equal(response.body.data.mode, 'MFA_ENROLLMENT_REQUIRED');
  assert.equal(response.body.data.expiresIn, 600);
  assert.equal(typeof response.body.data.challengeToken, 'string');
  assert.equal('token' in response.body.data, false);
  assert.equal('refreshToken' in response.body.data, false);
  assert.equal('user' in response.body.data, false);
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  assert.equal(user.mustChangePassword, false);
  assert.equal(user.credentialVersion, 2);
  assert.ok(user.passwordChangedAt);
  assert.equal(await hasher.compare(replacementPassword, user.password), true);

  const audit = await prisma.operationLog.findFirstOrThrow({ where: { action: 'FORCED_PASSWORD_CHANGE' } });
  assert.deepEqual(
    { userId: audit.userId, targetType: audit.targetType, targetId: audit.targetId, newValues: audit.newValues },
    { userId: user.id, targetType: 'USER', targetId: user.id, newValues: null },
  );

  assertSecurityError(
    await app.httpRequest()
      .post('/api/v1/auth/password/forced-change')
      .send({ challengeToken: token, password: 'Another-Horse-94!', confirmation: 'Another-Horse-94!' })
      .expect(401),
    401,
    'MFA_INVALID',
  );
  assertSecurityError(
    await app.httpRequest()
      .post('/api/v1/auth/login')
      .send({ username: 'root.admin', password: initialPassword })
      .expect(401),
    401,
    'AUTHENTICATION_FAILED',
  );

  const login = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: 'root.admin', password: replacementPassword })
    .expect(200);
  assert.equal(login.body.data.mode, 'MFA_ENROLLMENT_REQUIRED');
  assert.equal(await prisma.authSession.count({ where: { userId: user.id } }), 0);
});

test('one password-change token can commit at most one concurrent forced change', async () => {
  const token = await passwordChangeToken();
  const candidatePasswords = [replacementPassword, 'Another-Horse-94!'];
  const responses = await Promise.all(candidatePasswords.map(password => app.httpRequest()
    .post('/api/v1/auth/password/forced-change')
    .send({ challengeToken: token, password, confirmation: password })));

  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  const rejected = responses.find(response => response.status === 401);
  assert.ok(rejected);
  assertSecurityError(rejected, 401, 'MFA_INVALID');
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  assert.equal(user.credentialVersion, 2);
  assert.equal(user.mustChangePassword, false);
  assert.equal(await prisma.operationLog.count({ where: { action: 'FORCED_PASSWORD_CHANGE' } }), 1);
  const matchingPasswords = await Promise.all(candidatePasswords.map(password => hasher.compare(password, user.password)));
  assert.equal(matchingPasswords.filter(Boolean).length, 1);
});

test('session authentication and refresh reload disabled, locked, version, and must-change state', async () => {
  const initialUser = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  const fabricatedInitialAccess = jwt.sign(
    { userId: initialUser.id, credentialVersion: initialUser.credentialVersion, tokenType: 'access' },
    jwtSecret,
    { algorithm: 'HS256', expiresIn: '15m' },
  );
  assertSecurityError(
    await app.httpRequest()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${fabricatedInitialAccess}`)
      .expect(401),
    401,
    'TOKEN_INVALID',
  );

  const session = await authenticatedSession();
  const cookie = `chengye_csrf=${session.csrfToken}; chengye_refresh=${session.refreshToken}`;
  const accessAsRefresh = await app.httpRequest()
    .post('/api/v1/auth/refresh')
    .set('Origin', 'http://localhost:3000')
    .set('X-CSRF-Token', session.csrfToken)
    .set('Cookie', `chengye_csrf=${session.csrfToken}; chengye_refresh=${session.token}`)
    .expect(401);
  assertSecurityError(accessAsRefresh, 401, 'AUTHENTICATION_FAILED');
  const accessAtForcedChange = await app.httpRequest()
    .post('/api/v1/auth/password/forced-change')
    .send({ challengeToken: session.token, password: 'Another-Horse-94!', confirmation: 'Another-Horse-94!' })
    .expect(401);
  assertSecurityError(accessAtForcedChange, 401, 'MFA_INVALID');

  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
  assertSecurityError(
    await app.httpRequest().get('/api/v1/auth/me').set('Authorization', `Bearer ${session.token}`).expect(401),
    401,
    'SESSION_REVOKED',
  );
  assertSecurityError(
    await app.httpRequest().post('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:3000').set('X-CSRF-Token', session.csrfToken).set('Cookie', cookie).expect(401),
    401,
    'SESSION_REVOKED',
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { status: 'ENABLED', lockedUntil: new Date(Date.now() + 60_000) },
  });
  assertSecurityError(
    await app.httpRequest().get('/api/v1/auth/me').set('Authorization', `Bearer ${session.token}`).expect(401),
    401,
    'SESSION_REVOKED',
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { lockedUntil: null, credentialVersion: { increment: 1 } },
  });
  assertSecurityError(
    await app.httpRequest().get('/api/v1/auth/me').set('Authorization', `Bearer ${session.token}`).expect(401),
    401,
    'SESSION_REVOKED',
  );
  assertSecurityError(
    await app.httpRequest().post('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:3000').set('X-CSRF-Token', session.csrfToken).set('Cookie', cookie).expect(401),
    401,
    'SESSION_REVOKED',
  );
});

test('a failed challenge issuance emits no temporary credential or successful-login state', async () => {
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION reject_auth_challenge_for_test() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected login log failure';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER reject_auth_challenge_for_test
    BEFORE INSERT ON "auth_challenge"
    FOR EACH ROW EXECUTE FUNCTION reject_auth_challenge_for_test()
  `);

  const response = await app.httpRequest()
    .post('/api/v1/auth/login')
    .send({ username: 'root.admin', password: initialPassword })
    .expect(500);

  assertSecurityError(response, 500, 'INTERNAL_SERVER_ERROR');
  assert.equal(JSON.stringify(response.body).includes('challengeToken'), false);
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  assert.equal(user.lastLoginAt, null);
  assert.equal(user.failedLoginCount, 0);
  assert.equal(await prisma.loginLog.count(), 0);
});

test('a failed forced-change audit rolls back password and version without returning a token', async () => {
  const token = await passwordChangeToken();
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION reject_forced_change_audit_for_test() RETURNS trigger AS $$
    BEGIN
      IF NEW.action = 'FORCED_PASSWORD_CHANGE' THEN
        RAISE EXCEPTION 'injected forced-change audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER reject_forced_change_audit_for_test
    BEFORE INSERT ON "operation_log"
    FOR EACH ROW EXECUTE FUNCTION reject_forced_change_audit_for_test()
  `);

  const response = await app.httpRequest()
    .post('/api/v1/auth/password/forced-change')
    .send({ challengeToken: token, password: replacementPassword, confirmation: replacementPassword })
    .expect(500);

  assertSecurityError(response, 500, 'INTERNAL_SERVER_ERROR');
  assert.equal(JSON.stringify(response.body).includes('token'), false);
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } });
  assert.equal(user.mustChangePassword, true);
  assert.equal(user.credentialVersion, 1);
  assert.equal(user.passwordChangedAt, null);
  assert.equal(await hasher.compare(initialPassword, user.password), true);
  assert.equal(await prisma.operationLog.count({ where: { action: 'FORCED_PASSWORD_CHANGE' } }), 0);
});

test('only health and authentication state-machine endpoints bypass authorization middleware', async () => {
  await app.httpRequest().get('/api/health').expect(200);
  assertSecurityError(
    await app.httpRequest().post('/api/v1/auth/login').send({}).expect(401),
    401,
    'AUTHENTICATION_FAILED',
  );
  const csrf = 'public-route-csrf';
  assertSecurityError(await app.httpRequest().post('/api/v1/auth/refresh')
    .set('Origin', 'http://localhost:3000').set('X-CSRF-Token', csrf)
    .set('Cookie', `chengye_csrf=${csrf}; chengye_refresh=invalid`).expect(401), 401, 'AUTHENTICATION_FAILED');
  for (const [requestPath, body] of [
    ['/api/v1/auth/password/forced-change', { challengeToken: 'invalid', password: replacementPassword, confirmation: replacementPassword }],
    ['/api/v1/auth/mfa/enrollment', { challengeToken: 'invalid' }],
    ['/api/v1/auth/mfa/enrollment/confirm', { challengeToken: 'invalid', code: '123456' }],
    ['/api/v1/auth/mfa/verify', { challengeToken: 'invalid', credential: { kind: 'TOTP', code: '123456' } }],
  ] as const) {
    const response = await app.httpRequest().post(requestPath).send(body).expect(401);
    assert.notEqual(response.body.message, 'TOKEN_INVALID');
  }
  for (const requestPath of ['/api/v1/auth/me', '/api/v1/users', '/api/v1/not-a-real-route']) {
    assertSecurityError(await app.httpRequest().get(requestPath).expect(401), 401, 'TOKEN_INVALID');
  }
});

test('controller and middleware adapters contain no direct bcrypt or JWT operations', () => {
  const serverRoot = path.resolve(__dirname, '../..');
  for (const relativePath of ['app/controller/auth.ts', 'app/middleware/auth.ts']) {
    const source = fs.readFileSync(path.join(serverRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /bcrypt|jsonwebtoken|jwt\.(?:sign|verify)/i);
  }
});
