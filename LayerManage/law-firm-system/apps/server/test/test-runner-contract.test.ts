import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverBackendTests } from '../scripts/test/test-files';

test('discovers every nested backend unit test and ignores non-tests', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-tests-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'alpha.test.ts'), '');
  fs.writeFileSync(path.join(root, 'nested', 'beta.test.ts'), '');
  fs.writeFileSync(path.join(root, 'nested', 'helper.ts'), '');

  assert.deepEqual(discoverBackendTests(root), [
    path.join(root, 'alpha.test.ts'),
    path.join(root, 'nested', 'beta.test.ts'),
  ]);
});

test('normal project test path selects the complete backend suite', () => {
  const projectManifest = JSON.parse(fs.readFileSync(path.resolve('../..', 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const serverManifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  assert.match(projectManifest.scripts.test, /apps\/server run test:unit/);
  assert.doesNotMatch(projectManifest.scripts.test, /test:focused/);
  assert.match(serverManifest.scripts['test:unit'], /run-node-tests/);
  assert.match(serverManifest.scripts['test:focused'], /run-focused-tests/);
});
