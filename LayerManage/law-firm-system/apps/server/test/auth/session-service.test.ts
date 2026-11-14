import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { SessionService } from '../../app/application/auth/session-service';
import { hashOpaqueToken } from '../../app/domain/security/opaque-token';
import { SecurityError } from '../../app/domain/security/security-errors';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { StepUpService } from '../../app/application/auth/step-up-service';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { TotpService } from '../../app/domain/security/totp-service';
import { createOpaqueToken } from '../../app/domain/security/opaque-token';
import { digestStepUpTarget, StepUpPurpose } from '../../app/domain/security/step-up-target';

const jwtSecret = '01234567890123456789012345678901';
const baseTime = new Date('2099-01-02T03:04:05.000Z');
let prisma: PrismaClient;
let userId: string;
let now: Date;

function service(): SessionService {
  const stepUp = new StepUpService(
    prisma,
    new TotpService(),
    new MfaSecretCrypto(new Map([[1, Buffer.from('0123456789abcdef0123456789abcdef')]])),
    undefined,
    () => new Date(now),
  );
  return new SessionService(prisma, new JwtTokenService(jwtSecret), undefined, () => new Date(now), stepUp);
}

async function grant(sessionId: string, purpose: StepUpPurpose, target: unknown): Promise<string> {
  const token = createOpaqueToken();
  await prisma.stepUpGrant.create({ data: {
    sessionId, userId, purpose, targetDigest: digestStepUpTarget(purpose, target),
    tokenHash: hashOpaqueToken(token), createdAt: now, expiresAt: new Date(now.getTime() + 300_000),
  } });
  return token;
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof SecurityError && error.code === code;
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  now = new Date(baseTime);
  userId = (await prisma.user.create({
    data: { username: `session.${randomUUID()}`, password: 'unused', credentialVersion: 3 },
  })).id;
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('creates a 30-day server session and a 15-minute access credential', async () => {
  const created = await service().create(userId, 'MFA', {
    ip: '192.168.20.42', userAgent: 'Sensitive Browser 1.0',
  });
  const stored = await prisma.authSession.findUniqueOrThrow({ where: { id: created.sessionId } });
  const claims = new JwtTokenService(jwtSecret).verifySessionAccess(created.accessToken);

  assert.equal(created.expiresIn, 900);
  assert.match(created.refreshToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(created.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(stored.refreshTokenHash, hashOpaqueToken(created.refreshToken));
  assert.notEqual(stored.userAgentHash, 'Sensitive Browser 1.0');
  assert.equal(stored.ipPrefix, '192.168.20.0/24');
  assert.deepEqual(stored.expiresAt, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
  assert.equal(claims.sessionId, stored.id);
  assert.equal(claims.assuranceLevel, 'MFA');
});

test('rolls back session creation when the authentication completion write fails', async () => {
  await assert.rejects(
    () => service().create(userId, 'MFA', {}, async () => { throw new Error('completion failed'); }),
    /completion failed/,
  );
  assert.equal(await prisma.authSession.count({ where: { userId } }), 0);
  assert.equal(await prisma.operationLog.count({ where: { userId } }), 0);
});

test('authenticates only an active session with a current user credential version', async () => {
  const created = await service().create(userId, 'PASSWORD', {});
  assert.deepEqual(await service().authenticateAccess(created.accessToken), {
    userId,
    sessionId: created.sessionId,
    credentialVersion: 3,
    assuranceLevel: 'PASSWORD',
  });

  await service().revokeCurrent(created.sessionId, 'USER_LOGOUT');
  await assert.rejects(() => service().authenticateAccess(created.accessToken), hasCode('SESSION_REVOKED'));
});

test('rotates refresh credentials and revokes the session when the predecessor is reused', async () => {
  const created = await service().create(userId, 'MFA', {});
  const rotated = await service().rotateRefresh(created.refreshToken, {});
  const stored = await prisma.authSession.findUniqueOrThrow({ where: { id: created.sessionId } });

  assert.notEqual(rotated.refreshToken, created.refreshToken);
  assert.equal(stored.refreshGeneration, 2);
  assert.equal(stored.refreshTokenHash, hashOpaqueToken(rotated.refreshToken));
  assert.equal(stored.previousRefreshTokenHash, hashOpaqueToken(created.refreshToken));
  await assert.rejects(() => service().rotateRefresh(created.refreshToken, {}), hasCode('REFRESH_TOKEN_REUSED'));
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: created.sessionId } })).revokedAt);
});

test('rejects expired, disabled, changed, and forced-password-change sessions', async () => {
  const expired = await service().create(userId, 'PASSWORD', {});
  now = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await assert.rejects(() => service().authenticateAccess(expired.accessToken), hasCode('SESSION_REVOKED'));

  now = new Date(baseTime);
  const changed = await service().create(userId, 'PASSWORD', {});
  await prisma.user.update({ where: { id: userId }, data: { credentialVersion: 4 } });
  await assert.rejects(() => service().authenticateAccess(changed.accessToken), hasCode('SESSION_REVOKED'));
});

test('lists sanitized sessions and revokes every user session', async () => {
  const first = await service().create(userId, 'PASSWORD', { ip: '2001:db8:abcd:1234::1' });
  now = new Date(now.getTime() + 1000);
  const second = await service().create(userId, 'MFA', {});
  const listed = await service().list(userId, second.sessionId);

  assert.equal(listed.length, 2);
  assert.equal(listed.find(item => item.id === second.sessionId)?.current, true);
  assert.equal(JSON.stringify(listed).includes(first.refreshToken), false);
  assert.equal(await service().revokeAll(userId, 'USER_LOGOUT_ALL'), 2);
  assert.equal(await prisma.authSession.count({ where: { userId, revokedAt: { not: null } } }), 2);
});

test('revokes only a session owned by the authenticated user', async () => {
  const created = await service().create(userId, 'MFA', {});
  assert.equal(await service().revokeOwned('another-user', created.sessionId, 'USER_SESSION_REVOKE'), false);
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: created.sessionId } })).revokedAt, null);
  assert.equal(await service().revokeOwned(userId, created.sessionId, 'USER_SESSION_REVOKE'), true);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: created.sessionId } })).revokedAt);
});

test('requires target-bound step-up to revoke another session', async () => {
  const current = await service().create(userId, 'MFA', {});
  const target = await service().create(userId, 'MFA', {});
  const activeClaims = {
    userId, sessionId: current.sessionId, credentialVersion: 3, assuranceLevel: 'MFA' as const,
  };
  await assert.rejects(
    () => service().revokeOwnedWithStepUp(activeClaims, target.sessionId, ''),
    hasCode('STEP_UP_REQUIRED'),
  );
  const token = await grant(current.sessionId, 'SESSION_REVOKE', { sessionId: target.sessionId });
  assert.equal(await service().revokeOwnedWithStepUp(activeClaims, target.sessionId, token), true);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: target.sessionId } })).revokedAt);
});

test('step-up logout-all revokes all sessions or explicitly preserves the current session', async () => {
  const current = await service().create(userId, 'MFA', {});
  await service().create(userId, 'MFA', {});
  const activeClaims = {
    userId, sessionId: current.sessionId, credentialVersion: 3, assuranceLevel: 'MFA' as const,
  };
  const token = await grant(current.sessionId, 'SESSION_REVOKE_ALL', { userId });
  assert.equal(await service().revokeAllWithStepUp(activeClaims, token, true), 1);
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: current.sessionId } })).revokedAt, null);

  await service().create(userId, 'MFA', {});
  const allToken = await grant(current.sessionId, 'SESSION_REVOKE_ALL', { userId });
  assert.equal(await service().revokeAllWithStepUp(activeClaims, allToken), 2);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: current.sessionId } })).revokedAt);
});
