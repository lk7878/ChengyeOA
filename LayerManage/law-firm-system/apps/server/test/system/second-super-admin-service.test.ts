import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { SecondSuperAdminService } from '../../app/application/system/second-super-admin-service';
import { RecoveryWindowUnavailableError, ValidationCommandError } from '../../app/application/system/system-command-errors';
import { PasswordHasher } from '../../app/domain/security/password-hasher';
import { SecurityError } from '../../app/domain/security/security-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const NOW = new Date('2026-07-21T12:00:00.000Z');
const hasher: PasswordHasher = {
  hash: async value => `hash:${value}`,
  compare: async (value, hash) => hash === `hash:${value}`,
};

let prisma: PrismaClient;
let actorId: string;
let targetId: string;

function service() {
  return new SecondSuperAdminService(
    prisma,
    hasher,
    { databaseName: 'chengye_oa_test', hostname: 'test-host' },
    () => new Date(NOW),
  );
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    actorUsername: 'root.admin',
    actorPassword: 'correct-password',
    targetUsername: 'second.admin',
    reason: 'Approved emergency second-seat recovery ticket 42',
    confirmation: 'ADD SECOND SUPER ADMIN chengye_oa_test second.admin',
    ...overrides,
  };
}

async function seedSeatCount(count = 1): Promise<void> {
  const role = await prisma.role.create({ data: {
    id: 'role:super-admin', code: 'SYSTEM_SUPER_ADMIN', name: 'Super Admin', type: 'SYSTEM',
  } });
  const actor = await prisma.user.create({ data: {
    username: 'root.admin', password: 'hash:correct-password', status: 'ENABLED', credentialVersion: 3,
  } });
  actorId = actor.id;
  const target = await prisma.user.create({ data: {
    username: 'second.admin', password: 'hash:target-password', status: 'ENABLED',
  } });
  targetId = target.id;
  const rootId = randomUUID();
  await prisma.organization.create({ data: {
    id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}`,
  } });
  await prisma.systemInitialization.create({ data: {
    id: 'PRIMARY', rootOrganizationId: rootId, superAdminUserId: actor.id, completedAt: NOW,
  } });
  if (count >= 1) await prisma.userRole.create({ data: {
    userId: actor.id, roleId: role.id, source: 'PERMANENT', validFrom: new Date(NOW.getTime() - 1_000),
  } });
  if (count >= 2) {
    const third = await prisma.user.create({ data: {
      username: `third.${randomUUID()}`, password: 'unused', status: 'ENABLED',
    } });
    await prisma.userRole.create({ data: {
      userId: third.id, roleId: role.id, source: 'PERMANENT', validFrom: new Date(NOW.getTime() - 1_000),
    } });
  }
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => { await clearTestApplicationData(prisma); });
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('adds exactly the second effective super-admin with RECOVERY source and redacted audit', async () => {
  await seedSeatCount(1);
  const result = await service().execute(input());
  assert.deepEqual(result, { actorUsername: 'root.admin', targetUsername: 'second.admin' });
  const grant = await prisma.userRole.findFirstOrThrow({ where: { userId: targetId } });
  assert.equal(grant.source, 'RECOVERY');
  assert.equal(grant.grantedByUserId, actorId);
  const log = await prisma.operationLog.findFirstOrThrow({ where: { action: 'SUPER_ADMIN_SECOND_SEAT_RECOVERY' } });
  const serialized = JSON.stringify(log);
  assert.equal(serialized.includes('correct-password'), false);
  assert.equal(serialized.includes(input().confirmation), false);
  assert.match(log.newValues ?? '', /Approved emergency second-seat recovery ticket 42/);
});

test('rejects missing initialization, zero seats, and an already-closed two-seat window', async () => {
  await assert.rejects(() => service().execute(input()));
  await seedSeatCount(0);
  await assert.rejects(() => service().execute(input()), RecoveryWindowUnavailableError);
  await clearTestApplicationData(prisma);
  await seedSeatCount(2);
  await assert.rejects(() => service().execute(input()), RecoveryWindowUnavailableError);
});

test('rejects wrong credentials, disabled actors or targets, existing grants, and invalid input', async () => {
  await seedSeatCount(1);
  await assert.rejects(() => service().execute(input({ actorPassword: 'wrong' })), SecurityError);
  await prisma.user.update({ where: { id: actorId }, data: { status: 'DISABLED' } });
  await assert.rejects(() => service().execute(input()), RecoveryWindowUnavailableError);
  await prisma.user.update({ where: { id: actorId }, data: { status: 'ENABLED' } });
  await prisma.user.update({ where: { id: targetId }, data: { status: 'DISABLED' } });
  await assert.rejects(() => service().execute(input()), ValidationCommandError);
  await prisma.user.update({ where: { id: targetId }, data: { status: 'ENABLED' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_SUPER_ADMIN' } });
  await prisma.userRole.create({ data: {
    userId: targetId, roleId: role.id, source: 'PERMANENT', validFrom: new Date(NOW.getTime() - 1_000),
  } });
  await assert.rejects(() => service().execute(input()), RecoveryWindowUnavailableError);
  await assert.rejects(() => service().execute(input({ reason: 'short' })), ValidationCommandError);
  await assert.rejects(() => service().execute(input({ confirmation: 'ADD SECOND SUPER ADMIN wrong' })), ValidationCommandError);
});

test('serializes concurrent invocations so only one grant and one audit are created', async () => {
  await seedSeatCount(1);
  const results = await Promise.allSettled([service().execute(input()), service().execute(input())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await prisma.userRole.count({ where: { userId: targetId, revokedAt: null } }), 1);
  assert.equal(await prisma.operationLog.count({ where: { action: 'SUPER_ADMIN_SECOND_SEAT_RECOVERY' } }), 1);
});
