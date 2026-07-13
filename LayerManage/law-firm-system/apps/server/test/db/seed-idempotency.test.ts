import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { seed } from '../../prisma/seed';
import { assertSafeSeedTestDatabaseUrl } from './seed-test-database-url';

const expectedCounts = {
  organizations: 2,
  positions: 1,
  employees: 1,
  users: 1,
  roles: 2,
  permissions: 11,
  userRoles: 1,
  rolePermissions: 11,
  channels: 0,
  leads: 0,
  customers: 0,
  contracts: 0,
  payments: 0,
  cases: 0,
};

async function readSeedCounts(prisma: PrismaClient) {
  const [
    organizations,
    positions,
    employees,
    users,
    roles,
    permissions,
    userRoles,
    rolePermissions,
    channels,
    leads,
    customers,
    contracts,
    payments,
    cases,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.position.count(),
    prisma.employee.count(),
    prisma.user.count(),
    prisma.role.count(),
    prisma.permission.count(),
    prisma.userRole.count(),
    prisma.rolePermission.count(),
    prisma.channel.count(),
    prisma.lead.count(),
    prisma.customer.count(),
    prisma.contract.count(),
    prisma.payment.count(),
    prisma.case.count(),
  ]);

  return {
    organizations,
    positions,
    employees,
    users,
    roles,
    permissions,
    userRoles,
    rolePermissions,
    channels,
    leads,
    customers,
    contracts,
    payments,
    cases,
  };
}

test('seed URL preflight rejects a missing URL without connecting', () => {
  assert.throws(() => assertSafeSeedTestDatabaseUrl(undefined), /DATABASE_URL_TEST is required/);
});

test('seed URL preflight rejects unsafe URLs without connecting', () => {
  const unsafeUrls: Array<[string, RegExp]> = [
    ['not-a-url', /Invalid URL/],
    ['mysql://u:p@localhost:55432/chengye_oa_test', /PostgreSQL/],
    ['postgresql://u:p@database.internal:55432/chengye_oa_test', /localhost or 127\.0\.0\.1/],
    ['postgresql://u:p@localhost:5432/chengye_oa_test', /port 55432/],
    ['postgresql://u:p@localhost:55432/chengye_oa', /end with _test/],
  ];

  for (const [databaseUrl, expectedError] of unsafeUrls) {
    assert.throws(() => assertSafeSeedTestDatabaseUrl(databaseUrl), expectedError);
  }
});

test('seed URL preflight accepts the dedicated local test database', () => {
  const url = assertSafeSeedTestDatabaseUrl('postgresql://u:p@127.0.0.1:55432/chengye_oa_test?schema=public');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/chengye_oa_test');
});

test('seed is idempotent', async () => {
  const databaseUrl = assertSafeSeedTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl.toString() });

  try {
    await seed(prisma, 'test-admin-password');
    const first = await readSeedCounts(prisma);
    assert.deepEqual(first, expectedCounts);

    await seed(prisma, 'test-admin-password');
    const second = await readSeedCounts(prisma);

    assert.deepEqual(second, first);
    assert.deepEqual(second, expectedCounts);
  } finally {
    await prisma.$disconnect();
  }
});
