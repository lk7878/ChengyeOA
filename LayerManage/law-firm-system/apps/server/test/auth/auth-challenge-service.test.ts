import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { AuthChallengeService } from '../../app/application/auth/auth-challenge-service';
import { SecurityError } from '../../app/domain/security/security-errors';
import { hashOpaqueToken } from '../../app/domain/security/opaque-token';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const baseTime = new Date('2099-01-02T03:04:05.000Z');
let prisma: PrismaClient;
let userId: string;
let now: Date;

function service(): AuthChallengeService {
  return new AuthChallengeService(prisma, () => new Date(now));
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof SecurityError && error.code === code;
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  now = new Date(baseTime);
  userId = (await prisma.user.create({
    data: { username: `challenge.${randomUUID()}`, password: 'unused' },
  })).id;
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('issues a hashed five-minute challenge and never stores its raw token', async () => {
  const issued = await service().issue(userId, 'MFA_VERIFY');
  const stored = await prisma.authChallenge.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(issued.token) },
  });

  assert.equal(issued.expiresIn, 300);
  assert.equal(stored.tokenHash, hashOpaqueToken(issued.token));
  assert.notEqual(stored.tokenHash, issued.token);
  assert.deepEqual(stored.expiresAt, new Date(now.getTime() + 300_000));
  assert.equal(stored.failedAttempts, 0);
});

test('replaces an active same-type challenge but keeps other challenge types', async () => {
  const first = await service().issue(userId, 'MFA_VERIFY');
  const enrollment = await service().issue(userId, 'MFA_ENROLLMENT');
  const replacement = await service().issue(userId, 'MFA_VERIFY');

  assert.notEqual(first.token, replacement.token);
  assert.ok((await prisma.authChallenge.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(first.token) },
  })).consumedAt);
  assert.equal((await prisma.authChallenge.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(enrollment.token) },
  })).consumedAt, null);
  assert.equal(enrollment.expiresIn, 600);
});

test('consumes a challenge only when its transaction callback succeeds', async () => {
  const issued = await service().issue(userId, 'MFA_VERIFY');
  const result = await service().consume(issued.token, 'MFA_VERIFY', async (_tx, lockedUserId) => {
    assert.equal(lockedUserId, userId);
    return 'verified';
  });

  assert.equal(result, 'verified');
  assert.ok((await prisma.authChallenge.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(issued.token) },
  })).consumedAt);

  const retry = await service().issue(userId, 'MFA_VERIFY');
  await assert.rejects(
    () => service().consume(retry.token, 'MFA_VERIFY', async () => { throw new Error('work failed'); }),
    /work failed/,
  );
  assert.equal((await prisma.authChallenge.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(retry.token) },
  })).consumedAt, null);
});

test('resolves an active challenge without consuming it for multi-step enrollment', async () => {
  const issued = await service().issue(userId, 'MFA_ENROLLMENT');

  assert.equal(await service().getActiveUserId(issued.token, 'MFA_ENROLLMENT'), userId);
  assert.equal(await service().getActiveUserId(issued.token, 'MFA_ENROLLMENT'), userId);
  assert.equal((await prisma.authChallenge.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(issued.token) },
  })).consumedAt, null);
});

test('counts failures atomically and applies a fifteen-minute cooldown after five', async () => {
  const issued = await service().issue(userId, 'MFA_VERIFY');
  for (let attempt = 1; attempt < 5; attempt += 1) {
    await assert.rejects(() => service().fail(issued.token, 'MFA_VERIFY'), hasCode('MFA_INVALID'));
  }
  await assert.rejects(() => service().fail(issued.token, 'MFA_VERIFY'), hasCode('MFA_RATE_LIMITED'));

  const stored = await prisma.authChallenge.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(issued.token) },
  });
  assert.equal(stored.failedAttempts, 5);
  assert.ok(stored.consumedAt);
  await assert.rejects(() => service().issue(userId, 'MFA_VERIFY'), hasCode('MFA_RATE_LIMITED'));

  now = new Date(now.getTime() + 15 * 60 * 1000);
  assert.equal((await service().issue(userId, 'MFA_VERIFY')).expiresIn, 300);
});

test('rejects expired and wrong-type challenge references', async () => {
  const issued = await service().issue(userId, 'MFA_VERIFY');
  await assert.rejects(
    () => service().consume(issued.token, 'MFA_ENROLLMENT', async (): Promise<void> => undefined),
    hasCode('MFA_INVALID'),
  );
  now = new Date(now.getTime() + 300_001);
  await assert.rejects(
    () => service().consume(issued.token, 'MFA_VERIFY', async (): Promise<void> => undefined),
    hasCode('MFA_CHALLENGE_EXPIRED'),
  );
});
