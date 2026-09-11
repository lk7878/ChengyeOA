import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpaqueToken, hashOpaqueToken } from '../../app/domain/security/opaque-token';

test('creates a URL-safe token with 256 bits of entropy by default', () => {
  const token = createOpaqueToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  assert.notEqual(token, createOpaqueToken());
});

test('hashes opaque tokens deterministically without preserving plaintext', () => {
  const token = 'fixed-token-for-contract';
  const hash = hashOpaqueToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, hashOpaqueToken(token));
  assert.notEqual(hash, token);
  assert.notEqual(hash, hashOpaqueToken(`${token}-different`));
});

test('rejects token generation below 256 bits', () => {
  assert.throws(() => createOpaqueToken(31), /OPAQUE_TOKEN_SIZE_INVALID/);
});
