import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'prisma/migrations/20260718180000_employee_assignment_contract/migration.sql',
);

test('SPEC-003 contract migration exists', () => {
  assert.equal(fs.existsSync(migrationPath), true);
});

test('SPEC-003 contract migration validates assignments before removing legacy ownership', () => {
  if (!fs.existsSync(migrationPath)) {
    assert.fail('SPEC-003 contract migration is missing');
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');
  const validationEnd = sql.indexOf('ALTER TABLE "employee" DROP CONSTRAINT');
  assert.ok(validationEnd > 0, 'validation must run before destructive DDL');
  const validationSql = sql.slice(0, validationEnd);

  assert.match(validationSql, /WHERE e\."status" <> 'LEAVED'[\s\S]*HAVING count\(a\."id"\) <> 1/i);
  assert.match(validationSql, /RAISE EXCEPTION[\s\S]+active primary/i);
  assert.match(validationSql, /JOIN "position"[\s\S]+p\."orgId" <> a\."organizationId"/i);
  assert.match(validationSql, /RAISE EXCEPTION[\s\S]+position belongs to another organization/i);
  assert.match(sql, /ALTER TABLE "employee" DROP CONSTRAINT "employee_orgId_fkey"/);
  assert.match(sql, /ALTER TABLE "employee" DROP CONSTRAINT "employee_positionId_fkey"/);
  assert.match(sql, /ALTER TABLE "employee" DROP COLUMN "orgId"/);
  assert.match(sql, /ALTER TABLE "employee" DROP COLUMN "positionId"/);
});
