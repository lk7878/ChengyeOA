import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('pkg includes only the required generator-function runtime files as raw assets', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    pkg?: { assets?: string[]; scripts?: string[] };
  };
  const assets = manifest.pkg?.assets ?? [];
  const scripts = manifest.pkg?.scripts ?? [];
  const generatorFunctionAssets = assets.filter(asset => asset.startsWith('node_modules/generator-function/'));

  assert.deepEqual(generatorFunctionAssets, [
    'node_modules/generator-function/require.mjs',
    'node_modules/generator-function/index.js',
  ]);
  assert.equal(scripts.some(script => script.startsWith('node_modules/generator-function/')), false);
});
