import assert from 'node:assert/strict';
import test from 'node:test';
import * as jwt from 'jsonwebtoken';
import { JwtTokenService } from '../../app/domain/security/token-service';

const secret = '01234567890123456789012345678901';

test('binds each token to type, user and credential version', () => {
  const tokens = new JwtTokenService(secret);
  const token = tokens.signPasswordChange('user-1', 3);
  const claims = tokens.verify(token, ['password_change']);

  assert.equal(claims.userId, 'user-1');
  assert.equal(claims.credentialVersion, 3);
  assert.equal(claims.tokenType, 'password_change');
  assert.throws(() => tokens.verify(token, ['access']), /TOKEN_TYPE_INVALID/);
});

test('signs access and refresh tokens with their required types', () => {
  const tokens = new JwtTokenService(secret);

  assert.equal(tokens.verify(tokens.signAccess('user-1', 3), ['access']).tokenType, 'access');
  assert.equal(tokens.verify(tokens.signRefresh('user-1', 3), ['refresh']).tokenType, 'refresh');
});

test('rejects invalid signatures and tokens missing required claims', () => {
  const tokens = new JwtTokenService(secret);
  const missingCredentialVersion = jwt.sign({ userId: 'user-1', tokenType: 'access' }, secret);

  assert.throws(() => tokens.verify('not-a-token', ['access']), /TOKEN_INVALID/);
  assert.throws(() => tokens.verify(missingCredentialVersion, ['access']), /TOKEN_INVALID/);
});

test('rejects tokens signed with an unexpected algorithm', () => {
  const tokens = new JwtTokenService(secret);
  const hs512Token = jwt.sign(
    { userId: 'user-1', tokenType: 'access', credentialVersion: 3 },
    secret,
    { algorithm: 'HS512', expiresIn: '1h' },
  );

  assert.throws(() => tokens.verify(hs512Token, ['access']), /TOKEN_INVALID/);
});

test('rejects correctly signed tokens without an expiration claim', () => {
  const tokens = new JwtTokenService(secret);
  const tokenWithoutExpiry = jwt.sign(
    { userId: 'user-1', tokenType: 'access', credentialVersion: 3 },
    secret,
    { algorithm: 'HS256' },
  );

  assert.throws(() => tokens.verify(tokenWithoutExpiry, ['access']), /TOKEN_INVALID/);
});

test('rejects expired tokens signed with the expected algorithm', () => {
  const tokens = new JwtTokenService(secret);
  const expiredToken = jwt.sign(
    { userId: 'user-1', tokenType: 'access', credentialVersion: 3 },
    secret,
    { algorithm: 'HS256', expiresIn: -1 },
  );

  assert.throws(() => tokens.verify(expiredToken, ['access']), /TOKEN_INVALID/);
});
