import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnvironment } from '../../config/env';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://chengye_app:local@localhost:5432/chengye_oa?schema=public',
  JWT_SECRET: '01234567890123456789012345678901',
  APP_KEYS: 'first-32-character-application-key,second-32-character-app-key',
};

test('accepts a PostgreSQL development environment', () => {
  assert.equal(loadEnvironment(valid).databaseUrl, valid.DATABASE_URL);
});

test('rejects SQLite URLs', () => {
  assert.throws(() => loadEnvironment({ ...valid, DATABASE_URL: 'file:./law_firm.db' }), /PostgreSQL/);
});

test('rejects sample secrets in production', () => {
  assert.throws(
    () => loadEnvironment({ ...valid, NODE_ENV: 'production', JWT_SECRET: 'replace_with_at_least_32_random_characters' }),
    /JWT_SECRET/,
  );
});
