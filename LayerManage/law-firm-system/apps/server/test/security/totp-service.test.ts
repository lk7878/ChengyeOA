import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeBase32 } from '../../app/domain/security/base32';
import { TotpService } from '../../app/domain/security/totp-service';

const service = new TotpService();
const rfcSecret = encodeBase32(Buffer.from('12345678901234567890', 'ascii'));

test('matches the RFC 6238 SHA-1 vector at 59 seconds', () => {
  assert.deepEqual(service.verify(rfcSecret, '287082', new Date(59_000)), {
    counter: 1n,
    drift: 0,
  });
});

test('accepts only the adjacent TOTP periods and reports drift', () => {
  assert.deepEqual(service.verify(rfcSecret, '287082', new Date(89_000)), {
    counter: 1n,
    drift: -1,
  });
  assert.equal(service.verify(rfcSecret, '287082', new Date(119_000)), null);
});

test('rejects malformed codes and an already accepted counter', () => {
  assert.equal(service.verify(rfcSecret, '28708', new Date(59_000)), null);
  assert.equal(service.verify(rfcSecret, '287082', new Date(59_000), 1n), null);
});

test('creates a standard encoded otpauth URI', () => {
  const uri = service.buildUri({
    issuer: 'Chengye OA',
    accountName: 'root.admin@example.com',
    secret: rfcSecret,
  });
  assert.equal(
    uri,
    `otpauth://totp/Chengye%20OA:root.admin%40example.com?secret=${rfcSecret}&issuer=Chengye%20OA&algorithm=SHA1&digits=6&period=30`,
  );
});

test('generates a 160-bit Base32 secret', () => {
  const secret = service.generateSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.notEqual(secret, service.generateSecret());
});
