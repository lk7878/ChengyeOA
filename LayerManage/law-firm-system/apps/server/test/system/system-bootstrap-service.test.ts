import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { assertEmptyApplicationTables } from '../../scripts/db/assert-empty-application-tables';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { AlreadyInitializedError, InconsistentSystemStateError } from '../../app/application/system/system-command-errors';
import { SystemBootstrapService } from '../../app/application/system/system-bootstrap-service';

const input = {
  organizationName: '承业律师事务所',
  username: 'root.admin',
  password: 'Correct-Horse-92',
};

const metadata = {
  databaseName: 'chengye_oa_test',
  hostname: 'localhost',
};

function createService(prisma: PrismaClient, auditWriter?: ConstructorParameters<typeof SystemBootstrapService>[3]) {
  return new SystemBootstrapService(prisma, new BcryptPasswordHasher(4), metadata, auditWriter);
}

test.beforeEach(async () => {
  const prisma = createTestPrisma();
  try {
    await clearTestApplicationData(prisma);
  } finally {
    await prisma.$disconnect();
  }
});

test('creates exactly one atomic trust root without employee or permissions', async () => {
  const prisma = createTestPrisma();
  try {
    await createService(prisma).execute(input);

    assert.equal(await prisma.organization.count(), 1);
    assert.equal(await prisma.role.count({ where: { code: 'SYSTEM_SUPER_ADMIN' } }), 1);
    assert.equal(await prisma.user.count({ where: { employeeId: null, mustChangePassword: true } }), 1);
    assert.equal(await prisma.userRole.count(), 1);
    assert.equal(await prisma.systemInitialization.count({ where: { id: 'PRIMARY' } }), 1);
    assert.equal(await prisma.operationLog.count({ where: { action: 'SYSTEM_BOOTSTRAP' } }), 1);
    assert.equal(await prisma.employee.count(), 0);
    assert.equal(await prisma.permission.count(), 0);
    assert.equal(await prisma.position.count(), 0);
    assert.equal(await prisma.rolePermission.count(), 0);

    const [organization, role, user, initialization, audit] = await Promise.all([
      prisma.organization.findFirstOrThrow(),
      prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_SUPER_ADMIN' } }),
      prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } }),
      prisma.systemInitialization.findUniqueOrThrow({ where: { id: 'PRIMARY' } }),
      prisma.operationLog.findFirstOrThrow({ where: { action: 'SYSTEM_BOOTSTRAP' } }),
    ]);

    assert.deepEqual(
      { name: organization.name, type: organization.type, parentId: organization.parentId, status: organization.status },
      { name: input.organizationName, type: 'FIRM', parentId: null, status: 'ENABLED' },
    );
    assert.deepEqual(
      { name: role.name, type: role.type, status: role.status },
      { name: '系统超级管理员', type: 'SYSTEM', status: 'ENABLED' },
    );
    assert.deepEqual(
      { employeeId: user.employeeId, mustChangePassword: user.mustChangePassword, credentialVersion: user.credentialVersion },
      { employeeId: null, mustChangePassword: true, credentialVersion: 1 },
    );
    assert.deepEqual(
      { rootOrganizationId: initialization.rootOrganizationId, superAdminUserId: initialization.superAdminUserId, version: initialization.version },
      { rootOrganizationId: organization.id, superAdminUserId: user.id, version: 1 },
    );

    const auditMetadata = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
    assert.deepEqual(auditMetadata, {
      initializationVersion: 1,
      rootOrganizationId: organization.id,
      superAdminUserId: user.id,
      databaseName: metadata.databaseName,
      hostname: metadata.hostname,
    });
    assert.equal(audit.userId, null);
    assert.equal(audit.targetType, 'SYSTEM_INITIALIZATION');
    assert.equal(audit.targetId, 'PRIMARY');
    assert.equal(JSON.stringify(auditMetadata).includes(input.username), false);
    assert.equal(JSON.stringify(auditMetadata).includes(input.password), false);
    assert.equal(JSON.stringify(auditMetadata).includes(user.password), false);
  } finally {
    await prisma.$disconnect();
  }
});

test('rejects a second bootstrap without writing additional data', async () => {
  const prisma = createTestPrisma();
  try {
    const service = createService(prisma);
    await service.execute(input);

    await assert.rejects(() => service.execute(input), AlreadyInitializedError);
    assert.equal(await prisma.organization.count(), 1);
    assert.equal(await prisma.role.count(), 1);
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.userRole.count(), 1);
    assert.equal(await prisma.systemInitialization.count(), 1);
    assert.equal(await prisma.operationLog.count(), 1);
  } finally {
    await prisma.$disconnect();
  }
});

test('rejects a dirty uninitialized database without changing it', async () => {
  const prisma = createTestPrisma();
  try {
    const dirtyOrganization = await prisma.organization.create({
      data: { name: 'Existing firm', type: 'FIRM' },
    });

    await assert.rejects(() => createService(prisma).execute(input), InconsistentSystemStateError);
    assert.equal(await prisma.organization.count(), 1);
    assert.equal(await prisma.organization.findUniqueOrThrow({ where: { id: dirtyOrganization.id } }).then(value => value.name), 'Existing firm');
    assert.equal(await prisma.systemInitialization.count(), 0);
    assert.equal(await prisma.operationLog.count(), 0);
  } finally {
    await prisma.$disconnect();
  }
});

test('rolls back every application write when audit writing fails', async () => {
  const prisma = createTestPrisma();
  try {
    const auditFailure = async (): Promise<void> => {
      throw new Error('injected audit failure');
    };

    await assert.rejects(() => createService(prisma, auditFailure).execute(input), /injected audit failure/);
    await assertEmptyApplicationTables(prisma);
  } finally {
    await prisma.$disconnect();
  }
});

test('allows exactly one concurrent bootstrap across separate Prisma clients', async () => {
  const firstPrisma = createTestPrisma();
  const secondPrisma = createTestPrisma();
  try {
    const results = await Promise.allSettled([
      createService(firstPrisma).execute(input),
      createService(secondPrisma).execute(input),
    ]);

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof AlreadyInitializedError);
    assert.equal(await firstPrisma.systemInitialization.count({ where: { id: 'PRIMARY' } }), 1);
    assert.equal(await firstPrisma.operationLog.count({ where: { action: 'SYSTEM_BOOTSTRAP' } }), 1);
  } finally {
    await Promise.all([firstPrisma.$disconnect(), secondPrisma.$disconnect()]);
  }
});
