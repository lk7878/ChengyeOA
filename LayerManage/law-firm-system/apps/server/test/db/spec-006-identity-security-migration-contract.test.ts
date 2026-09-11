import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'prisma/migrations/20260721230000_identity_security_mfa_step_up/migration.sql',
);

function migrationSql(): string {
  assert.equal(fs.existsSync(migrationPath), true, 'SPEC-006 identity-security migration is missing');
  return fs.readFileSync(migrationPath, 'utf8');
}

test('SPEC-006 migration creates the five identity-security tables', () => {
  const sql = migrationSql();
  for (const table of [
    'mfa_factor', 'mfa_recovery_code', 'auth_challenge', 'auth_session', 'step_up_grant',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`, 'i'));
  }
});

test('SPEC-006 migration stores only encrypted or hashed credentials', () => {
  const sql = migrationSql();
  assert.match(sql, /"encryptedSecret"\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /"secretIv"\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /"secretAuthTag"\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /"refreshTokenHash"\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /"previousRefreshTokenHash"\s+TEXT/i);
  assert.match(sql, /"tokenHash"\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /"codeHash"\s+TEXT\s+NOT NULL/i);
  assert.doesNotMatch(sql, /"(?:secret|token|refreshToken|recoveryCode)"\s+TEXT/i);
});

test('SPEC-006 migration enforces uniqueness, lookup indexes, and state checks', () => {
  const sql = migrationSql();
  assert.match(sql, /mfa_factor_one_active_per_user[\s\S]*WHERE\s+"disabledAt"\s+IS\s+NULL/i);
  for (const index of [
    'mfa_recovery_code_codeHash_key',
    'auth_challenge_tokenHash_key',
    'auth_session_refreshTokenHash_key',
    'auth_session_previousRefreshTokenHash_key',
    'step_up_grant_tokenHash_key',
    'auth_challenge_userId_type_createdAt_idx',
    'auth_session_userId_expiresAt_idx',
    'step_up_grant_sessionId_expiresAt_idx',
  ]) {
    assert.match(sql, new RegExp(index, 'i'));
  }
  assert.match(sql, /mfa_factor_type_check[\s\S]*'TOTP'/i);
  assert.match(sql, /auth_challenge_type_check[\s\S]*'PASSWORD_CHANGE'[\s\S]*'MFA_ENROLLMENT'[\s\S]*'MFA_VERIFY'/i);
  assert.match(sql, /auth_session_assurance_level_check[\s\S]*'PASSWORD'[\s\S]*'MFA'/i);
  assert.match(sql, /auth_challenge_attempts_check/i);
  assert.match(sql, /step_up_grant_target_digest_check/i);
});

test('SPEC-006 migration uses restrictive user, factor, and session relations', () => {
  const sql = migrationSql();
  for (const constraint of [
    'mfa_factor_userId_fkey',
    'mfa_recovery_code_factorId_fkey',
    'auth_challenge_userId_fkey',
    'auth_session_userId_fkey',
    'step_up_grant_sessionId_fkey',
    'step_up_grant_userId_fkey',
  ]) {
    assert.match(sql, new RegExp(`${constraint}[\\s\\S]*ON DELETE RESTRICT`, 'i'));
  }
});
