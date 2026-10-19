import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { AuthChallengeService } from '../../app/application/auth/auth-challenge-service';
import { MfaService } from '../../app/application/auth/mfa-service';
import { SessionService } from '../../app/application/auth/session-service';
import { decodeBase32 } from '../../app/domain/security/base32';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { SecurityError } from '../../app/domain/security/security-errors';
import { TotpService } from '../../app/domain/security/totp-service';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { StepUpService } from '../../app/application/auth/step-up-service';

const key = Buffer.from('0123456789abcdef0123456789abcdef');
const baseTime = new Date('2099-01-02T03:04:05.000Z');
let prisma: PrismaClient;
let userId: string;
let username: string;
let now: Date;

function services(localPasswordLogin = false) {
  const challenges = new AuthChallengeService(prisma, () => new Date(now));
  const secretCrypto = new MfaSecretCrypto(new Map([[1, key]]));
  return {
    challenges,
    secretCrypto,
    mfa: new MfaService(
      prisma,
      challenges,
      new TotpService(),
      secretCrypto,
      new BcryptPasswordHasher(4),
      new StepUpService(prisma, new TotpService(), secretCrypto, undefined, () => new Date(now)),
      undefined,
      () => new Date(now),
      localPasswordLogin,
    ),
  };
}

function totpCode(secret: string, time: Date): string {
  const counter = BigInt(Math.floor(time.getTime() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof SecurityError && error.code === code;
}

function wrongTotpCode(secret: string, time: Date): string {
  return ((Number(totpCode(secret, time)) + 1) % 1_000_000).toString().padStart(6, '0');
}

async function beginAndConfirm() {
  const { challenges, mfa } = services();
  const challenge = await challenges.issue(userId, 'MFA_ENROLLMENT');
  const enrollment = await mfa.beginEnrollment(challenge.token);
  const verified = await mfa.confirmEnrollment(challenge.token, totpCode(enrollment.secret, now));
  return { enrollment, verified };
}

async function activeClaims(targetUserId: string, assuranceLevel: 'PASSWORD' | 'MFA' = 'PASSWORD') {
  const credentials = await new SessionService(
    prisma,
    new JwtTokenService('01234567890123456789012345678901'),
    undefined,
    () => new Date(now),
  ).create(targetUserId, assuranceLevel, {});
  return {
    userId: targetUserId,
    sessionId: credentials.sessionId,
    credentialVersion: 1,
    assuranceLevel,
  } as const;
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  now = new Date(baseTime);
  username = `mfa.${randomUUID()}`;
  userId = (await prisma.user.create({ data: { username, password: 'unused' } })).id;
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('starts enrollment with an encrypted pending factor and local QR payload', async () => {
  const { challenges, mfa, secretCrypto } = services();
  const challenge = await challenges.issue(userId, 'MFA_ENROLLMENT');
  const enrollment = await mfa.beginEnrollment(challenge.token);
  const factor = await prisma.mfaFactor.findFirstOrThrow({ where: { userId, disabledAt: null } });

  assert.match(enrollment.secret, /^[A-Z2-7]{32}$/);
  assert.equal(enrollment.manualKey, enrollment.secret);
  assert.match(enrollment.otpauthUri, /^otpauth:\/\/totp\/Chengye%20OA:/);
  assert.match(enrollment.otpauthUri, new RegExp(encodeURIComponent(username)));
  assert.notEqual(factor.encryptedSecret, enrollment.secret);
  assert.equal(secretCrypto.decrypt({
    ciphertext: factor.encryptedSecret,
    iv: factor.secretIv,
    authTag: factor.secretAuthTag,
    keyVersion: factor.keyVersion,
  }), enrollment.secret);
  assert.equal(factor.verifiedAt, null);
});

test('persists a redacted audit when an enrollment challenge expires before setup begins', async () => {
  const challenge = await services().challenges.issue(userId, 'MFA_ENROLLMENT');
  now = new Date(now.getTime() + 10 * 60 * 1000 + 1);

  await assert.rejects(
    () => services().mfa.beginEnrollment(challenge.token),
    hasCode('MFA_CHALLENGE_EXPIRED'),
  );

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { userId, action: 'MFA_ENROLLMENT_REJECTED' },
  });
  assert.match(audit.newValues ?? '', /MFA_CHALLENGE_EXPIRED/);
  assert.equal(JSON.stringify(audit).includes(challenge.token), false);
});

test('confirms enrollment atomically and returns ten one-time recovery codes', async () => {
  const { enrollment, verified } = await beginAndConfirm();
  const factor = await prisma.mfaFactor.findFirstOrThrow({ where: { userId, disabledAt: null } });
  const codes = await prisma.mfaRecoveryCode.findMany({ where: { factorId: factor.id } });
  const audit = await prisma.operationLog.findMany({ where: { userId } });

  assert.equal(verified.userId, userId);
  assert.equal(verified.assuranceLevel, 'MFA');
  assert.equal(verified.recoveryCodes?.length, 10);
  assert.equal(new Set(verified.recoveryCodes).size, 10);
  assert.ok(verified.recoveryCodes?.every(code => /^[A-Z2-7]{8}(?:-[A-Z2-7]{8}){3}$/.test(code)));
  assert.ok(factor.verifiedAt);
  assert.equal(factor.lastAcceptedCounter, BigInt(Math.floor(now.getTime() / 30_000)));
  assert.equal(codes.length, 10);
  assert.ok(codes.every(code => !verified.recoveryCodes?.includes(code.codeHash)));
  let firstCodeMatched = false;
  for (const code of codes) {
    firstCodeMatched ||= await new BcryptPasswordHasher(4).compare(verified.recoveryCodes![0], code.codeHash);
  }
  assert.equal(firstCodeMatched, true);
  assert.equal(JSON.stringify(audit).includes(enrollment.secret), false);
  assert.ok(verified.recoveryCodes?.every(code => !JSON.stringify(audit).includes(code)));
});

test('rejects optional enrollment for an existing factor, administrator, or inactive account', async () => {
  await beginAndConfirm();
  const existingFactorClaims = await activeClaims(userId, 'MFA');
  await assert.rejects(
    () => services().mfa.startOptionalEnrollment(existingFactorClaims),
    hasCode('MFA_INVALID'),
  );

  const admin = await prisma.user.create({
    data: { username: `admin.${randomUUID()}`, password: 'unused' },
  });
  const role = await prisma.role.create({
    data: { id: `role:${randomUUID()}`, code: 'SYSTEM_ADMIN', name: 'System Admin', type: 'SYSTEM' },
  });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });
  const adminClaims = await activeClaims(admin.id, 'MFA');
  await assert.rejects(
    () => services().mfa.startOptionalEnrollment(adminClaims),
    hasCode('MFA_INVALID'),
  );

  const inactive = await prisma.user.create({
    data: { username: `inactive.${randomUUID()}`, password: 'unused' },
  });
  const inactiveClaims = await activeClaims(inactive.id);
  await prisma.user.update({ where: { id: inactive.id }, data: { status: 'DISABLED' } });
  await assert.rejects(
    () => services().mfa.startOptionalEnrollment(inactiveClaims),
    hasCode('MFA_INVALID'),
  );
});

test('rejects reuse of an accepted TOTP counter and accepts the next period', async () => {
  const { enrollment } = await beginAndConfirm();
  const firstChallenge = await services().challenges.issue(userId, 'MFA_VERIFY');
  await assert.rejects(
    () => services().mfa.verifyLogin(firstChallenge.token, { kind: 'TOTP', code: totpCode(enrollment.secret, now) }),
    hasCode('MFA_INVALID'),
  );

  now = new Date(now.getTime() + 30_000);
  const nextChallenge = await services().challenges.issue(userId, 'MFA_VERIFY');
  const verified = await services().mfa.verifyLogin(
    nextChallenge.token,
    { kind: 'TOTP', code: totpCode(enrollment.secret, now) },
  );
  assert.deepEqual(verified, { userId, assuranceLevel: 'MFA' });
});

test('uses a recovery code once and rejects reuse', async () => {
  const { verified } = await beginAndConfirm();
  const recoveryCode = verified.recoveryCodes![0];
  const firstChallenge = await services().challenges.issue(userId, 'MFA_VERIFY');
  assert.deepEqual(
    await services().mfa.verifyLogin(firstChallenge.token, { kind: 'RECOVERY_CODE', code: recoveryCode }),
    { userId, assuranceLevel: 'MFA' },
  );

  const used = await prisma.mfaRecoveryCode.findFirstOrThrow({ where: { usedAt: { not: null } } });
  assert.ok(used.usedAt);
  const secondChallenge = await services().challenges.issue(userId, 'MFA_VERIFY');
  await assert.rejects(
    () => services().mfa.verifyLogin(secondChallenge.token, { kind: 'RECOVERY_CODE', code: recoveryCode }),
    hasCode('MFA_INVALID'),
  );
});

test('persists a redacted audit for a rejected MFA credential', async () => {
  const { enrollment } = await beginAndConfirm();
  const challenge = await services().challenges.issue(userId, 'MFA_VERIFY');
  const rejectedCode = wrongTotpCode(enrollment.secret, now);

  await assert.rejects(
    () => services().mfa.verifyLogin(challenge.token, { kind: 'TOTP', code: rejectedCode }),
    hasCode('MFA_INVALID'),
  );

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { userId, action: 'MFA_VERIFICATION_REJECTED' },
  });
  assert.match(audit.newValues ?? '', /MFA_INVALID/);
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes(rejectedCode), false);
  assert.equal(serialized.includes(challenge.token), false);
  assert.equal(serialized.includes(enrollment.secret), false);
});

test('persists a redacted audit when an MFA challenge expires', async () => {
  const { enrollment } = await beginAndConfirm();
  const challenge = await services().challenges.issue(userId, 'MFA_VERIFY');
  now = new Date(now.getTime() + 5 * 60 * 1000 + 1);

  await assert.rejects(
    () => services().mfa.verifyLogin(challenge.token, {
      kind: 'TOTP', code: totpCode(enrollment.secret, now),
    }),
    hasCode('MFA_CHALLENGE_EXPIRED'),
  );

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { userId, action: 'MFA_VERIFICATION_REJECTED' },
  });
  assert.match(audit.newValues ?? '', /MFA_CHALLENGE_EXPIRED/);
  assert.equal(JSON.stringify(audit).includes(challenge.token), false);
});

test('reuses a recent pending enrollment and replaces it after fifteen minutes', async () => {
  const firstChallenge = await services().challenges.issue(userId, 'MFA_ENROLLMENT');
  const first = await services().mfa.beginEnrollment(firstChallenge.token);
  assert.equal((await services().mfa.beginEnrollment(firstChallenge.token)).secret, first.secret);

  now = new Date(now.getTime() + 15 * 60 * 1000);
  const secondChallenge = await services().challenges.issue(userId, 'MFA_ENROLLMENT');
  const second = await services().mfa.beginEnrollment(secondChallenge.token);
  assert.notEqual(second.secret, first.secret);
  assert.equal(await prisma.mfaFactor.count({ where: { userId, disabledAt: null } }), 1);
  assert.equal(await prisma.mfaFactor.count({ where: { userId, disabledAt: { not: null } } }), 1);
});

test('reports factor state and remaining recovery codes', async () => {
  assert.deepEqual(await services().mfa.status(userId), {
    enabled: false, verifiedAt: null, recoveryCodesRemaining: 0,
  });
  const { verified } = await beginAndConfirm();
  const challenge = await services().challenges.issue(userId, 'MFA_VERIFY');
  await services().mfa.verifyLogin(challenge.token, {
    kind: 'RECOVERY_CODE', code: verified.recoveryCodes![0],
  });
  const status = await services().mfa.status(userId);
  assert.equal(status.enabled, true);
  assert.deepEqual(status.verifiedAt, now);
  assert.equal(status.recoveryCodesRemaining, 9);
});


test('local password administrator can bind MFA but cannot replace a verified factor or use a revoked session', async () => {
  const role = await prisma.role.create({data:{code:'SYSTEM_SUPER_ADMIN',name:'Super Admin',type:'SYSTEM'}});
  await prisma.userRole.create({data:{userId,roleId:role.id}});
  const claims = await activeClaims(userId);
  const mfa = services(true).mfa;
  const challenge = await mfa.startOptionalEnrollment(claims);
  const enrollment = await mfa.beginEnrollment(challenge.challengeToken);
  const verified = await mfa.confirmEnrollment(challenge.challengeToken, totpCode(enrollment.secret, now));
  assert.equal(verified.assuranceLevel, 'MFA');
  assert.ok((await mfa.status(userId)).enabled);
  await assert.rejects(()=>mfa.startOptionalEnrollment(claims), hasCode('MFA_INVALID'));
  const fresh = await activeClaims(userId,'MFA');
  await assert.rejects(()=>mfa.startOptionalEnrollment(fresh), hasCode('MFA_INVALID'));
});
