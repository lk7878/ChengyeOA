import assert from 'node:assert/strict';
import test from 'node:test';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';

const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

test('encrypts and decrypts an MFA secret with AES-256-GCM', () => {
  const crypto = new MfaSecretCrypto(new Map([[1, key]]));
  const encrypted = crypto.encrypt('JBSWY3DPEHPK3PXP');

  assert.equal(encrypted.keyVersion, 1);
  assert.notEqual(encrypted.ciphertext, 'JBSWY3DPEHPK3PXP');
  assert.equal(Buffer.from(encrypted.iv, 'base64url').length, 12);
  assert.equal(crypto.decrypt(encrypted), 'JBSWY3DPEHPK3PXP');
});

test('uses a fresh IV for every encryption', () => {
  const crypto = new MfaSecretCrypto(new Map([[1, key]]));
  const first = crypto.encrypt('JBSWY3DPEHPK3PXP');
  const second = crypto.encrypt('JBSWY3DPEHPK3PXP');

  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test('rejects ciphertext tampering and unknown key versions', () => {
  const crypto = new MfaSecretCrypto(new Map([[1, key]]));
  const encrypted = crypto.encrypt('JBSWY3DPEHPK3PXP');
  const bytes = Buffer.from(encrypted.ciphertext, 'base64url');
  bytes[0] ^= 1;

  assert.throws(
    () => crypto.decrypt({ ...encrypted, ciphertext: bytes.toString('base64url') }),
    /MFA_SECRET_INVALID/,
  );
  assert.throws(() => crypto.decrypt({ ...encrypted, keyVersion: 2 }), /MFA_SECRET_INVALID/);
});

test('rejects encryption keys that are not exactly 32 bytes', () => {
  assert.throws(() => new MfaSecretCrypto(new Map([[1, Buffer.alloc(31)]])), /MFA_KEY_INVALID/);
});
