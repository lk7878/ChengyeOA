import assert from 'node:assert/strict';
import test from 'node:test';
import * as jwt from 'jsonwebtoken';
import { JwtTokenService } from '../../app/domain/security/token-service';

const secret = '01234567890123456789012345678901';

test('binds a 15-minute access token to user, session, credential version, and assurance level', () => {
  const tokens = new JwtTokenService(secret);
  const token = tokens.signSessionAccess('user-1', 'session-1', 3, 'MFA');
  const claims = tokens.verifySessionAccess(token);
  const decoded = jwt.decode(token) as jwt.JwtPayload;

  assert.equal(claims.userId, 'user-1');
  assert.equal(claims.sessionId, 'session-1');
  assert.equal(claims.credentialVersion, 3);
  assert.equal(claims.assuranceLevel, 'MFA');
  assert.equal(claims.tokenType, 'access');
  assert.equal(decoded.exp! - decoded.iat!, 900);
});

test('does not expose legacy refresh, password-change, or sessionless access signers', () => {
  const tokens = new JwtTokenService(secret) as unknown as Record<string, unknown>;
  assert.equal('signRefresh' in tokens, false);
  assert.equal('signPasswordChange' in tokens, false);
  assert.equal('signAccess' in tokens, false);
});

test('preserves HS256 string-secret compatibility and rejects another signing key', () => {
  const tokens = new JwtTokenService(secret);
  const payload = {
    userId: 'user-1', sessionId: 'session-1', tokenType: 'access', credentialVersion: 3, assuranceLevel: 'MFA',
  };
  const existing = jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '15m' });
  assert.equal(tokens.verifySessionAccess(existing).sessionId, 'session-1');
  const issued = tokens.signSessionAccess('user-1', 'session-1', 3, 'MFA');
  assert.equal((jwt.verify(issued, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload).sessionId, 'session-1');
  const wrongKey = jwt.sign(payload, 'different-synthetic-signing-key', { algorithm: 'HS256', expiresIn: '15m' });
  assert.throws(() => tokens.verifySessionAccess(wrongKey), /TOKEN_INVALID/);
});

test('rejects invalid signatures and access tokens missing any required session claim', () => {
  const tokens = new JwtTokenService(secret);
  const missingSession = jwt.sign(
    { userId: 'user-1', tokenType: 'access', credentialVersion: 3, assuranceLevel: 'MFA' },
    secret,
    { algorithm: 'HS256', expiresIn: '15m' },
  );
  const wrongType = jwt.sign(
    { userId: 'user-1', sessionId: 'session-1', tokenType: 'refresh', credentialVersion: 3, assuranceLevel: 'MFA' },
    secret,
    { algorithm: 'HS256', expiresIn: '15m' },
  );

  assert.throws(() => tokens.verifySessionAccess('not-a-token'), /TOKEN_INVALID/);
  assert.throws(() => tokens.verifySessionAccess(missingSession), /TOKEN_INVALID/);
  assert.throws(() => tokens.verifySessionAccess(wrongType), /TOKEN_INVALID/);
});

test('rejects unexpected algorithms, missing expiry, and expired access tokens', () => {
  const tokens = new JwtTokenService(secret);
  const payload = {
    userId: 'user-1', sessionId: 'session-1', tokenType: 'access', credentialVersion: 3, assuranceLevel: 'MFA',
  };
  const hs512 = jwt.sign(payload, secret, { algorithm: 'HS512', expiresIn: '15m' });
  const noExpiry = jwt.sign(payload, secret, { algorithm: 'HS256' });
  const expired = jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: -1 });

  assert.throws(() => tokens.verifySessionAccess(hs512), /TOKEN_INVALID/);
  assert.throws(() => tokens.verifySessionAccess(noExpiry), /TOKEN_INVALID/);
  assert.throws(() => tokens.verifySessionAccess(expired), /TOKEN_INVALID/);
});
