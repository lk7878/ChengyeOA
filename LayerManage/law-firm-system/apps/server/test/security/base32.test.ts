import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBase32, encodeBase32 } from '../../app/domain/security/base32';

test('encodes RFC 4648 Base32 without padding', () => {
  assert.equal(encodeBase32(Buffer.from('foobar', 'ascii')), 'MZXW6YTBOI');
});

test('decodes normalized padded or unpadded Base32', () => {
  assert.equal(decodeBase32('mzxw6ytboi======').toString('ascii'), 'foobar');
  assert.equal(decodeBase32('MZXW6YTBOI').toString('ascii'), 'foobar');
});

test('round-trips arbitrary binary data', () => {
  const value = Buffer.from([0, 1, 2, 127, 128, 254, 255]);
  assert.deepEqual(decodeBase32(encodeBase32(value)), value);
});

test('rejects invalid Base32 input and misplaced padding', () => {
  assert.throws(() => decodeBase32('MZXW6YTB!'), /BASE32_INVALID/);
  assert.throws(() => decodeBase32('MZX=6YTB'), /BASE32_INVALID/);
});
