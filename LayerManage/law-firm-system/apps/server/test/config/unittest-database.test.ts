import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import unittestConfig, { selectTestDatabaseUrl } from '../../config/config.unittest';
import { EVENT_SUBSCRIPTION_CATALOG } from '../../app/domain/events/event-subscription-catalog';
import {
  assertTestDatabaseUrl,
  clearTestApplicationData,
} from '../helpers/test-database';

const testDatabaseUrl = 'postgresql://chengye_test:chengye_test_local_only@localhost:55432/chengye_oa_test?schema=public';

test('selects a PostgreSQL database whose name ends in _test', () => {
  assert.equal(selectTestDatabaseUrl({ DATABASE_URL_TEST: testDatabaseUrl }), testDatabaseUrl);
  assert.throws(
    () => selectTestDatabaseUrl({ DATABASE_URL_TEST: 'postgresql://user:password@localhost:5432/chengye_oa?schema=public' }),
    /Egg unit tests require DATABASE_URL_TEST ending in _test/,
  );
  assert.throws(
    () => selectTestDatabaseUrl({ DATABASE_URL_TEST: 'sqlite:///tmp/chengye_oa_test.db' }),
    /Egg unit tests require DATABASE_URL_TEST ending in _test/,
  );
});

test('fails closed before Egg tests can use a non-test database', () => {
  const originalTestUrl = process.env.DATABASE_URL_TEST;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  try {
    process.env.DATABASE_URL_TEST = testDatabaseUrl;
    unittestConfig();
    assert.equal(process.env.DATABASE_URL, testDatabaseUrl);

    process.env.DATABASE_URL_TEST = 'postgresql://user:password@localhost:5432/chengye_oa?schema=public';
    assert.throws(() => unittestConfig(), /Egg unit tests require DATABASE_URL_TEST ending in _test/);
  } finally {
    process.env.DATABASE_URL_TEST = originalTestUrl;
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test('guards test Prisma helpers and truncates every application table', async () => {
  assert.equal(assertTestDatabaseUrl(testDatabaseUrl).toString(), testDatabaseUrl);
  assert.throws(
    () => assertTestDatabaseUrl('postgresql://user:password@localhost:5432/chengye_oa?schema=public'),
    /Integration tests require a PostgreSQL database ending in _test/,
  );
  assert.throws(
    () => assertTestDatabaseUrl('mysql://user:password@localhost:3306/chengye_oa_test'),
    /Integration tests require a PostgreSQL database ending in _test/,
  );

  const originalTestUrl = process.env.DATABASE_URL_TEST;
  const statements: string[] = [];
  const catalogWrites: unknown[] = [];
  const subscriptionWrites: unknown[] = [];
  try {
    process.env.DATABASE_URL_TEST = testDatabaseUrl;
    await clearTestApplicationData({
      async $executeRawUnsafe(statement: string) {
        statements.push(statement);
        return 0;
      },
      permission: {
        async createMany(input: unknown) {
          catalogWrites.push(input);
          return { count: 122 };
        },
      },
      eventSubscription: {
        async createMany(input: unknown) {
          subscriptionWrites.push(input);
          return { count: EVENT_SUBSCRIPTION_CATALOG.length };
        },
      },
    } as never);
  } finally {
    process.env.DATABASE_URL_TEST = originalTestUrl;
  }

  assert.equal(statements.length, 1);
  assert.match(statements[0], /^TRUNCATE TABLE /);
  assert.match(statements[0], /"system_initialization"/);
  assert.match(statements[0], / CASCADE$/);
  assert.equal(catalogWrites.length, 1);
  assert.equal((catalogWrites[0] as { data: unknown[] }).data.length, 145);
  assert.equal(subscriptionWrites.length, 1);
  assert.deepEqual((subscriptionWrites[0] as { data: unknown[] }).data, EVENT_SUBSCRIPTION_CATALOG.map(item => ({
    ...item,
    filterJson: Prisma.DbNull,
  })));
});
