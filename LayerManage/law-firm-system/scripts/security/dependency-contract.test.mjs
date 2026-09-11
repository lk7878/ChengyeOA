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
  if (major === 6) return assertVersionAtLeast(actual, '6.28.0');
  if (major === 7) return assertVersionAtLeast(actual, '7.29.0');
  assert.ok(major >= 8, `${actual} must be 6.28+, 7.29+, or 8+`);
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
  // SEC-2026-002 已修复：react-router-dom 包在 v8 移除，react-router 升级至 ≥8.3.0（GHSA-qwww-vcr4-c8h2 缓解）。
  assertVersionAtLeast(lock.packages['node_modules/react-router'].version, '8.3.0');
});

test('web development toolchain stays above remediated security floors', () => {
  const lock = readLock('apps/web/package-lock.json');
  assertVersionAtLeast(lock.packages['node_modules/vite'].version, '8.1.4');
  assertVersionAtLeast(lock.packages['node_modules/@babel/core'].version, '7.29.7');
  assertVersionAtLeast(lock.packages['node_modules/brace-expansion'].version, '5.0.7');
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
  // SEC-2026-001 例外已退役（SPEC-038）：serialize-javascript 7.0.7 已修复 GHSA-5c6j-r48x-rmvq，
  // audit 实测 0 漏洞——契约下限锁死当前已知安全版本，防无例外静默回退。
  assertVersionAtLeast(lock.packages['node_modules/serialize-javascript'].version, '7.0.7');

  const entries = Object.entries(lock.packages);
  const formData = entries.filter(([key]) => key.endsWith('node_modules/form-data'));
  const undici = entries.filter(([key]) => key.endsWith('node_modules/undici'));
  assert.ok(formData.length > 0, 'form-data must remain visible to the lockfile contract');
  assert.ok(undici.length > 0, 'undici must remain visible to the lockfile contract');
  formData.forEach(([, value]) => assertVersionAtLeast(value.version, '4.0.6'));
  undici.forEach(([, value]) => assertUndiciVersionSafe(value.version));
});

test('the development exceptions are exact and time bounded', () => {
  const document = JSON.parse(readFileSync(path.resolve(projectRoot, 'security/dependency-exceptions.json'), 'utf8'));
  assert.deepEqual(document.exceptions, []);
});
