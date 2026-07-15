import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { BcryptPasswordHasher, PasswordHasher } from '../../app/domain/security/password-hasher';
import { SecurityError } from '../../app/domain/security/security-errors';
import { assertEmptyApplicationTables } from '../../scripts/db/assert-empty-application-tables';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import {
  InconsistentSystemStateError,
  RecoveryDisabledError,
  ValidationCommandError,
} from '../../app/application/system/system-command-errors';
import { SystemBootstrapService } from '../../app/application/system/system-bootstrap-service';
import { SuperAdminRecoveryService } from '../../app/application/system/super-admin-recovery-service';

const bootstrapInput = {
  organizationName: 'Chengye Law Firm',
  username: 'root.admin',
  password: 'Correct-Horse-92',
};

const metadata = {
  databaseName: 'chengye_oa_test',
  hostname: 'localhost',
};

const recoveryInput = {
  enabled: true,
  username: 'root.admin',
  temporaryPassword: 'Different-Horse-93',
  reason: 'Offline recovery after credential loss.',
};

class CountingPasswordHasher implements PasswordHasher {
  readonly hashed: string[] = [];
  readonly compared: Array<{ value: string; hash: string }> = [];

  async hash(value: string): Promise<string> {
    this.hashed.push(value);
    return `hash:${value}`;
  }

  async compare(value: string, hash: string): Promise<boolean> {
    this.compared.push({ value, hash });
    return value === 'Correct-Horse-92';
  }
}

function createBootstrapService(prisma: PrismaClient): SystemBootstrapService {
  return new SystemBootstrapService(prisma, new BcryptPasswordHasher(4), metadata);
}

function createRecoveryService(
  prisma: PrismaClient,
  hasher: PasswordHasher = new BcryptPasswordHasher(4),
  auditWriter?: ConstructorParameters<typeof SuperAdminRecoveryService>[3],
): SuperAdminRecoveryService {
  return new SuperAdminRecoveryService(prisma, hasher, metadata, auditWriter);
}

async function bootstrap(prisma: PrismaClient): Promise<void> {
  await createBootstrapService(prisma).execute(bootstrapInput);
}

test.beforeEach(async () => {
  const prisma = createTestPrisma();
  try {
    await clearTestApplicationData(prisma);
  } finally {
    await prisma.$disconnect();
  }
});

test.after(async () => {
  let prisma: PrismaClient | undefined;
  try {
    prisma = createTestPrisma();
    await clearTestApplicationData(prisma);
  } finally {
    await prisma?.$disconnect();
  }
});

test('rejects recovery before any mutation when the explicit gate is disabled', async () => {
  const prisma = createTestPrisma();
  try {
    await bootstrap(prisma);
    const before = await prisma.user.findUniqueOrThrow({ where: { username: bootstrapInput.username } });

    await assert.rejects(
      () => createRecoveryService(prisma).execute({ ...recoveryInput, enabled: false }),
      RecoveryDisabledError,
    );

    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    assert.deepEqual(after, before);
    assert.equal(await prisma.operationLog.count({ where: { action: 'SUPER_ADMIN_RECOVERY' } }), 0);
  } finally {
    await prisma.$disconnect();
  }
});

test('rejects recovery when system initialization is absent', async () => {
  const prisma = createTestPrisma();
  try {
    await assert.rejects(() => createRecoveryService(prisma).execute(recoveryInput), InconsistentSystemStateError);
    await assertEmptyApplicationTables(prisma);
  } finally {
    await prisma.$disconnect();
  }
});

test('rejects a username other than the initialized super-admin without writing', async () => {
  const prisma = createTestPrisma();
  try {
    await bootstrap(prisma);
    const before = await prisma.user.findUniqueOrThrow({ where: { username: bootstrapInput.username } });

    await assert.rejects(
      () => createRecoveryService(prisma).execute({ ...recoveryInput, username: 'other.admin' }),
      ValidationCommandError,
    );

    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: before.id } }), before);
    assert.equal(await prisma.operationLog.count({ where: { action: 'SUPER_ADMIN_RECOVERY' } }), 0);
  } finally {
    await prisma.$disconnect();
  }
});

test('normalizes the recovery username before matching the protected user', async () => {
  const prisma = createTestPrisma();
  try {
    await bootstrap(prisma);

    const result = await createRecoveryService(prisma).execute({ ...recoveryInput, username: '  Root.Admin  ' });

    assert.equal(result.username, 'root.admin');
  } finally {
    await prisma.$disconnect();
  }
});

test('rejects recovery when the protected user no longer holds SYSTEM_SUPER_ADMIN', async () => {
  const prisma = createTestPrisma();
  try {
    await bootstrap(prisma);
    const user = await prisma.user.findUniqueOrThrow({ where: { username: bootstrapInput.username } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });

    await assert.rejects(() => createRecoveryService(prisma).execute(recoveryInput), InconsistentSystemStateError);

    assert.equal(await prisma.operationLog.count({ where: { action: 'SUPER_ADMIN_RECOVERY' } }), 0);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).password, user.password);
  } finally {
    await prisma.$disconnect();
  }
});

test('rejects reasons shorter than 10 or longer than 500 trimmed characters', async () => {
  const prisma = createTestPrisma();
  try {
    await bootstrap(prisma);
    const service = createRecoveryService(prisma);

    for (const reason of ['x'.repeat(9), 'x'.repeat(501)]) {
      await assert.rejects(() => service.execute({ ...recoveryInput, reason }), ValidationCommandError);
    }

    assert.equal(await prisma.operationLog.count({ where: { action: 'SUPER_ADMIN_RECOVERY' } }), 0);
  } finally {
    await prisma.$disconnect();
  }
});

test('accepts recovery reasons at both binding length limits after trimming', async () => {
  const prisma = createTestPrisma();
  try {
    await bootstrap(prisma);
    const service = createRecoveryService(prisma);

    await service.execute({ ...recoveryInput, reason: `  ${'a'.repeat(10)}  ` });
    await service.execute({ ...recoveryInput, temporaryPassword: 'Another-Horse-94', reason: 'b'.repeat(500) });

    assert.equal(await prisma.operationLog.count({ where: { action: 'SUPER_ADMIN_RECOVERY' } }), 2);
  } finally {
    await prisma.$disconnect();
  }
});

test('rejects a temporary password reused from the protected user', async () => {
  const prisma = createTestPrisma();
  try {
    await bootstrap(prisma);
    const hasher = new CountingPasswordHasher();

    await assert.rejects(
      () => createRecoveryService(prisma, hasher).execute({ ...recoveryInput, temporaryPassword: bootstrapInput.password }),
      (error: unknown) => error instanceof SecurityError && error.code === 'PASSWORD_REUSED',
    );

    assert.deepEqual(hasher.hashed, []);
    assert.equal(hasher.compared.length, 1);
    assert.equal(await prisma.operationLog.count({ where: { action: 'SUPER_ADMIN_RECOVERY' } }), 0);
  } finally {
    await prisma.$disconnect();
  }
});

test('recovers only the initialized super-admin, invalidates sessions, and records safe audit metadata', async () => {
  const prisma = createTestPrisma();
  try {
    await bootstrap(prisma);
    const before = await prisma.user.findUniqueOrThrow({ where: { username: bootstrapInput.username } });
    await prisma.user.update({
      where: { id: before.id },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 60_000) },
    });
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    const initialization = await prisma.systemInitialization.findUniqueOrThrow({ where: { id: 'PRIMARY' } });
    const userRoles = await prisma.userRole.findMany({ where: { userId: before.id } });

    const result = await createRecoveryService(prisma).execute(recoveryInput);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    const audit = await prisma.operationLog.findFirstOrThrow({ where: { action: 'SUPER_ADMIN_RECOVERY' } });
    const auditMetadata = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
    assert.equal(result.username, bootstrapInput.username);
    assert.equal(after.mustChangePassword, true);
    assert.equal(after.credentialVersion, locked.credentialVersion + 1);
    assert.equal(after.failedLoginCount, 0);
    assert.equal(after.lockedUntil, null);
    assert.ok(after.passwordChangedAt);
    assert.equal(after.employeeId, locked.employeeId);
    assert.equal(await new BcryptPasswordHasher(4).compare(recoveryInput.temporaryPassword, after.password), true);
    assert.equal(await new BcryptPasswordHasher(4).compare(bootstrapInput.password, after.password), false);
    assert.deepEqual(await prisma.userRole.findMany({ where: { userId: before.id } }), userRoles);
    assert.deepEqual(await prisma.systemInitialization.findUniqueOrThrow({ where: { id: 'PRIMARY' } }), initialization);
    assert.deepEqual(auditMetadata, {
      targetUserId: before.id,
      reason: recoveryInput.reason,
      hostname: metadata.hostname,
      result: 'SUCCESS',
    });
    assert.equal(audit.userId, null);
    assert.equal(audit.targetType, 'USER');
    assert.equal(audit.targetId, before.id);
    assert.equal(JSON.stringify(auditMetadata).includes(recoveryInput.temporaryPassword), false);
    assert.equal(JSON.stringify(auditMetadata).includes(after.password), false);
  } finally {
    await prisma.$disconnect();
  }
});

test('rolls back the credential update when recovery audit writing fails', async () => {
  const prisma = createTestPrisma();
  try {
    await bootstrap(prisma);
    const before = await prisma.user.findUniqueOrThrow({ where: { username: bootstrapInput.username } });
    const auditFailure = async (): Promise<void> => {
      throw new Error('injected recovery audit failure');
    };

    await assert.rejects(
      () => createRecoveryService(prisma, new BcryptPasswordHasher(4), auditFailure).execute(recoveryInput),
      /injected recovery audit failure/,
    );

    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: before.id } }), before);
    assert.equal(await prisma.operationLog.count({ where: { action: 'SUPER_ADMIN_RECOVERY' } }), 0);
  } finally {
    await prisma.$disconnect();
  }
});
