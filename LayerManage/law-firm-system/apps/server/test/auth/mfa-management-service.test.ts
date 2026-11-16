import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { AuthChallengeService } from '../../app/application/auth/auth-challenge-service';
import { MfaService } from '../../app/application/auth/mfa-service';
import { SessionService, ActiveSessionClaims } from '../../app/application/auth/session-service';
import { StepUpService } from '../../app/application/auth/step-up-service';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { createOpaqueToken, hashOpaqueToken } from '../../app/domain/security/opaque-token';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { SecurityError } from '../../app/domain/security/security-errors';
import { digestStepUpTarget, StepUpPurpose } from '../../app/domain/security/step-up-target';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { TotpService } from '../../app/domain/security/totp-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const now = new Date('2099-01-02T03:04:05.000Z');
const key = Buffer.from('0123456789abcdef0123456789abcdef');
const jwtSecret = '01234567890123456789012345678901';
const hasher = new BcryptPasswordHasher(4);
let prisma: PrismaClient;
let userId: string;
let factorId: string;
let claims: ActiveSessionClaims;

function management(): MfaService {
  const crypto = new MfaSecretCrypto(new Map([[1, key]]));
  const stepUp = new StepUpService(prisma, new TotpService(), crypto, undefined, () => new Date(now));
  return new MfaService(
    prisma,
    new AuthChallengeService(prisma, () => new Date(now)),
    new TotpService(),
    crypto,
    hasher,
    stepUp,
    undefined,
    () => new Date(now),
  );
}

async function grant(purpose: StepUpPurpose, target: unknown): Promise<string> {
  const token = createOpaqueToken();
  await prisma.stepUpGrant.create({ data: {
    sessionId: claims.sessionId,
    userId,
    purpose,
    targetDigest: digestStepUpTarget(purpose, target),
    tokenHash: hashOpaqueToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 300_000),
  } });
  return token;
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof SecurityError && error.code === code;
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  userId = (await prisma.user.create({ data: { username: `mfa.manage.${randomUUID()}`, password: 'x' } })).id;
  const encrypted = new MfaSecretCrypto(new Map([[1, key]])).encrypt(new TotpService().generateSecret());
  factorId = (await prisma.mfaFactor.create({ data: {
    userId,
    encryptedSecret: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    verifiedAt: now,
  } })).id;
  await prisma.mfaRecoveryCode.createMany({ data: await Promise.all(
    ['OLD-CODE-ONE', 'OLD-CODE-TWO'].map(async code => ({ factorId, codeHash: await hasher.hash(code) })),
  ) });
  const credentials = await new SessionService(
    prisma, new JwtTokenService(jwtSecret), undefined, () => new Date(now),
  ).create(userId, 'MFA', {});
  claims = { userId, sessionId: credentials.sessionId, credentialVersion: 1, assuranceLevel: 'MFA' };
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('disables ordinary-user MFA without step-up and still forbids administrator disable', async () => {
  const role = await prisma.role.create({
    data: { id: 'role:system-admin', code: 'SYSTEM_ADMIN', name: 'System Admin', type: 'SYSTEM' },
  });
  await prisma.userRole.create({ data: { userId, roleId: role.id } });
  const blockedGrant = await grant('MFA_DISABLE_SELF', { userId });
  await assert.rejects(() => management().disableSelf(claims, blockedGrant), hasCode('MFA_REQUIRED'));
  assert.equal((await prisma.mfaFactor.findUniqueOrThrow({ where: { id: factorId } })).disabledAt, null);
  assert.equal((await prisma.stepUpGrant.findUniqueOrThrow({ where: { tokenHash: hashOpaqueToken(blockedGrant) } })).consumedAt, null);

  await prisma.userRole.updateMany({
    where: { userId },
    data: { revokedAt: now, revokedByUserId: userId, revokeReason: 'test role removal' },
  });
  await management().disableSelf(claims);
  assert.ok((await prisma.mfaFactor.findUniqueOrThrow({ where: { id: factorId } })).disabledAt);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { factorId, usedAt: null } }), 0);
  assert.equal(await prisma.authSession.count({ where: { userId, revokedAt: { not: null } } }), 1);
});

test('regenerates ten recovery codes atomically and invalidates every old code', async () => {
  const result = await management().regenerateRecoveryCodes(claims);

  assert.equal(result.recoveryCodes.length, 10);
  assert.equal(new Set(result.recoveryCodes).size, 10);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { factorId, usedAt: { not: null } } }), 2);
  const fresh = await prisma.mfaRecoveryCode.findMany({ where: { factorId, usedAt: null } });
  assert.equal(fresh.length, 10);
  assert.ok(fresh.every(stored => !result.recoveryCodes.includes(stored.codeHash)));
  assert.equal(await prisma.operationLog.count({ where: { userId, action: 'MFA_RECOVERY_CODES_REGENERATED' } }), 1);
});
