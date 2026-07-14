import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('pkg includes the complete generator-function runtime closure as raw assets', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    pkg?: { assets?: string[]; scripts?: string[] };
  };
  const assets = manifest.pkg?.assets ?? [];
  const scripts = manifest.pkg?.scripts ?? [];
  const generatorFunctionAssets = assets.filter(asset => asset.startsWith('node_modules/generator-function/'));

  assert.deepEqual(generatorFunctionAssets, [
    'node_modules/generator-function/require.mjs',
    'node_modules/generator-function/index.js',
    'node_modules/generator-function/index.mjs',
    'node_modules/generator-function/legacy.js',
    'node_modules/generator-function/package.json',
  ]);
  assert.equal(scripts.some(script => script.startsWith('node_modules/generator-function/')), false);
});

test('pkg includes the Nano ID non-secure runtime closure as raw assets', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    pkg?: { assets?: string[]; scripts?: string[] };
  };
  const assets = manifest.pkg?.assets ?? [];
  const scripts = manifest.pkg?.scripts ?? [];
  const nanoidAssets = assets.filter(asset => asset.startsWith('node_modules/nanoid/'));

  assert.deepEqual(nanoidAssets, [
    'node_modules/nanoid/package.json',
    'node_modules/nanoid/non-secure/package.json',
    'node_modules/nanoid/non-secure/index.cjs',
  ]);
  assert.equal(scripts.some(script => script.startsWith('node_modules/nanoid/')), false);
});
