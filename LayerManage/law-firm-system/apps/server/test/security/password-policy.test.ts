import assert from 'node:assert/strict';
import test from 'node:test';
import * as bcrypt from 'bcryptjs';
import {
  normalizeUsername,
  validatePassword,
  validateUsername,
} from '../../app/domain/security/password-policy';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';

test('normalizes and validates the bootstrap username', () => {
  assert.equal(normalizeUsername('  Root.Admin  '), 'root.admin');
  assert.doesNotThrow(() => validateUsername('root.admin'));
  assert.throws(() => validateUsername('\u4e2d\u6587\u7ba1\u7406\u5458'), /USERNAME_INVALID/);
  assert.throws(() => validateUsername('ab'), /USERNAME_INVALID/);
  assert.throws(() => validateUsername('root admin'), /USERNAME_INVALID/);
});

test('enforces the approved password policy', () => {
  assert.doesNotThrow(() => validatePassword('Correct-Horse-92', 'root.admin'));
  assert.doesNotThrow(() => validatePassword('Abcdefghij12', 'root.admin'));

  for (const value of [
    'short9A!',
    'root.admin-92A!',
    ' password-92A!',
    'password-92A! ',
    'password-92A!\n',
  ]) {
    assert.throws(() => validatePassword(value, 'root.admin'), /PASSWORD_INVALID/);
  }
});

test('rejects every mandated weak password case-insensitively', () => {
  for (const value of [
    'password123',
    'admin123456',
    'qwerty123456',
    '123456789012',
    'chengye123456',
    'chengyeoa123',
    'QwErTy123456',
  ]) {
    assert.throws(() => validatePassword(value, 'root.admin'), /PASSWORD_INVALID/);
  }
});

test('enforces the password length boundaries', () => {
  const prefix = 'Aa1!';
  assert.doesNotThrow(() => validatePassword(prefix + 'a'.repeat(8), 'root.admin'));
  assert.doesNotThrow(() => validatePassword(prefix + 'a'.repeat(124), 'root.admin'));
  assert.throws(() => validatePassword(prefix + 'a'.repeat(7), 'root.admin'), /PASSWORD_INVALID/);
  assert.throws(() => validatePassword(prefix + 'a'.repeat(125), 'root.admin'), /PASSWORD_INVALID/);
});

test('hashes and compares passwords through the shared hasher', async () => {
  const hasher = new BcryptPasswordHasher(4);
  const hash = await hasher.hash('Correct-Horse-92');

  assert.notEqual(hash, 'Correct-Horse-92');
  assert.equal(await hasher.compare('Correct-Horse-92', hash), true);
  assert.equal(await hasher.compare('Wrong-Horse-92', hash), false);
});

test('uses the versioned SHA-256 bcrypt format and distinguishes suffixes after 72 bytes', async () => {
  const hasher = new BcryptPasswordHasher(4);
  const sharedPrefix = 'A'.repeat(72);
  const first = `${sharedPrefix}1!suffix-one`;
  const second = `${sharedPrefix}1!suffix-two`;

  const hash = await hasher.hash(first);

  assert.match(hash, /^chengye\$bcrypt-sha256\$v1\$\$2[aby]\$/);
  assert.equal(await hasher.compare(first, hash), true);
  assert.equal(await hasher.compare(second, hash), false);
});

test('hashes the full UTF-8 content of a 128-character multibyte password', async () => {
  const hasher = new BcryptPasswordHasher(4);
  const password = `${'瀵'.repeat(124)}Aa1!`;
  const differentSuffix = `${'瀵'.repeat(124)}Aa2!`;

  assert.equal(Array.from(password).length, 128);
  const hash = await hasher.hash(password);
  assert.equal(await hasher.compare(password, hash), true);
  assert.equal(await hasher.compare(differentSuffix, hash), false);
});

test('continues to verify legacy raw bcrypt hashes', async () => {
  const hasher = new BcryptPasswordHasher(4);
  const legacyHash = await bcrypt.hash('Legacy-Horse-92!', 4);

  assert.equal(await hasher.compare('Legacy-Horse-92!', legacyHash), true);
  assert.equal(await hasher.compare('Wrong-Horse-92!', legacyHash), false);
});

test('fails closed for malformed and unknown version-marked hashes', async () => {
  const hasher = new BcryptPasswordHasher(4);

  for (const stored of [
    'chengye$bcrypt-sha256$v1$not-a-bcrypt-hash',
    'chengye$bcrypt-sha256$v2$$2a$04$invalid',
    'chengye$unknown$v1$$2a$04$invalid',
  ]) {
    assert.equal(await hasher.compare('Correct-Horse-92', stored), false);
  }
});
