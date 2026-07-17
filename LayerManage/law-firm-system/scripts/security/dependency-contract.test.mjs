import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readLock(relativePath) {
  return JSON.parse(readFileSync(path.resolve(projectRoot, relativePath), 'utf8'));
}

function versionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  assert.ok(match, `invalid semantic version: ${value}`);
  return match.slice(1).map(Number);
}

function assertVersionAtLeast(actual, minimum) {
  const left = versionParts(actual);
  const right = versionParts(minimum);
  const comparison = left.findIndex((value, index) => value !== right[index]);
  assert.ok(comparison === -1 || left[comparison] > right[comparison], `${actual} must be at least ${minimum}`);
}

function assertUndiciVersionSafe(actual) {
  const [major] = versionParts(actual);
  if (major === 6) return assertVersionAtLeast(actual, '6.27.0');
  if (major === 7) return assertVersionAtLeast(actual, '7.28.0');
  assert.ok(major >= 8, `${actual} must be 6.27+, 7.28+, or 8+`);
}

test('all npm lockfiles retain lockfile version 3', () => {
  for (const file of ['package-lock.json', 'apps/server/package-lock.json', 'apps/web/package-lock.json']) {
    assert.equal(readLock(file).lockfileVersion, 3, file);
  }
});

test('web production dependency floors stay above remediated versions', () => {
  const lock = readLock('apps/web/package-lock.json');
  assertVersionAtLeast(lock.packages['node_modules/axios'].version, '1.18.1');
  assertVersionAtLeast(lock.packages['node_modules/form-data'].version, '4.0.6');
  assertVersionAtLeast(lock.packages['node_modules/react-router-dom'].version, '7.18.1');
  assertVersionAtLeast(lock.packages['node_modules/react-router'].version, '7.18.1');
});

test('web development toolchain stays above the remediated Vite floor', () => {
  const lock = readLock('apps/web/package-lock.json');
  assertVersionAtLeast(lock.packages['node_modules/vite'].version, '8.1.4');
});

test('server uses the remediated CORS plugin and has no Egg JWT plugin chain', () => {
  const manifest = JSON.parse(readFileSync(path.resolve(projectRoot, 'apps/server/package.json'), 'utf8'));
  const lock = readLock('apps/server/package-lock.json');
  assert.equal(manifest.dependencies['egg-jwt'], undefined);
  assertVersionAtLeast(lock.packages['node_modules/egg-cors'].version, '3.0.1');
  for (const key of Object.keys(lock.packages)) {
    assert.doesNotMatch(key, /node_modules\/(?:egg-jwt|koa-jwt2|lodash\.set)$/);
  }
});

test('server runtime dependency tree stays above remediated security floors', () => {
  const lock = readLock('apps/server/package-lock.json');
  assertVersionAtLeast(lock.packages['node_modules/egg'].version, '3.34.0');
  assertVersionAtLeast(lock.packages['node_modules/egg-scripts'].version, '3.1.0');
  assertVersionAtLeast(lock.packages['node_modules/jsonwebtoken'].version, '9.0.3');

  const entries = Object.entries(lock.packages);
  const formData = entries.filter(([key]) => key.endsWith('node_modules/form-data'));
  const undici = entries.filter(([key]) => key.endsWith('node_modules/undici'));
  assert.ok(formData.length > 0, 'form-data must remain visible to the lockfile contract');
  assert.ok(undici.length > 0, 'undici must remain visible to the lockfile contract');
  formData.forEach(([, value]) => assertVersionAtLeast(value.version, '4.0.6'));
  undici.forEach(([, value]) => assertUndiciVersionSafe(value.version));
});

test('the initial development exception is exact and time bounded', () => {
  const document = JSON.parse(readFileSync(path.resolve(projectRoot, 'security/dependency-exceptions.json'), 'utf8'));
  assert.deepEqual(document.exceptions, [
    {
      id: 'SEC-2026-001',
      workspace: 'server',
      package: 'serialize-javascript',
      advisories: ['GHSA-5c6j-r48x-rmvq'],
      scope: 'development',
      reason: 'The current Egg test toolchain has no compatible upstream release that removes this advisory without a framework downgrade.',
      mitigation: 'The package is restricted to local and CI test/build execution; production audit and runtime artifacts omit development dependencies.',
      owner: 'platform-engineering',
      approvedBy: 'system-super-admin',
      createdAt: '2026-07-16',
      expiresAt: '2026-08-15',
      trackingRef: 'SEC-SPEC-001/serialize-javascript',
    },
  ]);
});
