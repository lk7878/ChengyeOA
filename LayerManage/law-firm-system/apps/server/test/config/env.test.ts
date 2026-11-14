import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnvironment, loadProductionEnvironment } from '../../config/env';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://chengye_app:local@localhost:5432/chengye_oa?schema=public',
  JWT_SECRET: '01234567890123456789012345678901',
  APP_KEYS: 'first-32-character-application-key,second-32-character-app-key',
  MFA_ENCRYPTION_KEY_V1: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
};

test('accepts a PostgreSQL development environment', () => {
  const loaded = loadEnvironment(valid);
  assert.equal(loaded.databaseUrl, valid.DATABASE_URL);
  assert.deepEqual(loaded.corsAllowedOrigins, ['http://localhost:3000']);
  assert.deepEqual(loaded.trustedOrigins, ['http://localhost:3000']);
  assert.equal(loaded.production, false);
  assert.deepEqual(loaded.mfaEncryptionKeys.get(1), Buffer.from('0123456789abcdef0123456789abcdef'));
});

test('requires a valid 32-byte MFA encryption key', () => {
  assert.throws(
    () => loadEnvironment({ ...valid, MFA_ENCRYPTION_KEY_V1: undefined }),
    /MFA_ENCRYPTION_KEY_V1/,
  );
  assert.throws(
    () => loadEnvironment({ ...valid, MFA_ENCRYPTION_KEY_V1: Buffer.alloc(31).toString('base64') }),
    /32 bytes/,
  );
  assert.throws(
    () => loadEnvironment({ ...valid, MFA_ENCRYPTION_KEY_V1: 'not valid base64!' }),
    /Base64/,
  );
});

test('password-only login is opt-in and restricted to local development', () => {
  assert.equal(loadEnvironment(valid).localPasswordLogin, false);
  assert.equal(loadEnvironment({ ...valid, LOCAL_PASSWORD_LOGIN: 'false' }).localPasswordLogin, false);
  assert.equal(loadEnvironment({ ...valid, LOCAL_PASSWORD_LOGIN: 'true' }).localPasswordLogin, true);
  for (const NODE_ENV of ['production', 'test', 'staging']) {
    assert.throws(() => loadEnvironment({ ...valid, NODE_ENV, LOCAL_PASSWORD_LOGIN: 'true' }), /LOCAL_PASSWORD_LOGIN/);
  }
  assert.throws(() => loadEnvironment({ ...valid, LOCAL_PASSWORD_LOGIN: 'yes' }), /LOCAL_PASSWORD_LOGIN/);
  assert.throws(() => loadEnvironment({
    ...valid, LOCAL_PASSWORD_LOGIN: 'true', DATABASE_URL: 'postgresql://user:pass@db.example/oa',
  }), /LOCAL_PASSWORD_LOGIN/);
});

test('requires explicit CORS origins in production', () => {
  assert.throws(() => loadEnvironment({
    ...valid,
    NODE_ENV: 'production',
  }), /CORS_ALLOWED_ORIGINS/);
});

test('marks an explicit production environment and reuses its trusted origins', () => {
  const loaded = loadEnvironment({
    ...valid,
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS: 'https://oa.chengye.example',
    EVENT_WORKER_ENABLED: 'false',
  });
  assert.equal(loaded.production, true);
  assert.deepEqual(loaded.trustedOrigins, ['https://oa.chengye.example']);
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

test('packaged startup treats omitted NODE_ENV as production before validating secrets', () => {
  const packaged: NodeJS.ProcessEnv = {
    ...valid,
    NODE_ENV: undefined,
    JWT_SECRET: 'replace_with_at_least_32_random_characters',
  };
  assert.throws(() => loadProductionEnvironment(packaged), /JWT_SECRET/);
  assert.equal(packaged.NODE_ENV, 'production');
});
