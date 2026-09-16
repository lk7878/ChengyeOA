import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { PERMISSION_CODES } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const evaluatedAt = new Date('2026-07-18T12:00:00.000Z');
let prisma: PrismaClient;

test.before(async () => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

async function createUser(status = 'ENABLED'): Promise<string> {
  const suffix = randomUUID();
  return prisma.user.create({
    data: { username: `authz.${suffix}`, password: 'unused', status },
    select: { id: true },
  }).then(user => user.id);
}

async function grantRole(input: {
  userId: string;
  code: string;
  roleStatus?: string;
  permissionCodes: string[];
  validFrom?: Date;
  validUntil?: Date | null;
  revokedAt?: Date | null;
}): Promise<string> {
  const existingRole = await prisma.role.findUnique({ where: { code: input.code } });
  const role = existingRole
    ? await prisma.role.update({
      where: { id: existingRole.id },
      data: { status: input.roleStatus ?? existingRole.status },
    })
    : await prisma.role.create({
      data: {
        code: input.code,
        name: input.code,
        type: ['SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN'].includes(input.code) ? 'SYSTEM' : 'BUSINESS',
        status: input.roleStatus ?? 'ENABLED',
        permissions: {
          create: input.permissionCodes.map(code => ({ permission: { connect: { code } } })),
        },
      },
    });
  const scope = await prisma.dataScope.create({ data: { name: `${input.code} scope`, scopeType: 'ALL' } });
  if (input.permissionCodes.length > 0) {
    await prisma.roleDataScope.create({ data: { roleId: role.id, resource: 'organization', dataScopeId: scope.id } });
  }
  await prisma.userRole.create({
    data: {
      userId: input.userId,
      roleId: role.id,
      source: input.validUntil ? 'TEMPORARY' : 'PERMANENT',
      validFrom: input.validFrom ?? new Date('2026-07-01T00:00:00.000Z'),
      validUntil: input.validUntil,
      reason: input.validUntil ? '测试限时角色授权原因' : null,
      revokedAt: input.revokedAt,
      revokedByUserId: input.revokedAt ? input.userId : null,
      revokeReason: input.revokedAt ? '测试撤销角色授权原因' : null,
    },
  });
  return role.id;
}

test('loads active role and special grants once with deduplicated permission codes', async () => {
  const userId = await createUser();
  await grantRole({ userId, code: 'BRANCH_MANAGER', permissionCodes: ['organization.read'] });
  await grantRole({ userId, code: 'SECOND_MANAGER', permissionCodes: ['organization.read'] });
  await grantRole({ userId, code: 'DISABLED_ROLE', roleStatus: 'DISABLED', permissionCodes: ['employee.read'] });
  const specialScope = await prisma.dataScope.create({ data: { name: 'Sensitive employee scope', scopeType: 'ALL' } });
  await prisma.userPermissionGrant.create({
    data: {
      userId,
      permissionId: 'permission:employee.sensitive.read',
      dataScopeId: specialScope.id,
      validFrom: new Date('2026-07-18T00:00:00.000Z'),
      validUntil: new Date('2026-07-19T00:00:00.000Z'),
      reason: '测试专项敏感权限授权原因',
      grantedByUserId: userId,
    },
  });

  const context = await new AuthorizationContextLoader(prisma).load(userId, evaluatedAt);

  assert.equal(context.userId, userId);
  assert.equal(context.employeeId, null);
  assert.equal(context.isSystemSuperAdmin, false);
  assert.equal(context.isSystemAdmin, false);
  assert.deepEqual(context.permissionCodes, ['employee.sensitive.read', 'organization.read']);
  assert.equal(context.grants.filter(grant => grant.permissionCode === 'organization.read').length, 2);
  assert.equal(context.grants.filter(grant => grant.sourceType === 'SPECIAL_GRANT').length, 1);
  assert.equal(context.grants.some(grant => grant.permissionCode === 'employee.read'), false);
});

test('excludes not-started expired and revoked grants at the injected evaluation time', async () => {
  const userId = await createUser();
  await grantRole({
    userId,
    code: 'NOT_STARTED',
    permissionCodes: ['organization.read'],
    validFrom: new Date('2026-07-19T00:00:00.000Z'),
    validUntil: new Date('2026-07-20T00:00:00.000Z'),
  });
  await grantRole({
    userId,
    code: 'EXPIRED',
    permissionCodes: ['position.read'],
    validUntil: new Date('2026-07-18T12:00:00.000Z'),
  });
  await grantRole({
    userId,
    code: 'REVOKED',
    permissionCodes: ['employee.read'],
    revokedAt: new Date('2026-07-18T11:00:00.000Z'),
  });

  const context = await new AuthorizationContextLoader(prisma).load(userId, evaluatedAt);
  assert.deepEqual(context.permissionCodes, []);
  assert.deepEqual(context.grants, []);
});

test('rejects disabled accounts with a stable authentication error', async () => {
  const userId = await createUser('DISABLED');
  await grantRole({ userId, code: 'SYSTEM_ADMIN', permissionCodes: [] });
  await assert.rejects(
    () => new AuthorizationContextLoader(prisma).load(userId, evaluatedAt),
    error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'AUTHENTICATION_REQUIRED'),
  );
});

test('gives an active system super-admin every registered permission and implicit ALL scope', async () => {
  const userId = await createUser();
  await grantRole({ userId, code: 'SYSTEM_SUPER_ADMIN', permissionCodes: [] });

  const context = await new AuthorizationContextLoader(prisma).load(userId, evaluatedAt);
  assert.equal(context.isSystemSuperAdmin, true);
  assert.equal(context.isSystemAdmin, false);
  assert.deepEqual(context.permissionCodes, [...PERMISSION_CODES].sort());
  assert.equal(context.grants.length, PERMISSION_CODES.length);
  assert.ok(context.grants.every(grant => grant.sourceType === 'SYSTEM_SUPER_ADMIN'));
  assert.ok(context.grants.every(grant => grant.scopeIds.length === 1 && grant.scopeIds[0] === 'ALL'));
});

test('synthesizes only the SYSTEM_ADMIN allowlist with ALL scope and assignment expiry', async () => {
  const userId = await createUser();
  const validUntil = new Date('2026-07-19T00:00:00.000Z');
  await grantRole({
    userId,
    code: 'SYSTEM_ADMIN',
    permissionCodes: ['governance.review'],
    validUntil,
  });
  await grantRole({ userId, code: 'BUSINESS_READER', permissionCodes: ['employee.read'] });

  const context = await new AuthorizationContextLoader(prisma).load(userId, evaluatedAt);

  assert.equal(context.isSystemSuperAdmin, false);
  assert.equal(context.isSystemAdmin, true);
  const systemGrants = context.grants.filter(grant => grant.sourceType === 'SYSTEM_ADMIN');
  assert.equal(systemGrants.length, 15);
  assert.ok(systemGrants.every(grant => grant.scopeIds.length === 1 && grant.scopeIds[0] === 'ALL'));
  assert.ok(systemGrants.every(grant => grant.validUntil?.getTime() === validUntil.getTime()));
  assert.equal(context.permissionCodes.includes('governance.review'), false);
  assert.equal(context.permissionCodes.includes('governance.retry'), false);
  assert.equal(context.permissionCodes.includes('governance.operation.read_all'), false);
  assert.equal(context.permissionCodes.includes('menu.event_operations'), true);
  assert.equal(context.permissionCodes.includes('event.delivery.read'), true);
  assert.equal(context.permissionCodes.includes('event.delivery.retry'), false);
  assert.equal(context.permissionCodes.includes('employee.read'), true);
  assert.equal(context.grants.some(grant => grant.permissionCode === 'employee.read' && grant.sourceType === 'ROLE'), true);
});

test('excludes inactive SYSTEM_ADMIN assignments and disabled system roles', async () => {
  const scenarios = [
    {
      code: 'SYSTEM_ADMIN_FUTURE',
      roleCode: 'SYSTEM_ADMIN',
      validFrom: new Date('2026-07-19T00:00:00.000Z'),
      validUntil: new Date('2026-07-20T00:00:00.000Z'),
    },
    {
      code: 'SYSTEM_ADMIN_EXPIRED',
      roleCode: 'SYSTEM_ADMIN',
      validUntil: new Date('2026-07-18T12:00:00.000Z'),
    },
    {
      code: 'SYSTEM_ADMIN_REVOKED',
      roleCode: 'SYSTEM_ADMIN',
      revokedAt: new Date('2026-07-18T11:00:00.000Z'),
    },
    {
      code: 'SYSTEM_ADMIN_DISABLED_ROLE',
      roleCode: 'SYSTEM_ADMIN',
      roleStatus: 'DISABLED',
    },
  ] as const;

  for (const scenario of scenarios) {
    const userId = await createUser();
    await grantRole({
      userId,
      code: scenario.roleCode,
      permissionCodes: [],
      roleStatus: 'roleStatus' in scenario ? scenario.roleStatus : undefined,
      validFrom: 'validFrom' in scenario ? scenario.validFrom : undefined,
      validUntil: 'validUntil' in scenario ? scenario.validUntil : undefined,
      revokedAt: 'revokedAt' in scenario ? scenario.revokedAt : undefined,
    });
    const context = await new AuthorizationContextLoader(prisma).load(userId, evaluatedAt);
    assert.equal(context.isSystemAdmin, false, scenario.code);
    assert.equal(context.grants.some(grant => grant.sourceType === 'SYSTEM_ADMIN'), false, scenario.code);
  }
});

test('keeps super-admin precedence when both reserved system roles are active', async () => {
  const userId = await createUser();
  await grantRole({ userId, code: 'SYSTEM_ADMIN', permissionCodes: [] });
  await grantRole({ userId, code: 'SYSTEM_SUPER_ADMIN', permissionCodes: [] });

  const context = await new AuthorizationContextLoader(prisma).load(userId, evaluatedAt);

  assert.equal(context.isSystemSuperAdmin, true);
  assert.equal(context.isSystemAdmin, false);
  assert.deepEqual(context.permissionCodes, [...PERMISSION_CODES].sort());
  assert.ok(context.grants.every(grant => grant.sourceType === 'SYSTEM_SUPER_ADMIN'));
});
