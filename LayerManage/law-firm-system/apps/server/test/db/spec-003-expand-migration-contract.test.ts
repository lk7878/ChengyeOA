import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'prisma/migrations/20260718120000_organization_personnel_expand/migration.sql',
);

test('SPEC-003 expand migration exists', () => {
  assert.equal(fs.existsSync(migrationPath), true);
});

test('SPEC-003 expand migration backfills root identity and relationship constraints', () => {
  if (!fs.existsSync(migrationPath)) {
    assert.fail('SPEC-003 expand migration is missing');
  }
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /UPDATE "organization"[\s\S]+"code"\s*=\s*'ROOT'/);
  assert.match(sql, /WITH RECURSIVE tree/);
  assert.match(sql, /employee_assignment_one_active_primary/);
  assert.match(sql, /employee_assignment_one_active_tuple/);
  assert.match(sql, /professional_team_member_one_active_member/);
  assert.match(sql, /professional_team_member_one_active_lead/);
  assert.doesNotMatch(sql, /INSERT INTO "(?:organization|position|employee|professional_team)"/i);
});
