import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'prisma/migrations/20260718210000_authorization_expand/migration.sql',
);

test('SPEC-004 expand migration exists', () => {
  assert.equal(fs.existsSync(migrationPath), true);
});

test('expand migration installs authorization constraints and only system metadata', () => {
  if (!fs.existsSync(migrationPath)) {
    assert.fail('SPEC-004 expand migration is missing');
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS btree_gist/i);
  assert.match(sql, /EXCLUDE USING gist[\s\S]+tstzrange/i);
  assert.match(sql, /employee_reporting_line_one_current_manager/i);
  assert.match(sql, /data_scope_shape_check/i);
  assert.match(sql, /data_scope_target_exactly_one_check/i);
  assert.match(sql, /employee_reporting_line_no_self_manager/i);
  assert.match(sql, /INSERT INTO "permission"/i);
  assert.doesNotMatch(
    sql,
    /INSERT INTO "(?:organization|employee|professional_team|data_scope|role|role_permission|user_role)"/i,
  );
});

test('expand migration preserves history and disables unknown prototype permissions', () => {
  if (!fs.existsSync(migrationPath)) {
    assert.fail('SPEC-004 expand migration is missing');
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /UPDATE "user_role"[\s\S]+"source"\s*=\s*'PERMANENT'/i);
  assert.match(sql, /UPDATE "permission"[\s\S]+"resource"\s*=\s*'legacy'[\s\S]+"status"\s*=\s*'DISABLED'/i);
  assert.match(sql, /ON CONFLICT \("code"\) DO UPDATE/i);
  assert.doesNotMatch(sql, /DELETE FROM "(?:permission|user_role)"/i);
});
