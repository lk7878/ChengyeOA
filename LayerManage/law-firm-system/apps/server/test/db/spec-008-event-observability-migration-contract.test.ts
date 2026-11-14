import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { EVENT_SUBSCRIPTION_CATALOG } from '../../app/domain/events/event-subscription-catalog';

const migrationsRoot = path.resolve('prisma/migrations');
const migrationName = '20260723090000_event_worker_runtime_status';
const migrationPath = path.join(migrationsRoot, migrationName, 'migration.sql');
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

test('adds exactly one additive event worker runtime status migration', () => {
  const migrationDirectories = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory());

  assert.equal(migrationDirectories.length, 45);
  assert.ok(migrationDirectories.some(entry => entry.name === migrationName));
  assert.equal([...sql.matchAll(/CREATE\s+TABLE\b/gi)].length, 1);
  assert.match(sql, /CREATE\s+TABLE\s+"event_worker_runtime_status"/i);
  assert.doesNotMatch(sql, /(?:ALTER|DROP|TRUNCATE)\s+TABLE\s+"event_(?:log|delivery|handler_log|subscription)"/i);
  assert.doesNotMatch(sql, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"event_(?:log|delivery|handler_log|subscription)"/i);
  assert.doesNotMatch(sql, /ON\s+DELETE|REFERENCES\s+"event_/i);
});

test('constrains the singleton slot, allowed lifecycle states, and optimistic version', () => {
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_pkey"\s+PRIMARY\s+KEY\s*\(\s*"slot"\s*\)/i);
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_primary_slot_check"\s+CHECK\s*\(\s*"slot"\s*=\s*'primary'\s*\)/i);
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_state_check"\s+CHECK\s*\(\s*"state"\s+IN\s*\(\s*'DISABLED'\s*,\s*'STARTING'\s*,\s*'RUNNING'\s*,\s*'STOPPED'\s*\)\s*\)/i);
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_version_check"\s+CHECK\s*\(\s*"version"\s*>=\s*1\s*\)/i);
});

test('requires state timestamps and keeps every lifecycle timestamp consistent', () => {
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_running_timestamps_check"\s+CHECK\s*\([\s\S]*"state"\s*<>\s*'RUNNING'[\s\S]*"lastHeartbeatAt"\s+IS\s+NOT\s+NULL[\s\S]*"lastSuccessfulTickAt"\s+IS\s+NOT\s+NULL[\s\S]*\)/i);
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_stopped_timestamp_check"\s+CHECK\s*\([\s\S]*"state"\s*<>\s*'STOPPED'[\s\S]*"lastStoppedAt"\s+IS\s+NOT\s+NULL[\s\S]*\)/i);
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_heartbeat_order_check"\s+CHECK\s*\([\s\S]*"lastHeartbeatAt"\s+IS\s+NULL[\s\S]*"lastHeartbeatAt"\s*>=\s*"processStartedAt"[\s\S]*\)/i);
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_successful_tick_order_check"\s+CHECK\s*\([\s\S]*"lastSuccessfulTickAt"\s+IS\s+NULL[\s\S]*"lastSuccessfulTickAt"\s*>=\s*"processStartedAt"[\s\S]*\)/i);
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_stopped_order_check"\s+CHECK\s*\([\s\S]*"lastStoppedAt"\s+IS\s+NULL[\s\S]*"lastStoppedAt"\s*>=\s*"processStartedAt"[\s\S]*\)/i);
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_stopped_after_heartbeat_check"\s+CHECK\s*\([\s\S]*"lastStoppedAt"\s+IS\s+NULL[\s\S]*"lastHeartbeatAt"\s+IS\s+NULL[\s\S]*"lastStoppedAt"\s*>=\s*"lastHeartbeatAt"[\s\S]*\)/i);
  assert.match(sql, /CONSTRAINT\s+"event_worker_runtime_status_stopped_after_successful_tick_check"\s+CHECK\s*\([\s\S]*"lastStoppedAt"\s+IS\s+NULL[\s\S]*"lastSuccessfulTickAt"\s+IS\s+NULL[\s\S]*"lastStoppedAt"\s*>=\s*"lastSuccessfulTickAt"[\s\S]*\)/i);
});

test('does not contain destructive statements for event data', () => {
  assert.doesNotMatch(sql, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM\s+"event_/i);
  assert.doesNotMatch(sql, /CASCADE/i);
});

// 常驻契约（SPEC-009 终审 F-1 根治）：迁移-only 库 event_subscription 与目录 parity。
// 测试夹具（test/helpers/test-database.ts）每次 reset 按目录全量播种订阅，从不暴露
// 迁移真实供给——T12 权限供给缺口（72≠87）与 F-1 订阅缺口（2≠3）同源逃逸。
// 本断言纯静态 grep 全部迁移 SQL（不起库）：目录每条订阅都必须有对应 INSERT 行
// （id/code/eventType/version/handlerCode/status 按目录逐字、按先例列序），
// 目录新增订阅而未同步供给迁移时本测试即红——与权限供给同一纪律的永久封闭。
test('every catalog event subscription is provisioned by a migration INSERT', () => {
  const allMigrationSql = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const filePath = path.join(migrationsRoot, entry.name, 'migration.sql');
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    })
    .join('\n');
  const literal = (value: string): string => `'${escapeRegExp(value)}'`;
  for (const entry of EVENT_SUBSCRIPTION_CATALOG) {
    const pattern = new RegExp([
      'INSERT\\s+INTO\\s+"event_subscription"',
      literal(entry.id),
      literal(entry.code),
      literal(entry.eventType),
      String(entry.eventVersion),
      literal(entry.handlerCode),
      literal(entry.status),
    ].join('[\\s\\S]*?'), 'i');
    assert.match(
      allMigrationSql,
      pattern,
      `catalog subscription ${entry.code} must be provisioned by a migration INSERT (id/code/eventType/version/handlerCode/status in catalog order)`,
    );
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
