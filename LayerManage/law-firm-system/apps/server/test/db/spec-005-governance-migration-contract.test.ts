import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'prisma/migrations/20260721120000_admin_governance_expand/migration.sql',
);

function migrationSql(): string {
  assert.equal(fs.existsSync(migrationPath), true, 'SPEC-005 governance migration is missing');
  return fs.readFileSync(migrationPath, 'utf8');
}

test('SPEC-005 migration creates append-only governance persistence', () => {
  const sql = migrationSql();

  for (const table of ['admin_operation', 'admin_operation_review', 'admin_operation_execution']) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`, 'i'));
  }
  assert.match(sql, /"payloadSnapshot"\s+JSONB\s+NOT NULL/i);
  assert.match(sql, /"beforeSnapshot"\s+JSONB/i);
  assert.match(sql, /"afterSnapshot"\s+JSONB/i);
  assert.match(sql, /admin_operation_requester_idempotency_key/i);
  assert.match(sql, /admin_operation_execution_operation_attempt_key/i);
  assert.match(sql, /admin_operation_status_check/i);
  assert.match(sql, /admin_operation_risk_level_check/i);
  assert.match(sql, /admin_operation_review_mode_check/i);
  assert.match(sql, /admin_operation_version_positive/i);
  assert.match(sql, /admin_operation_review_operation_version_positive/i);
  assert.match(sql, /admin_operation_execution_attempt_positive/i);
  assert.match(sql, /admin_operation_review_decision_check/i);
  assert.match(sql, /admin_operation_execution_status_check/i);
  assert.match(sql, /admin_operation_requesterUserId_fkey[\s\S]*ON DELETE RESTRICT/i);
  assert.match(sql, /admin_operation_review_reviewerUserId_fkey[\s\S]*ON DELETE RESTRICT/i);
  assert.match(sql, /admin_operation_execution_operationId_fkey[\s\S]*ON DELETE RESTRICT/i);
  assert.doesNotMatch(sql, /DROP TABLE\s+"approval"/i);
});

test('SPEC-005 migration expands role sources and installs only governed metadata', () => {
  const sql = migrationSql();

  assert.match(sql, /DROP CONSTRAINT\s+"user_role_source_check"/i);
  assert.match(sql, /user_role_source_check[\s\S]*'RECOVERY'/i);
  assert.match(sql, /user_role_validity_check[\s\S]*"source"\s*=\s*'RECOVERY'[\s\S]*"validUntil"\s+IS\s+NULL/i);
  assert.match(sql, /INSERT INTO\s+"permission"/i);
  for (const code of [
    'menu.admin_governance',
    'governance.catalog.read',
    'governance.operation.create',
    'governance.operation.read_self',
    'governance.operation.read_all',
    'governance.review',
    'governance.retry',
    'governance.audit.read',
  ]) {
    assert.match(sql, new RegExp(code.replace('.', '\\.'), 'i'));
  }
  assert.match(sql, /ON CONFLICT\s*\("code"\)\s*DO NOTHING/i);
  assert.match(sql, /'role:system-admin'[\s\S]*'SYSTEM_ADMIN'[\s\S]*WHERE EXISTS\s*\(SELECT 1 FROM "system_initialization" WHERE "id" = 'PRIMARY'\)/i);
  assert.doesNotMatch(sql, /INSERT INTO\s+"user_role"/i);
});
