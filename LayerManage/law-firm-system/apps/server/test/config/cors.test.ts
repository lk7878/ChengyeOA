import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCorsAllowedOrigins, resolveCorsOrigin } from '../../config/cors';

test('development defaults to the local web origin', () => {
  assert.deepEqual(parseCorsAllowedOrigins(undefined, 'development'), ['http://localhost:3000']);
});

test('production requires an explicit origin list', () => {
  assert.throws(() => parseCorsAllowedOrigins(undefined, 'production'), /CORS_ALLOWED_ORIGINS/);
});

test('normalizes a comma-separated origin list and rejects normalized duplicates', () => {
  assert.deepEqual(
    parseCorsAllowedOrigins('https://oa.chengye.example/, http://localhost:3000', 'production'),
    ['https://oa.chengye.example', 'http://localhost:3000'],
  );
  assert.throws(() => parseCorsAllowedOrigins(
    'https://oa.chengye.example,https://oa.chengye.example/',
    'production',
  ), /duplicate/i);
});

for (const value of [
  '*',
  'ftp://oa.chengye.example',
  'https://user:password@oa.chengye.example',
  'https://oa.chengye.example/path',
  'https://oa.chengye.example?query=1',
  'https://oa.chengye.example/#fragment',
]) {
  test(`rejects unsafe CORS origin ${value}`, () => {
    assert.throws(() => parseCorsAllowedOrigins(value, 'production'), /CORS_ALLOWED_ORIGINS/);
  });
}

test('reflects only an explicitly allowed credentialed origin', () => {
  const allowed = ['https://oa.chengye.example'];
  assert.equal(resolveCorsOrigin('https://oa.chengye.example', allowed), 'https://oa.chengye.example');
  assert.equal(resolveCorsOrigin('https://attacker.example', allowed), '');
  assert.equal(resolveCorsOrigin('not a URL', allowed), '');
  assert.equal(resolveCorsOrigin('', allowed), '');
});
