import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExceptions, validatePolicy } from './policy.mjs';

function validPolicy() {
  return {
    schemaVersion: 1,
    workspaces: [
      { name: 'server', path: 'apps/server' },
      { name: 'web', path: 'apps/web' },
    ],
    gates: {
      production: { critical: 'block', high: 'block', moderate: 'report', low: 'report' },
      development: { critical: 'block', high: 'exception', moderate: 'report', low: 'report' },
    },
    maxDevelopmentExceptionDays: 30,
    outputDirectory: 'var/security',
  };
}

function validException(overrides = {}) {
  return {
    id: 'SEC-2026-001',
    workspace: 'server',
    package: 'serialize-javascript',
    advisories: ['GHSA-5c6j-r48x-rmvq'],
    scope: 'development',
    reason: 'No compatible upstream release is available.',
    mitigation: 'The package is restricted to isolated test and build execution.',
    owner: 'platform-engineering',
    approvedBy: 'system-super-admin',
    createdAt: '2026-07-16',
    expiresAt: '2026-08-15',
    trackingRef: 'SEC-SPEC-001/serialize-javascript',
    ...overrides,
  };
}

test('accepts the exact policy and an empty exception document', () => {
  const policy = validatePolicy(validPolicy());
  const exceptions = validateExceptions(
    { schemaVersion: 1, exceptions: [] },
    policy,
    new Date('2026-07-16T00:00:00Z'),
  );

  assert.equal(policy.schemaVersion, 1);
  assert.deepEqual(exceptions, []);
});

test('rejects unknown policy fields and unsupported workspace definitions', () => {
  assert.throws(() => validatePolicy({ ...validPolicy(), unexpected: true }), /unknown field/i);
  assert.throws(() => validatePolicy({
    ...validPolicy(),
    workspaces: [{ name: 'server', path: 'apps/server' }, { name: 'server', path: 'apps/web' }],
  }), /duplicate workspace/i);
  assert.throws(() => validatePolicy({
    ...validPolicy(),
    workspaces: [{ name: 'server', path: '../server' }, { name: 'web', path: 'apps/web' }],
  }), /relative workspace path/i);
  assert.throws(() => validatePolicy({
    ...validPolicy(),
    workspaces: [{ name: 'server', path: 'apps/server' }, { name: 'desktop', path: 'apps/desktop' }],
  }), /unsupported workspace/i);
  assert.throws(() => validatePolicy({
    ...validPolicy(),
    workspaces: [{ name: 'server', path: 'apps/web' }, { name: 'web', path: 'apps/server' }],
  }), /workspace server\.path/i);
  assert.throws(() => validatePolicy({
    ...validPolicy(),
    workspaces: [{ name: 'server', path: 'apps/server' }, { name: 'web', path: 'apps/server' }],
  }), /workspace web\.path/i);
});

test('rejects unknown exception fields, wildcards, and production scope', () => {
  const policy = validatePolicy(validPolicy());
  const document = exception => ({ schemaVersion: 1, exceptions: [exception] });
  const now = new Date('2026-07-16T00:00:00Z');

  assert.throws(() => validateExceptions(document(validException({ extra: true })), policy, now), /unknown field/i);
  assert.throws(() => validateExceptions(document(validException({ package: '*' })), policy, now), /wildcard/i);
  assert.throws(() => validateExceptions(document(validException({ advisories: ['GHSA-*'] })), policy, now), /advisory/i);
  assert.throws(() => validateExceptions(document(validException({ scope: 'production' })), policy, now), /development/i);
});

test('requires independent approval and valid ISO calendar dates', () => {
  const policy = validatePolicy(validPolicy());
  const document = exception => ({ schemaVersion: 1, exceptions: [exception] });
  const now = new Date('2026-07-16T00:00:00Z');

  assert.throws(() => validateExceptions(document(validException({ approvedBy: 'platform-engineering' })), policy, now), /different/i);
  assert.throws(() => validateExceptions(document(validException({ createdAt: '2026-02-30' })), policy, now), /valid ISO/i);
  assert.throws(() => validateExceptions(document(validException({ expiresAt: '16-08-2026' })), policy, now), /valid ISO/i);
});

test('rejects expired, reversed, and overlong exception periods', () => {
  const policy = validatePolicy(validPolicy());
  const document = exception => ({ schemaVersion: 1, exceptions: [exception] });

  assert.throws(() => validateExceptions(
    document(validException({ createdAt: '2026-06-15', expiresAt: '2026-07-15' })),
    policy,
    new Date('2026-07-16T00:00:00Z'),
  ), /expired/i);
  assert.throws(() => validateExceptions(
    document(validException({ createdAt: '2026-07-16', expiresAt: '2026-07-15' })),
    policy,
    new Date('2026-07-14T00:00:00Z'),
  ), /after createdAt/i);
  assert.throws(() => validateExceptions(
    document(validException({ expiresAt: '2026-08-16' })),
    policy,
    new Date('2026-07-16T00:00:00Z'),
  ), /30 days/i);
  assert.throws(() => validateExceptions(
    document(validException({ createdAt: '2026-07-17', expiresAt: '2026-08-15' })),
    policy,
    new Date('2026-07-16T23:59:59Z'),
  ), /future/i);
});

test('rejects duplicate identifiers and duplicate advisory entries', () => {
  const policy = validatePolicy(validPolicy());
  const now = new Date('2026-07-16T00:00:00Z');

  assert.throws(() => validateExceptions({
    schemaVersion: 1,
    exceptions: [validException(), validException({ package: 'vite' })],
  }, policy, now), /duplicate exception id/i);
  assert.throws(() => validateExceptions({
    schemaVersion: 1,
    exceptions: [validException({ advisories: ['GHSA-5c6j-r48x-rmvq', 'GHSA-5c6j-r48x-rmvq'] })],
  }, policy, now), /duplicate advisory/i);
});
