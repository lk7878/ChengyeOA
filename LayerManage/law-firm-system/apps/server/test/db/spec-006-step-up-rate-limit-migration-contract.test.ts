import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'prisma/migrations/20260722010000_step_up_rate_limit/migration.sql',
);

test('Step-Up rate-limit migration adds bounded session failure state', () => {
  assert.equal(fs.existsSync(migrationPath), true, 'Step-Up rate-limit migration is missing');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE "auth_session"[\s\S]*"stepUpFailedAttempts" INTEGER NOT NULL DEFAULT 0/i);
  assert.match(sql, /ALTER TABLE "auth_session"[\s\S]*"stepUpBlockedUntil" TIMESTAMPTZ\(3\)/i);
  assert.match(sql, /auth_session_step_up_attempts_check/i);
});
