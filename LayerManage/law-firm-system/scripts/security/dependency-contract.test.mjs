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
