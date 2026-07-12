import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeTestDatabaseUrl } from '../../scripts/db/reset-test-db';

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
