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

test('event observability defaults are safe and exposed to Egg config', () => {
  const loaded = loadEnvironment(baseEnv).eventObservability;
  assert.deepEqual(loaded, {
    heartbeatSeconds: 10,
    undispatchedBlockSeconds: 120,
    dueBacklogBlockSeconds: 300,
    leaseLostDegradedCount: 1,
    leaseLostBlockedCount: 3,
    canaryWindowMinutes: 15,
    heartbeatStaleSeconds: 60,
  });

  const configSource = fs.readFileSync(path.resolve('config/config.default.ts'), 'utf8');
  assert.match(configSource, /config\.eventObservability\s*=\s*env\.eventObservability/);
});

test('event observability accepts decimal integers at documented inclusive bounds', () => {
  const minimums = loadEnvironment({
    ...baseEnv,
    EVENT_OBSERVABILITY_HEARTBEAT_SECONDS: '5',
    EVENT_OBSERVABILITY_UNDISPATCHED_BLOCK_SECONDS: '30',
    EVENT_OBSERVABILITY_DUE_BACKLOG_BLOCK_SECONDS: '60',
    EVENT_OBSERVABILITY_LEASE_LOST_DEGRADED_COUNT: '1',
    EVENT_OBSERVABILITY_LEASE_LOST_BLOCKED_COUNT: '2',
    EVENT_OBSERVABILITY_CANARY_WINDOW_MINUTES: '5',
  }).eventObservability;

  assert.deepEqual(minimums, {
    heartbeatSeconds: 5,
    heartbeatStaleSeconds: 60,
    undispatchedBlockSeconds: 30,
    dueBacklogBlockSeconds: 60,
    leaseLostDegradedCount: 1,
    leaseLostBlockedCount: 2,
    canaryWindowMinutes: 5,
  });

  const maximums = loadEnvironment({
    ...baseEnv,
    EVENT_OBSERVABILITY_HEARTBEAT_SECONDS: '60',
    EVENT_OBSERVABILITY_UNDISPATCHED_BLOCK_SECONDS: '3600',
    EVENT_OBSERVABILITY_DUE_BACKLOG_BLOCK_SECONDS: '86400',
    EVENT_OBSERVABILITY_LEASE_LOST_DEGRADED_COUNT: '99',
    EVENT_OBSERVABILITY_LEASE_LOST_BLOCKED_COUNT: '100',
    EVENT_OBSERVABILITY_CANARY_WINDOW_MINUTES: '120',
  }).eventObservability;

  assert.deepEqual(maximums, {
    heartbeatSeconds: 60,
    heartbeatStaleSeconds: 180,
    undispatchedBlockSeconds: 3600,
    dueBacklogBlockSeconds: 86400,
    leaseLostDegradedCount: 99,
    leaseLostBlockedCount: 100,
    canaryWindowMinutes: 120,
  });
});

test('event observability rejects invalid decimal integers and unsafe lease-loss ordering', () => {
  for (const [name, value] of [
    ['EVENT_OBSERVABILITY_HEARTBEAT_SECONDS', '4'],
    ['EVENT_OBSERVABILITY_HEARTBEAT_SECONDS', '61'],
    ['EVENT_OBSERVABILITY_UNDISPATCHED_BLOCK_SECONDS', '29'],
    ['EVENT_OBSERVABILITY_UNDISPATCHED_BLOCK_SECONDS', '3601'],
    ['EVENT_OBSERVABILITY_DUE_BACKLOG_BLOCK_SECONDS', '1e2'],
    ['EVENT_OBSERVABILITY_DUE_BACKLOG_BLOCK_SECONDS', '59'],
    ['EVENT_OBSERVABILITY_DUE_BACKLOG_BLOCK_SECONDS', '86401'],
    ['EVENT_OBSERVABILITY_LEASE_LOST_DEGRADED_COUNT', '0'],
    ['EVENT_OBSERVABILITY_LEASE_LOST_DEGRADED_COUNT', '100'],
    ['EVENT_OBSERVABILITY_LEASE_LOST_BLOCKED_COUNT', '1'],
    ['EVENT_OBSERVABILITY_LEASE_LOST_BLOCKED_COUNT', ''],
    ['EVENT_OBSERVABILITY_LEASE_LOST_BLOCKED_COUNT', '101'],
    ['EVENT_OBSERVABILITY_CANARY_WINDOW_MINUTES', '4'],
    ['EVENT_OBSERVABILITY_CANARY_WINDOW_MINUTES', '121'],
  ]) {
    assert.throws(() => loadEnvironment({ ...baseEnv, [name]: value }), new RegExp(name));
  }

  assert.throws(() => loadEnvironment({
    ...baseEnv,
    EVENT_OBSERVABILITY_LEASE_LOST_DEGRADED_COUNT: '3',
    EVENT_OBSERVABILITY_LEASE_LOST_BLOCKED_COUNT: '3',
  }), /BLOCKED.*greater than.*DEGRADED/i);
});
