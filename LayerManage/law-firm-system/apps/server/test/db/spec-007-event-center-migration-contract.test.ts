import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'prisma/migrations/20260722120000_reliable_event_center/migration.sql',
);

function migrationSql(): string {
  assert.equal(fs.existsSync(migrationPath), true, 'SPEC-007 event-center migration is missing');
  return fs.readFileSync(migrationPath, 'utf8');
}

test('migration owns the event schema and pilot subscription', () => {
  const sql = migrationSql();

  for (const table of ['event_log', 'event_subscription', 'event_delivery', 'event_handler_log']) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`, 'i'));
  }
  assert.match(sql, /UNIQUE\s*\("eventId",\s*"handlerCode"\)/i);
  assert.match(sql, /admin-operation-reviewed-notification-v1/i);
  assert.match(sql, /ON CONFLICT\s*\("code"\)\s*DO NOTHING/i);
  assert.match(sql, /event\.delivery\.retry/i);
});

test('migration enforces delivery evidence constraints and restrictive foreign keys', () => {
  const sql = migrationSql();

  for (const constraint of [
    'event_subscription_status_check',
    'event_delivery_status_check',
    'event_delivery_counters_non_negative',
    'event_delivery_lease_fields_check',
    'event_delivery_retry_wait_next_attempt_check',
    'event_delivery_succeeded_completion_check',
    'event_handler_log_outcome_check',
    'event_handler_log_duration_non_negative',
  ]) {
    assert.match(sql, new RegExp(constraint, 'i'));
  }
  assert.match(sql, /event_delivery_counters_non_negative[\s\S]*"attemptCount"\s*>=\s*0[\s\S]*"manualRetryCount"\s*>=\s*0[\s\S]*"version"\s*>=\s*0/i);
  assert.match(sql, /event_delivery_lease_fields_check[\s\S]*"status"\s*=\s*'PROCESSING'[\s\S]*"lockedBy"\s+IS NOT NULL[\s\S]*"lockedUntil"\s+IS NOT NULL/i);
  assert.match(sql, /event_delivery_retry_wait_next_attempt_check[\s\S]*"status"\s*=\s*'RETRY_WAIT'[\s\S]*"nextAttemptAt"\s+IS NOT NULL/i);
  assert.match(sql, /event_delivery_succeeded_completion_check[\s\S]*"status"\s*=\s*'SUCCEEDED'[\s\S]*"completedAt"\s+IS NOT NULL/i);
  const foreignKeys = [...sql.matchAll(/ALTER TABLE "[^"]+" ADD CONSTRAINT "[^"]+_fkey"[\s\S]*?;/gi)]
    .map(match => match[0]);
  for (const constraint of [
    'event_log_operatorUserId_fkey',
    'event_log_organizationId_fkey',
    'event_log_branchId_fkey',
    'event_log_teamId_fkey',
    'event_delivery_eventId_fkey',
    'event_delivery_subscriptionId_fkey',
    'event_handler_log_deliveryId_fkey',
  ]) {
    const statement = foreignKeys.find(candidate => candidate.includes(`"${constraint}"`));
    assert.ok(statement, `${constraint} statement is missing`);
    assert.match(statement, /ON DELETE RESTRICT/i);
  }
  assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
});

test('migration installs stable permissions with the approved role boundary', () => {
  const sql = migrationSql();

  for (const code of ['menu.event_operations', 'event.delivery.read', 'event.delivery.retry']) {
    assert.match(sql, new RegExp(`permission:${code.replaceAll('.', '\\.')}`, 'i'));
  }
  const grantStatements = [...sql.matchAll(/INSERT INTO "role_permission"[\s\S]*?;/gi)]
    .map(match => match[0]);
  const adminGrant = grantStatements.find(statement => /role\."code"\s*=\s*'SYSTEM_ADMIN'/i.test(statement));
  const superAdminGrant = grantStatements.find(statement => /role\."code"\s*=\s*'SYSTEM_SUPER_ADMIN'/i.test(statement));
  assert.ok(adminGrant, 'SYSTEM_ADMIN role-permission grant is missing');
  assert.ok(superAdminGrant, 'SYSTEM_SUPER_ADMIN role-permission grant is missing');
  assert.match(adminGrant, /permission\."code"\s+IN\s*\([^)]*menu\.event_operations[^)]*event\.delivery\.read/i);
  assert.doesNotMatch(adminGrant, /event\.delivery\.retry/i);
  const superAdminCodes = superAdminGrant.match(/permission\."code"\s+IN\s*\(([^)]*)\)/i)?.[1]
    .match(/'[^']+'/g)?.map(code => code.slice(1, -1)).sort();
  assert.deepEqual(superAdminCodes, [
    'event.delivery.read',
    'event.delivery.retry',
    'menu.event_operations',
  ]);
});

test('migration adds nullable notification idempotency compatibility fields', () => {
  const sql = migrationSql();

  assert.match(sql, /ALTER TABLE "notification" ADD COLUMN\s+"deduplicationKey"\s+TEXT/i);
  assert.match(sql, /ALTER TABLE "notification" ADD COLUMN\s+"routeUrl"\s+TEXT/i);
  assert.match(sql, /notification_deduplicationKey_key/i);
});
