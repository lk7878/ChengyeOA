import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { PasswordHasher } from '../../app/domain/security/password-hasher';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { assertEmptyApplicationTables } from '../../scripts/db/assert-empty-application-tables';
import { assertTestDatabaseUrl, clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import {
  AlreadyInitializedError,
  InconsistentSystemStateError,
  ValidationCommandError,
} from '../../app/application/system/system-command-errors';
import { SystemBootstrapService } from '../../app/application/system/system-bootstrap-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { EVENT_SUBSCRIPTION_CATALOG } from '../../app/domain/events/event-subscription-catalog';

const input = {
  organizationName: '承业律师事务所',
  username: 'root.admin',
  password: 'Correct-Horse-92',
};

const metadata = {
  databaseName: 'chengye_oa_test',
  hostname: 'localhost',
};

class CountingPasswordHasher implements PasswordHasher {
  readonly values: string[] = [];

  async hash(value: string): Promise<string> {
    this.values.push(value);
    return 'counting-hash';
  }

  async compare(): Promise<boolean> {
    return false;
  }
}

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

test.after(async () => {
  let prisma: PrismaClient | undefined;
  try {
    prisma = createTestPrisma();
    await clearTestApplicationData(prisma);
  } finally {
    await prisma?.$disconnect();
  }
});

test('creates both reserved system roles and grants only the super-admin trust root', async () => {
  const prisma = createTestPrisma();
  try {
    await createService(prisma).execute(input);

    assert.equal(await prisma.organization.count(), 1);
    assert.equal(await prisma.role.count(), 7);
    assert.equal(await prisma.role.count({ where: { code: 'SYSTEM_SUPER_ADMIN' } }), 1);
    assert.equal(await prisma.role.count({ where: { code: 'SYSTEM_ADMIN' } }), 1);
    assert.equal(await prisma.role.count({ where: { code: 'HR' } }), 1);
    assert.equal(await prisma.role.count({ where: { code: 'SEAL_ADMIN' } }), 1);
    assert.equal(await prisma.role.count({ where: { code: 'FINANCE' } }), 1);
    assert.equal(await prisma.role.count({ where: { code: 'PARTNER' } }), 1);
    assert.equal(await prisma.role.count({ where: { code: 'MANAGER' } }), 1);
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.user.count({ where: { employeeId: null, mustChangePassword: true } }), 1);
    assert.equal(await prisma.userRole.count(), 1);
    assert.equal(await prisma.systemInitialization.count({ where: { id: 'PRIMARY' } }), 1);
    assert.equal(await prisma.operationLog.count(), 1);
    assert.equal(await prisma.operationLog.count({ where: { action: 'SYSTEM_BOOTSTRAP' } }), 1);
    assert.equal(await prisma.employee.count(), 0);
    assert.equal(await prisma.permission.count(), PERMISSION_CATALOG.length);
    assert.equal(await prisma.position.count(), 0);
    assert.equal(await prisma.rolePermission.count(), 10);

    const [organization, role, systemAdminRole, user, userRole, initialization, audit] = await Promise.all([
      prisma.organization.findFirstOrThrow(),
      prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_SUPER_ADMIN' } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_ADMIN' } }),
      prisma.user.findUniqueOrThrow({ where: { username: 'root.admin' } }),
      prisma.userRole.findFirstOrThrow(),
      prisma.systemInitialization.findUniqueOrThrow({ where: { id: 'PRIMARY' } }),
      prisma.operationLog.findFirstOrThrow({ where: { action: 'SYSTEM_BOOTSTRAP' } }),
    ]);

    assert.deepEqual(
      { name: organization.name, type: organization.type, parentId: organization.parentId, status: organization.status },
      { name: input.organizationName, type: 'FIRM', parentId: null, status: 'ENABLED' },
    );
    const expandedOrganization = organization as unknown as Record<string, unknown>;
    assert.equal(expandedOrganization.code, 'ROOT');
    assert.equal(expandedOrganization.path, `/${organization.id}`);
    assert.equal(expandedOrganization.level, 0);
    assert.equal(expandedOrganization.version, 1);
    assert.deepEqual(
      { name: role.name, type: role.type, status: role.status },
      { name: '系统超级管理员', type: 'SYSTEM', status: 'ENABLED' },
    );
    assert.deepEqual(
      { id: systemAdminRole.id, name: systemAdminRole.name, type: systemAdminRole.type, status: systemAdminRole.status },
      { id: 'role:system-admin', name: '系统管理员', type: 'SYSTEM', status: 'ENABLED' },
    );
    assert.deepEqual(
      {
        status: user.status,
        employeeId: user.employeeId,
        mustChangePassword: user.mustChangePassword,
        credentialVersion: user.credentialVersion,
        passwordChangedAt: user.passwordChangedAt,
        failedLoginCount: user.failedLoginCount,
        lockedUntil: user.lockedUntil,
      },
      {
        status: 'ENABLED',
        employeeId: null,
        mustChangePassword: true,
        credentialVersion: 1,
        passwordChangedAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    );
    assert.deepEqual({ userId: userRole.userId, roleId: userRole.roleId }, { userId: user.id, roleId: role.id });
    assert.equal(await prisma.userRole.count({ where: { roleId: systemAdminRole.id } }), 0);
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

test('provisions five BUSINESS roles with approval reviewer permissions idempotently', async () => {
  const prisma = createTestPrisma();
  try {
    const service = createService(prisma);
    await service.execute(input);

    const roles = await prisma.role.findMany({ orderBy: { code: 'asc' } });
    assert.equal(roles.length, 7);
    assert.deepEqual(
      roles.map(role => role.code),
      ['FINANCE', 'HR', 'MANAGER', 'PARTNER', 'SEAL_ADMIN', 'SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN'],
    );

    const businessRoles = roles.filter(role => role.type === 'BUSINESS');
    assert.deepEqual(
      businessRoles.map(role => ({ code: role.code, type: role.type, status: role.status })),
      [
        { code: 'FINANCE', type: 'BUSINESS', status: 'ENABLED' },
        { code: 'HR', type: 'BUSINESS', status: 'ENABLED' },
        { code: 'MANAGER', type: 'BUSINESS', status: 'ENABLED' },
        { code: 'PARTNER', type: 'BUSINESS', status: 'ENABLED' },
        { code: 'SEAL_ADMIN', type: 'BUSINESS', status: 'ENABLED' },
      ],
    );

    const hrRole = await prisma.role.findUniqueOrThrow({ where: { code: 'HR' } });
    const hrPermissionCodes = (
      await prisma.rolePermission.findMany({
        where: { roleId: hrRole.id },
        select: { permission: { select: { code: true } } },
      })
    ).map(row => row.permission.code).sort();
    assert.deepEqual(hrPermissionCodes, ['approval.process', 'approval.read']);

    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'MANAGER' } });
    const managerPermissionCodes = (
      await prisma.rolePermission.findMany({
        where: { roleId: managerRole.id },
        select: { permission: { select: { code: true } } },
      })
    ).map(row => row.permission.code).sort();
    assert.deepEqual(managerPermissionCodes, ['approval.process', 'approval.read']);
    assert.equal(await prisma.rolePermission.count(), 10);

    await assert.rejects(() => service.execute(input), AlreadyInitializedError);
    assert.equal(await prisma.role.count(), 7);
    assert.equal(await prisma.rolePermission.count(), 10);
  } finally {
    await prisma.$disconnect();
  }
});

test('CONTRACT_CHANGE definition provisions the two-node MANAGER→PARTNER chain while preserving approverRule', async () => {
  assertTestDatabaseUrl();
  const prisma = createTestPrisma();
  try {
    const provisionPath = path.resolve('prisma/migrations/20260802110000_approval_multilevel_provision/migration.sql');
    assert.ok(fs.existsSync(provisionPath), `migration ${path.basename(path.dirname(provisionPath))} must exist`);

    // Ensure the CONTRACT_CHANGE row exists (migrations apply on reset; idempotent otherwise).
    await prisma.approvalDefinition.upsert({
      where: { code: 'CONTRACT_CHANGE' },
      create: {
        id: randomUUID(),
        code: 'CONTRACT_CHANGE',
        name: '合同变更',
        businessType: 'CONTRACT_CHANGE',
        formSchema: {
          fields: [
            { key: 'contractId', label: '合同', type: 'text', required: true },
            { key: 'changeSummary', label: '变更摘要', type: 'textarea', required: true },
          ],
        },
        approverRule: { type: 'ROLE', roleCodes: ['PARTNER'] } as Prisma.InputJsonValue,
        version: 1,
        status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000000',
      },
      update: {},
    });

    // Execute the SPEC-016 provisioning migration's UPDATE idempotently.
    const provisionSql = fs.readFileSync(provisionPath, 'utf8').replace(/--.*$/gm, '').trim();
    await prisma.$executeRawUnsafe(provisionSql);

    const row = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'CONTRACT_CHANGE' } });
    assert.deepEqual(row.nodeSchema, [
      { name: '主管初审', approverRule: { type: 'ROLE', roleCodes: ['MANAGER'] } },
      { name: '合伙人终审', approverRule: { type: 'ROLE', roleCodes: ['PARTNER'] } },
    ]);
    assert.deepEqual(row.approverRule, { type: 'ROLE', roleCodes: ['PARTNER'] });
  } finally {
    await prisma.$disconnect();
  }
});

test('accepts the exact migration-owned permission catalog as clean system metadata', async () => {
  const prisma = createTestPrisma();
  try {
    await createService(prisma).execute(input);

    assert.equal(await prisma.permission.count(), PERMISSION_CATALOG.length);
    assert.equal(await prisma.rolePermission.count(), 10);
    assert.equal(await prisma.dataScope.count(), 0);
    assert.equal(await prisma.userPermissionGrant.count(), 0);
    assert.equal(await prisma.systemInitialization.count(), 1);
  } finally {
    await prisma.$disconnect();
  }
});

test('bootstraps a permission catalog that contains underscore codes in PG C collation order', async () => {
  // SPEC-022: PERMISSION_CATALOG includes underscore codes (menu.organization_personnel,
  // employee.account_binding.manage, user_role.membership.manage, ...). clearTestApplicationData
  // seeds every catalog row and assertPermissionCatalog reads them back via ORDER BY code
  // (PG C collation byte order). The old localeCompare sort placed user_role.membership.manage
  // before every user.* code, diverging from the DB and raising InconsistentSystemStateError;
  // compareByCodeC aligns both sides.
  assert.ok(PERMISSION_CATALOG.some(item => item.code.includes('_')), 'catalog must contain underscore codes');

  const prisma = createTestPrisma();
  try {
    await createService(prisma).execute(input);

    assert.equal(await prisma.systemInitialization.count(), 1);
    assert.equal(await prisma.permission.count(), PERMISSION_CATALOG.length);
    const dbCodes = (await prisma.permission.findMany({ orderBy: { code: 'asc' }, select: { code: true } }))
      .map(row => row.code);
    for (const underscoreCode of ['menu.organization_personnel', 'employee.account_binding.manage', 'user_role.membership.manage']) {
      assert.ok(dbCodes.includes(underscoreCode), `expected underscore code ${underscoreCode} to be provisioned`);
    }
  } finally {
    await prisma.$disconnect();
  }
});

test('bootstraps with the migration-owned event subscription catalog in PG C collation order', async () => {
  // SPEC-022: EVENT_SUBSCRIPTION_CATALOG codes are hyphen-based (no underscores today), so
  // assertEventSubscriptionCatalog must compare DB rows (ORDER BY code, PG C collation) against
  // the catalog sorted with compareByCodeC without raising InconsistentSystemStateError.
  const prisma = createTestPrisma();
  try {
    await createService(prisma).execute(input);

    assert.equal(await prisma.systemInitialization.count(), 1);
    assert.equal(await prisma.eventSubscription.count(), EVENT_SUBSCRIPTION_CATALOG.length);
    const dbCodes = (await prisma.eventSubscription.findMany({ orderBy: { code: 'asc' }, select: { code: true } }))
      .map(row => row.code);
    assert.deepEqual(dbCodes, [
      'admin-operation-reviewed-notification-v1',
      'event-dispatch-quarantine-v1',
      'lead-first-response-monitor-v1',
    ]);
  } finally {
    await prisma.$disconnect();
  }
});

test('keeps no-underscore catalog codes consistent (zero regression)', async () => {
  // SPEC-022 D4: codes without underscores sort identically under localeCompare and
  // compareByCodeC (pure byte order), so the fix must not change their relative order.
  // The approval.* segment is a concrete no-underscore set provisioned in ascending byte order,
  // and the HR reviewer grant keeps its stable no-underscore permission pair.
  const prisma = createTestPrisma();
  try {
    await createService(prisma).execute(input);

    const approvalCodes = (await prisma.permission.findMany({
      where: { code: { startsWith: 'approval.' } },
      orderBy: { code: 'asc' },
      select: { code: true },
    })).map(row => row.code);
    assert.deepEqual(approvalCodes, ['approval.apply', 'approval.manage', 'approval.process', 'approval.read']);

    const hrRole = await prisma.role.findUniqueOrThrow({ where: { code: 'HR' } });
    const hrPermissionCodes = (
      await prisma.rolePermission.findMany({
        where: { roleId: hrRole.id },
        select: { permission: { select: { code: true } } },
      })
    ).map(row => row.permission.code).sort();
    assert.deepEqual(hrPermissionCodes, ['approval.process', 'approval.read']);
  } finally {
    await prisma.$disconnect();
  }
});

test('test reset restores the pilot subscription with SQL NULL filterJson', async () => {
  const prisma = createTestPrisma();
  try {
    await clearTestApplicationData(prisma);
    const rows = await prisma.$queryRaw<Array<{ filter_is_null: boolean }>>`
      SELECT "filterJson" IS NULL AS filter_is_null
      FROM "event_subscription"
      WHERE "code" = 'admin-operation-reviewed-notification-v1'
    `;
    assert.deepEqual(rows, [{ filter_is_null: true }]);
    assert.equal(await prisma.eventSubscription.count({
      where: {
        code: 'admin-operation-reviewed-notification-v1',
        filterJson: { equals: Prisma.DbNull },
      },
    }), 1);
  } finally {
    await prisma.$disconnect();
  }
});

test('accepts the exact migration-owned pilot subscription before bootstrap', async () => {
  const prisma = createTestPrisma();
  try {
    await prisma.eventSubscription.upsert({
      where: { code: 'admin-operation-reviewed-notification-v1' },
      create: {
        id: 'subscription:admin-operation-reviewed-notification-v1',
        code: 'admin-operation-reviewed-notification-v1',
        eventType: 'admin.operation.reviewed',
        eventVersion: 1,
        handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
        status: 'ENABLED',
        filterJson: Prisma.DbNull,
      },
      update: {
        id: 'subscription:admin-operation-reviewed-notification-v1',
        eventType: 'admin.operation.reviewed',
        eventVersion: 1,
        handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
        status: 'ENABLED',
        filterJson: Prisma.DbNull,
      },
    });

    await createService(prisma).execute(input);
    assert.equal(await prisma.systemInitialization.count(), 1);
    assert.equal(await prisma.eventSubscription.count(), EVENT_SUBSCRIPTION_CATALOG.length);
  } finally {
    await prisma.$disconnect();
  }
});

test('rejects tampered, JSON-null, or additional migration-owned subscriptions before bootstrap', async () => {
  for (const scenario of ['tampered', 'json-null', 'additional'] as const) {
    const prisma = createTestPrisma();
    try {
      await clearTestApplicationData(prisma);
      if (scenario === 'tampered') {
        await prisma.eventSubscription.update({
          where: { code: 'admin-operation-reviewed-notification-v1' },
          data: { handlerCode: 'UNAPPROVED_HANDLER' },
        });
      } else if (scenario === 'json-null') {
        await prisma.eventSubscription.update({
          where: { code: 'admin-operation-reviewed-notification-v1' },
          data: { filterJson: Prisma.JsonNull },
        });
      } else {
        await prisma.eventSubscription.create({
          data: {
            id: 'subscription:unapproved',
            code: 'unapproved',
            eventType: 'admin.operation.reviewed',
            eventVersion: 1,
            handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
            status: 'ENABLED',
            filterJson: Prisma.DbNull,
          },
        });
      }

      await assert.rejects(() => createService(prisma).execute(input), InconsistentSystemStateError);
      assert.equal(await prisma.systemInitialization.count(), 0);
    } finally {
      await prisma.$disconnect();
    }
  }
});

test('validates bootstrap input before hashing or writing application data', async () => {
  const prisma = createTestPrisma();
  try {
    const hasher = new CountingPasswordHasher();
    const service = new SystemBootstrapService(prisma, hasher, metadata);

    await assert.rejects(
      () => service.execute({ ...input, organizationName: 'x' }),
      ValidationCommandError,
    );
    assert.deepEqual(hasher.values, []);
    await assertEmptyApplicationTables(prisma);
  } finally {
    await prisma.$disconnect();
  }
});

test('hashes the original password exactly once and returns the normalized username', async () => {
  const prisma = createTestPrisma();
  try {
    const hasher = new CountingPasswordHasher();
    const service = new SystemBootstrapService(prisma, hasher, metadata);
    const password = 'Correct-Horse-92';

    const result = await service.execute({
      organizationName: input.organizationName,
      username: '  Root.Admin  ',
      password,
    });

    assert.deepEqual(hasher.values, [password]);
    assert.equal(result.username, 'root.admin');
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
    assert.equal(await prisma.role.count(), 7);
    assert.equal(await prisma.rolePermission.count(), 10);
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
    const dirtyOrganizationId = '00000000-0000-4000-8000-000000000003';
    const dirtyOrganization = await prisma.organization.create({
      data: {
        id: dirtyOrganizationId,
        code: 'DIRTY_ROOT',
        name: 'Existing firm',
        type: 'FIRM',
        path: `/${dirtyOrganizationId}`,
      },
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
