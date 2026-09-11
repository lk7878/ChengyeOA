import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIELD_CODES,
  PERMISSION_CODES,
  RESOURCE_CODES,
} from '../../app/domain/authorization/authorization-types';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';

// SPEC-009 Task 2: 权限类型与目录扩充（CRM 线索/邀约/客户）契约测试。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/crm/permission-catalog-crm.test.ts

const NEW_RESOURCE_CODES = ['lead', 'appointment', 'campaign'] as const;
const NEW_FIELD_CODES = ['lead.phone', 'lead.wechat', 'customer.phone', 'customer.wechat'] as const;
const NEW_PERMISSION_CODES = [
  'menu.lead_crm',
  'menu.customer',
  'lead.read',
  'lead.create',
  'lead.update',
  'lead.assign',
  'lead.recycle',
  'lead.convert',
  'lead.pool.claim',
  'appointment.read',
  'appointment.create',
  'appointment.visit',
  'customer.read',
  'customer.create',
  'customer.update',
] as const;

const VALID_PERMISSION_TYPES = ['MENU', 'ACTION', 'SPECIAL'] as const;
const VALID_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

test('RESOURCE_CODES registers the CRM lead/appointment/campaign resources', () => {
  const resources = new Set(RESOURCE_CODES);
  for (const code of NEW_RESOURCE_CODES) {
    assert.ok(resources.has(code), `resource ${code} must be registered`);
  }
  assert.ok(resources.has('customer'), 'customer resource must still be registered');
});

test('FIELD_CODES registers the lead/customer phone/wechat L3 field codes', () => {
  const fields = new Set(FIELD_CODES);
  for (const code of NEW_FIELD_CODES) {
    assert.ok(fields.has(code), `field ${code} must be registered`);
  }
});

test('PERMISSION_CODES registers every new CRM permission code', () => {
  const codes = new Set(PERMISSION_CODES);
  for (const code of NEW_PERMISSION_CODES) {
    assert.ok(codes.has(code), `permission ${code} must be registered`);
  }
});

test('PERMISSION_CODES keeps customer.merge as a reserved placeholder code', () => {
  assert.ok(
    PERMISSION_CODES.includes('customer.merge' as never),
    'customer.merge must remain registered as a placeholder',
  );
});

test('PERMISSION_CATALOG has no duplicate permission codes', () => {
  const codes = PERMISSION_CATALOG.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length, 'duplicate permission codes found in catalog');
});

test('PERMISSION_CATALOG keeps customer.merge as an inert SPECIAL placeholder entry', () => {
  const entry = PERMISSION_CATALOG.find((item) => item.code === 'customer.merge');
  assert.ok(entry, 'customer.merge catalog entry must exist');
  assert.equal(entry.type, 'SPECIAL');
  assert.equal(entry.route, null);
});

test('PERMISSION_CATALOG registers a catalog entry for every new CRM permission code', () => {
  const byCode = new Map(PERMISSION_CATALOG.map((item) => [item.code, item]));
  for (const code of NEW_PERMISSION_CODES) {
    const entry = byCode.get(code);
    assert.ok(entry, `${code} must have a catalog entry`);
  }
});

test('every new CRM ACTION permission references a registered resource with valid type/riskLevel', () => {
  const resources = new Set(RESOURCE_CODES);
  const validTypes = new Set(VALID_PERMISSION_TYPES);
  const validRisks = new Set(VALID_RISK_LEVELS);
  const actionCodes = NEW_PERMISSION_CODES.filter((code) => !code.startsWith('menu.'));
  const byCode = new Map(PERMISSION_CATALOG.map((item) => [item.code, item]));

  for (const code of actionCodes) {
    const entry = byCode.get(code);
    assert.ok(entry, `${code} must have a catalog entry`);
    assert.equal(entry.type, 'ACTION', `${code} must be an ACTION permission`);
    assert.ok(
      resources.has(entry.resource),
      `${code} resource ${entry.resource} must be in RESOURCE_CODES`,
    );
    assert.ok(validTypes.has(entry.type), `${code} has invalid type ${entry.type}`);
    assert.ok(validRisks.has(entry.riskLevel), `${code} has invalid riskLevel ${entry.riskLevel}`);
    assert.equal(entry.route, null, `${code} ACTION permission must not declare a route`);
  }
});

test('new CRM MENU permissions route to the lead/customer pages', () => {
  const byCode = new Map(PERMISSION_CATALOG.map((item) => [item.code, item]));
  const leadCrm = byCode.get('menu.lead_crm');
  assert.ok(leadCrm);
  assert.equal(leadCrm.type, 'MENU');
  assert.equal(leadCrm.resource, 'menu');
  assert.equal(leadCrm.route, '/leads');

  const customer = byCode.get('menu.customer');
  assert.ok(customer);
  assert.equal(customer.type, 'MENU');
  assert.equal(customer.resource, 'menu');
  assert.equal(customer.route, '/customers');
});

test('PERMISSION_CATALOG length matches PERMISSION_CODES length (no orphan or missing entries)', () => {
  assert.equal(PERMISSION_CATALOG.length, PERMISSION_CODES.length);
  assert.deepEqual(
    [...PERMISSION_CATALOG.map((item) => item.code)].sort(),
    [...PERMISSION_CODES].sort(),
  );
});
