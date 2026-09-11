import assert from 'node:assert/strict';
import test from 'node:test';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { seedSpec005BrowserFixture } from '../../scripts/test/seed-spec-005-browser';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST as string;
const BROWSER_PASSWORD = 'Fixture#Safe2026!';

test('browser fixture rejects missing credentials and every non-test database URL before connecting', async () => {
  const sink = { write: () => true };
  await assert.rejects(
    () => seedSpec005BrowserFixture({ DATABASE_URL_TEST: TEST_DATABASE_URL }, sink),
    /SPEC005_BROWSER_PASSWORD is required/,
  );
  await assert.rejects(
    () => seedSpec005BrowserFixture({
      DATABASE_URL_TEST: TEST_DATABASE_URL.replace(/chengye_oa_test/, 'chengye_oa'),
      SPEC005_BROWSER_PASSWORD: BROWSER_PASSWORD,
    }, sink),
    /ending in _test/,
  );
});

test('browser fixture uses production services and emits only safe identifiers', async () => {
  const prisma = createTestPrisma();
  const output: string[] = [];
  try {
    await clearTestApplicationData(prisma);
    const result = await seedSpec005BrowserFixture({
      DATABASE_URL_TEST: TEST_DATABASE_URL,
      SPEC005_BROWSER_PASSWORD: BROWSER_PASSWORD,
    }, { write: value => { output.push(String(value)); return true; } });

    assert.deepEqual(result.usernames, {
      root: 'spec005.root', second: 'spec005.second', systemAdmin: 'spec005.admin',
    });
    assert.equal(await prisma.user.count(), 3);
    assert.equal(await prisma.userRole.count({ where: {
      role: { code: 'SYSTEM_SUPER_ADMIN' }, revokedAt: null,
    } }), 2);
    assert.equal(await prisma.userRole.count({ where: {
      role: { code: 'SYSTEM_ADMIN' }, revokedAt: null,
    } }), 1);
    assert.equal(await prisma.position.count(), 1);
    assert.equal(await prisma.professionalTeam.count(), 1);

    const operations = await prisma.adminOperation.findMany({ orderBy: { createdAt: 'asc' } });
    assert.deepEqual(new Set(operations.map(item => item.status)), new Set([
      'SUCCEEDED', 'PENDING_POST_REVIEW', 'PENDING_REVIEW',
    ]));
    assert.equal(result.operationIds.systemAdminGrant, operations[0].id);
    assert.equal(result.operationIds.postReview, operations[1].id);
    assert.equal(result.operationIds.preReview, operations[2].id);

    const users = await prisma.user.findMany({ select: { password: true, mustChangePassword: true } });
    const hasher = new BcryptPasswordHasher();
    for (const user of users) {
      assert.equal(user.mustChangePassword, false);
      assert.equal(await hasher.compare(BROWSER_PASSWORD, user.password), true);
    }

    const serializedOutput = output.join('');
    assert.match(serializedOutput, /spec005\.root/);
    assert.match(serializedOutput, new RegExp(result.operationIds.preReview));
    assert.doesNotMatch(serializedOutput, new RegExp(BROWSER_PASSWORD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(serializedOutput, /postgres(?:ql)?:\/\//i);
    assert.doesNotMatch(serializedOutput, /chengye_test_local_only/i);
  } finally {
    await clearTestApplicationData(prisma);
    await prisma.$disconnect();
  }
});
