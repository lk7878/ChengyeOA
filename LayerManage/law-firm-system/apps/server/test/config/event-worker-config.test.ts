import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadEnvironment } from '../../config/env';

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://chengye_app:development@localhost:5432/chengye_oa?schema=public',
  JWT_SECRET: '01234567890123456789012345678901',
  APP_KEYS: 'first-32-character-application-key,second-32-character-app-key',
  MFA_ENCRYPTION_KEY_V1: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
};

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://chengye_app:production@database.internal:5432/chengye_oa?schema=public',
    CORS_ALLOWED_ORIGINS: 'https://oa.chengye.example',
    ...overrides,
  };
}

test('production requires an explicit worker switch', () => {
  assert.throws(
    () => loadEnvironment(productionEnv({ EVENT_WORKER_ENABLED: undefined })),
    /EVENT_WORKER_ENABLED/,
  );
  assert.equal(
    loadEnvironment(productionEnv({ EVENT_WORKER_ENABLED: 'false' })).eventWorker.enabled,
    false,
  );
});

test('worker defaults are environment-safe and are exposed to Egg config', () => {
  assert.deepEqual(loadEnvironment(baseEnv).eventWorker, {
    enabled: true,
    pollMs: 1000,
    batchSize: 25,
    leaseSeconds: 60,
    shutdownSeconds: 30,
  });
  assert.equal(loadEnvironment({ ...baseEnv, NODE_ENV: 'test' }).eventWorker.enabled, false);
  assert.equal(loadEnvironment({ ...baseEnv, NODE_ENV: 'unittest' }).eventWorker.enabled, false);

  const configSource = fs.readFileSync(path.resolve('config/config.default.ts'), 'utf8');
  assert.match(configSource, /config\.eventWorker\s*=\s*env\.eventWorker/);
});

test('worker switch accepts only exact true or false', () => {
  for (const invalid of ['', 'TRUE', 'False', '1', 'yes', ' true ']) {
    assert.throws(
      () => loadEnvironment({ ...baseEnv, EVENT_WORKER_ENABLED: invalid }),
      /EVENT_WORKER_ENABLED/,
    );
  }
  assert.equal(loadEnvironment({ ...baseEnv, EVENT_WORKER_ENABLED: 'false' }).eventWorker.enabled, false);
  assert.equal(loadEnvironment({ ...baseEnv, EVENT_WORKER_ENABLED: 'true' }).eventWorker.enabled, true);
});

test('worker numeric settings accept decimal integers within inclusive bounds', () => {
  const loaded = loadEnvironment({
    ...baseEnv,
    EVENT_WORKER_POLL_MS: '250',
    EVENT_WORKER_BATCH_SIZE: '200',
    EVENT_WORKER_LEASE_SECONDS: '600',
    EVENT_WORKER_SHUTDOWN_SECONDS: '120',
  });
  assert.deepEqual(loaded.eventWorker, {
    enabled: true,
    pollMs: 250,
    batchSize: 200,
    leaseSeconds: 600,
    shutdownSeconds: 120,
  });
});

test('worker numeric settings fail closed on formats, ranges, and unsafe shutdown', () => {
  const invalidCases: Array<[string, string]> = [
    ['EVENT_WORKER_POLL_MS', '249'],
    ['EVENT_WORKER_POLL_MS', '60001'],
    ['EVENT_WORKER_POLL_MS', '1e3'],
    ['EVENT_WORKER_BATCH_SIZE', '0'],
    ['EVENT_WORKER_BATCH_SIZE', '201'],
    ['EVENT_WORKER_BATCH_SIZE', '25.0'],
    ['EVENT_WORKER_LEASE_SECONDS', '29'],
    ['EVENT_WORKER_LEASE_SECONDS', '601'],
    ['EVENT_WORKER_SHUTDOWN_SECONDS', '0'],
    ['EVENT_WORKER_SHUTDOWN_SECONDS', '121'],
  ];
  for (const [name, value] of invalidCases) {
    assert.throws(() => loadEnvironment({ ...baseEnv, [name]: value }), new RegExp(name));
  }
  assert.throws(
    () => loadEnvironment({
      ...baseEnv,
      EVENT_WORKER_LEASE_SECONDS: '60',
      EVENT_WORKER_SHUTDOWN_SECONDS: '60',
    }),
    /EVENT_WORKER_SHUTDOWN_SECONDS.*less than.*EVENT_WORKER_LEASE_SECONDS/i,
  );
});
