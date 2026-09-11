import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'prisma/migrations/20260718220000_authorization_contract/migration.sql',
);

test('SPEC-004 contract migration exists', () => {
  assert.equal(fs.existsSync(migrationPath), true);
});

test('contract migration fails closed before installing final constraints', () => {
  if (!fs.existsSync(migrationPath)) assert.fail('SPEC-004 contract migration is missing');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const firstDdl = sql.indexOf('CREATE OR REPLACE FUNCTION');
  assert.ok(firstDdl > 0, 'preflight validation must precede contract DDL');
  const preflight = sql.slice(0, firstDdl);

  assert.match(preflight, /active permission metadata/i);
  assert.match(preflight, /overlapping active user role/i);
  assert.match(preflight, /invalid data scope/i);
  assert.match(preflight, /empty custom data scope/i);
  assert.match(preflight, /overlapping active special grant/i);
  assert.match(preflight, /reporting line cycle/i);
  assert.match(preflight, /system super admin trust root/i);
  assert.doesNotMatch(preflight, /DELETE\s+FROM/i);
});

test('contract migration enforces cross-table scope and reporting invariants', () => {
  if (!fs.existsSync(migrationPath)) assert.fail('SPEC-004 contract migration is missing');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /CREATE CONSTRAINT TRIGGER "data_scope_contract_on_scope"/i);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER "data_scope_contract_on_target"/i);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/i);
  assert.match(sql, /CUSTOM data scope requires at least one target/i);
  assert.match(sql, /BRANCH data scope requires a BRANCH organization/i);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER "employee_reporting_line_acyclic"/i);
  assert.match(sql, /role_permission_roleId_fkey[\s\S]*ON DELETE RESTRICT/i);
  assert.match(sql, /role_permission_permissionId_fkey[\s\S]*ON DELETE RESTRICT/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
});
