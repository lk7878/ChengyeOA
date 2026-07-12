import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeTestDatabaseUrl, resetTestDatabase } from '../../scripts/db/reset-test-db';

test('allows an explicitly confirmed test database', () => {
  const url = assertSafeTestDatabaseUrl('postgresql://u:p@localhost:5432/chengye_oa_test', 'true');
  assert.equal(url.pathname, '/chengye_oa_test');
});

test('rejects a database without the test suffix', () => {
  assert.throws(() => assertSafeTestDatabaseUrl('postgresql://u:p@localhost:5432/chengye_oa', 'true'), /_test/);
});

test('rejects a reset without explicit confirmation', () => {
  assert.throws(
    () => assertSafeTestDatabaseUrl('postgresql://u:p@localhost:5432/chengye_oa_test', undefined),
    /ALLOW_TEST_DB_RESET/,
  );
});

test('runs the resolved Prisma CLI with the current Node executable', () => {
  let executable = '';
  let args: readonly string[] = [];
  let databaseUrl = '';

  resetTestDatabase(
    {
      DATABASE_URL_TEST: 'postgresql://u:p@localhost:55432/chengye_oa_test',
      ALLOW_TEST_DB_RESET: 'true',
    },
    (file, commandArgs, options) => {
      executable = file;
      args = commandArgs;
      databaseUrl = options.env?.DATABASE_URL || '';
    },
  );

  assert.equal(executable, process.execPath);
  assert.deepEqual(args, [require.resolve('prisma/build/index.js'), 'migrate', 'reset', '--force', '--skip-seed']);
  assert.equal(databaseUrl, 'postgresql://u:p@localhost:55432/chengye_oa_test');
});
