import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { SessionService } from '../../app/application/auth/session-service';
import { StepUpService } from '../../app/application/auth/step-up-service';
import { decodeBase32 } from '../../app/domain/security/base32';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { hashOpaqueToken } from '../../app/domain/security/opaque-token';
import { SecurityError } from '../../app/domain/security/security-errors';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { TotpService } from '../../app/domain/security/totp-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const jwtSecret = '01234567890123456789012345678901';
const key = Buffer.from('0123456789abcdef0123456789abcdef');
const secret = 'JBSWY3DPEHPK3PXP';
const baseTime = new Date('2099-01-02T03:04:05.000Z');
let prisma: PrismaClient;
let userId: string;
let now: Date;

function codeAt(time: Date): string {
  const counter = BigInt(Math.floor(time.getTime() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

function wrongCodeAt(time: Date): string {
  return ((Number(codeAt(time)) + 1) % 1_000_000).toString().padStart(6, '0');
}

function stepUp(): StepUpService {
  return new StepUpService(
    prisma,
    new TotpService(),
    new MfaSecretCrypto(new Map([[1, key]])),
    undefined,
    () => new Date(now),
  );
}

async function claims(assuranceLevel: 'PASSWORD' | 'MFA' = 'MFA') {
  const credentials = await new SessionService(
    prisma,
    new JwtTokenService(jwtSecret),
    undefined,
    () => new Date(now),
  ).create(userId, assuranceLevel, {});
  return {
    userId,
    sessionId: credentials.sessionId,
    credentialVersion: 1,
    assuranceLevel,
  } as const;
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof SecurityError && error.code === code;
}

const target = { sessionId: 'session-to-revoke' };

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  now = new Date(baseTime);
  userId = (await prisma.user.create({
    data: { username: `stepup.${randomUUID()}`, password: 'unused' },
  })).id;
  const encrypted = new MfaSecretCrypto(new Map([[1, key]])).encrypt(secret);
  await prisma.mfaFactor.create({ data: {
    userId,
    type: 'TOTP',
    encryptedSecret: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    verifiedAt: now,
  } });
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('issues a hashed five-minute grant only from an MFA session', async () => {
  const passwordClaims = await claims('PASSWORD');
  await assert.rejects(
    () => stepUp().issue(passwordClaims, { purpose: 'SESSION_REVOKE', target, code: codeAt(now) }),
    hasCode('STEP_UP_REQUIRED'),
  );

  const mfaClaims = await claims('MFA');
  const issued = await stepUp().issue(mfaClaims, {
    purpose: 'SESSION_REVOKE', target, code: codeAt(now),
  });
  const stored = await prisma.stepUpGrant.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(issued.stepUpToken) },
  });
  assert.equal(issued.expiresIn, 300);
  assert.notEqual(stored.tokenHash, issued.stepUpToken);
  assert.deepEqual(stored.expiresAt, new Date(now.getTime() + 300_000));
  assert.equal(stored.sessionId, mfaClaims.sessionId);
});

test('consumes a matching grant once inside the protected transaction', async () => {
  const activeClaims = await claims();
  const issued = await stepUp().issue(activeClaims, {
    purpose: 'SESSION_REVOKE', target, code: codeAt(now),
  });
  await prisma.$transaction(async tx => {
    await stepUp().consume(tx, activeClaims, 'SESSION_REVOKE', target, issued.stepUpToken);
    await tx.operationLog.create({ data: {
      userId, action: 'PROTECTED_WRITE', targetType: 'AUTH_SESSION', targetId: target.sessionId,
    } });
  });
  assert.ok((await prisma.stepUpGrant.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(issued.stepUpToken) },
  })).consumedAt);
  await assert.rejects(
    () => prisma.$transaction(tx => stepUp().consume(
      tx, activeClaims, 'SESSION_REVOKE', target, issued.stepUpToken,
    )),
    hasCode('STEP_UP_INVALID'),
  );
});

test('rejects cross-session, purpose, target, and expired grant use', async () => {
  const activeClaims = await claims();
  const issued = await stepUp().issue(activeClaims, {
    purpose: 'SESSION_REVOKE', target, code: codeAt(now),
  });
  const otherSession = await claims();
  await assert.rejects(
    () => prisma.$transaction(tx => stepUp().consume(
      tx, otherSession, 'SESSION_REVOKE', target, issued.stepUpToken,
    )),
    hasCode('STEP_UP_INVALID'),
  );
  await assert.rejects(
    () => prisma.$transaction(tx => stepUp().consume(
      tx, activeClaims, 'SESSION_REVOKE_ALL', { userId }, issued.stepUpToken,
    )),
    hasCode('STEP_UP_PURPOSE_MISMATCH'),
  );
  await assert.rejects(
    () => prisma.$transaction(tx => stepUp().consume(
      tx, activeClaims, 'SESSION_REVOKE', { sessionId: 'different' }, issued.stepUpToken,
    )),
    hasCode('STEP_UP_TARGET_MISMATCH'),
  );
  now = new Date(now.getTime() + 300_001);
  await assert.rejects(
    () => prisma.$transaction(tx => stepUp().consume(
      tx, activeClaims, 'SESSION_REVOKE', target, issued.stepUpToken,
    )),
    hasCode('STEP_UP_EXPIRED'),
  );
});

test('rolls back grant consumption when the protected write fails', async () => {
  const activeClaims = await claims();
  const issued = await stepUp().issue(activeClaims, {
    purpose: 'SESSION_REVOKE', target, code: codeAt(now),
  });
  await assert.rejects(() => prisma.$transaction(async tx => {
    await stepUp().consume(tx, activeClaims, 'SESSION_REVOKE', target, issued.stepUpToken);
    throw new Error('protected write failed');
  }), /protected write failed/);
  assert.equal((await prisma.stepUpGrant.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(issued.stepUpToken) },
  })).consumedAt, null);
});

test('requires a successful Step-Up after cooldown before resetting failures', async () => {
  const activeClaims = await claims();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () => stepUp().issue(activeClaims, {
        purpose: 'SESSION_REVOKE', target, code: wrongCodeAt(now),
      }),
      hasCode('STEP_UP_INVALID'),
    );
  }
  await assert.rejects(
    () => stepUp().issue(activeClaims, {
      purpose: 'SESSION_REVOKE', target, code: wrongCodeAt(now),
    }),
    hasCode('MFA_RATE_LIMITED'),
  );

  const blocked = await prisma.authSession.findUniqueOrThrow({ where: { id: activeClaims.sessionId } });
  assert.equal(blocked.stepUpFailedAttempts, 5);
  assert.deepEqual(blocked.stepUpBlockedUntil, new Date(now.getTime() + 15 * 60 * 1000));
  await assert.rejects(
    () => stepUp().issue(activeClaims, {
      purpose: 'SESSION_REVOKE', target, code: codeAt(now),
    }),
    hasCode('MFA_RATE_LIMITED'),
  );

  now = new Date(now.getTime() + 15 * 60 * 1000 + 1);
  await stepUp().issue(activeClaims, {
    purpose: 'SESSION_REVOKE', target, code: codeAt(now),
  });
  const reset = await prisma.authSession.findUniqueOrThrow({ where: { id: activeClaims.sessionId } });
  assert.equal(reset.stepUpFailedAttempts, 0);
  assert.equal(reset.stepUpBlockedUntil, null);

  const audits = await prisma.operationLog.findMany({
    where: { userId, action: 'STEP_UP_REJECTED' },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(audits.length, 6);
  assert.ok(audits.every(audit => !`${audit.oldValues}${audit.newValues}`.includes(wrongCodeAt(baseTime))));
});

test('serializes concurrent wrong Step-Up attempts against the same session', async () => {
  const activeClaims = await claims();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => stepUp().issue(
    activeClaims,
    { purpose: 'SESSION_REVOKE', target, code: wrongCodeAt(now) },
  )));

  const codes = results.map(result => {
    assert.equal(result.status, 'rejected');
    assert.ok(result.reason instanceof SecurityError);
    return result.reason.code;
  }).sort();
  assert.deepEqual(codes, [
    'MFA_RATE_LIMITED',
    'STEP_UP_INVALID',
    'STEP_UP_INVALID',
    'STEP_UP_INVALID',
    'STEP_UP_INVALID',
  ]);
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: activeClaims.sessionId } });
  assert.equal(session.stepUpFailedAttempts, 5);
  assert.deepEqual(session.stepUpBlockedUntil, new Date(now.getTime() + 15 * 60 * 1000));
});

test('persists redacted rejection audits for mismatched and expired grant consumption', async () => {
  const activeClaims = await claims();
  const issued = await stepUp().issue(activeClaims, {
    purpose: 'SESSION_REVOKE', target, code: codeAt(now),
  });
  await assert.rejects(
    () => prisma.$transaction(tx => stepUp().consume(
      tx, activeClaims, 'SESSION_REVOKE', { sessionId: 'different' }, issued.stepUpToken,
    )),
    hasCode('STEP_UP_TARGET_MISMATCH'),
  );
  now = new Date(now.getTime() + 300_001);
  await assert.rejects(
    () => prisma.$transaction(tx => stepUp().consume(
      tx, activeClaims, 'SESSION_REVOKE', target, issued.stepUpToken,
    )),
    hasCode('STEP_UP_EXPIRED'),
  );

  const audits = await prisma.operationLog.findMany({
    where: { userId, action: 'STEP_UP_REJECTED' },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(audits.length, 2);
  assert.match(audits[0].newValues ?? '', /TARGET_MISMATCH/);
  assert.match(audits[1].newValues ?? '', /EXPIRED/);
  assert.ok(audits.every(audit => !`${audit.oldValues}${audit.newValues}`.includes(issued.stepUpToken)));
});
