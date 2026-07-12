import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const launchers = [
  fs.readFileSync(path.resolve('server-entry.js'), 'utf8'),
  fs.readFileSync(path.resolve('scripts/build-package.js'), 'utf8'),
];

test('portable launchers require validated external database and secret configuration', () => {
  assert.match(launchers[0], /require\(['"]\.\/dist\/config\/env['"]\)/);
  assert.match(launchers[1], /require\(['"]\.\/config\/env['"]\)/);

  for (const source of launchers) {
    assert.match(source, /loadEnvironment\(process\.env\)/);
    assert.doesNotMatch(source, /file:/);
    assert.doesNotMatch(source, /law_firm\.db/);
    assert.doesNotMatch(source, /Date\.now\(\)/);
    assert.doesNotMatch(source, /process\.env\.(?:DATABASE_URL|JWT_SECRET|APP_KEYS)\s*=/);
  }
});
