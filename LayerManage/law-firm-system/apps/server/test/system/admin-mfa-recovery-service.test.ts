import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { AdminMfaRecoveryService } from '../../app/application/system/admin-mfa-recovery-service';
import { SessionService } from '../../app/application/auth/session-service';
import { SecurityError } from '../../app/domain/security/security-errors';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { PasswordHasher } from '../../app/domain/security/password-hasher';
import {
  RecoveryWindowUnavailableError,
  ValidationCommandError,
} from '../../app/application/system/system-command-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const now = new Date('2099-01-02T03:04:05.000Z');
const hasher: PasswordHasher = {
  hash: async value => `hash:${value}`,
  compare: async (value, hash) => hash === `hash:${value}`,
};
let prisma: PrismaClient;
let userId: string;
let factorId: string;
let sessionId: string;

function service(auditWriter?: ConstructorParameters<typeof AdminMfaRecoveryService>[4]) {
  return new AdminMfaRecoveryService(
    prisma,
    hasher,
    { databaseName: 'chengye_oa_test', hostname: 'recovery-host' },
    () => new Date(now),
    auditWriter,
  );
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    username: ' Root.Admin ',
    password: 'root-secret',
    confirmation: 'RESET ADMIN MFA chengye_oa_test root.admin',
    ...overrides,
  };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  const role = await prisma.role.create({
    data: { id: 'role:super-admin', code: 'SYSTEM_SUPER_ADMIN', name: 'Super Admin', type: 'SYSTEM' },
  });
  const user = await prisma.user.create({
    data: { username: 'root.admin', password: 'hash:root-secret' },
  });
  userId = user.id;
  await prisma.userRole.create({ data: { userId, roleId: role.id, validFrom: new Date(now.getTime() - 1000) } });
  factorId = (await prisma.mfaFactor.create({ data: {
    userId,
    encryptedSecret: 'encrypted-value',
    secretIv: 'iv-value',
    secretAuthTag: 'tag-value',
    verifiedAt: now,
  } })).id;
  await prisma.mfaRecoveryCode.create({ data: { factorId, codeHash: `hash-${randomUUID()}` } });
  sessionId = (await new SessionService(
    prisma,
    new JwtTokenService('01234567890123456789012345678901'),
    undefined,
    () => new Date(now),
  ).create(userId, 'MFA', {})).sessionId;
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('rejects wrong confirmation, password, and ineligible targets without changing MFA', async () => {
  await assert.rejects(
    () => service().execute(input({ confirmation: 'RESET ADMIN MFA other root.admin' }) as never),
    (error: unknown) => error instanceof ValidationCommandError,
  );
  await assert.rejects(
    () => service().execute(input({ password: 'wrong' }) as never),
    (error: unknown) => error instanceof SecurityError && error.code === 'AUTHENTICATION_FAILED',
  );

  await prisma.userRole.deleteMany({ where: { userId } });
  await assert.rejects(
    () => service().execute(input() as never),
    (error: unknown) => error instanceof RecoveryWindowUnavailableError,
  );
  assert.equal((await prisma.mfaFactor.findUniqueOrThrow({ where: { id: factorId } })).disabledAt, null);
});

test('resets the sole effective super-admin and writes only redacted recovery audit evidence', async () => {
  const result = await service().execute(input() as never);
  assert.deepEqual(result, { username: 'root.admin' });
  assert.ok((await prisma.mfaFactor.findUniqueOrThrow({ where: { id: factorId } })).disabledAt);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { factorId, usedAt: { not: null } } }), 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credentialVersion, 2);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt);
  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { action: 'ADMIN_MFA_RESET_RECOVERY', targetId: userId },
  });
  assert.doesNotMatch(JSON.stringify(audit), /root-secret|encrypted-value|RESET ADMIN MFA/i);
});

test('rolls back the entire reset when mandatory audit writing fails', async () => {
  await assert.rejects(
    () => service(async () => { throw new Error('audit unavailable'); }).execute(input() as never),
    /audit unavailable/,
  );
  assert.equal((await prisma.mfaFactor.findUniqueOrThrow({ where: { id: factorId } })).disabledAt, null);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credentialVersion, 1);
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt, null);
});
