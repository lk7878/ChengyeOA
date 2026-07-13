import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { seed } from '../../prisma/seed';

test('seed is idempotent', async () => {
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

  try {
    await seed(prisma, 'test-admin-password');
    const first = {
      users: await prisma.user.count(),
      roles: await prisma.role.count(),
      permissions: await prisma.permission.count(),
    };

    await seed(prisma, 'test-admin-password');
    const second = {
      users: await prisma.user.count(),
      roles: await prisma.role.count(),
      permissions: await prisma.permission.count(),
    };

    assert.deepEqual(second, first);
  } finally {
    await prisma.$disconnect();
  }
});
