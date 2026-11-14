import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { intelligencePaths } from '../../app/controller/intelligence';

test('source and compiled production app resolve the same isolated adapter and data directory', () => {
  const root = resolve(__dirname, '../..');
  assert.deepEqual(intelligencePaths(root), intelligencePaths(resolve(root, 'dist')));
  assert.match(intelligencePaths(root).moduleUrl, /integrations\/intelligence\/cloud\/service\.mjs$/);
  assert.throws(() => intelligencePaths(resolve(root, 'missing-layout/nested/deeper')), /尚未部署/);
});
