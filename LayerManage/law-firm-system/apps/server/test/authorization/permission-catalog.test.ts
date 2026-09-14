import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERMISSION_CATALOG,
  PERMISSION_CODES,
} from '../../app/domain/authorization/permission-catalog';

const FUTURE_SPECIAL_CODES = [
  'customer.merge',
  'refund.approve',
  'matter.intervene',
  'file.sensitive.download',
  'data.bulk_export',
  'config.publish',
  'config.high_risk.change',
] as const;

const GOVERNANCE_CODES = [
  'menu.admin_governance',
  'governance.catalog.read',
  'governance.operation.create',
  'governance.operation.read_self',
  'governance.operation.read_all',
  'governance.review',
  'governance.retry',
  'governance.audit.read',
] as const;

const EVENT_OPERATION_CODES = [
  'menu.event_operations',
  'event.delivery.read',
  'event.delivery.retry',
] as const;

test('catalog contains every unique immutable permission code exactly once', () => {
  assert.equal(PERMISSION_CODES.length, 146);
  assert.equal(new Set(PERMISSION_CODES).size, PERMISSION_CODES.length);
  assert.equal(PERMISSION_CATALOG.length, PERMISSION_CODES.length);
  assert.deepEqual(
    [...PERMISSION_CATALOG.map(item => item.code)].sort(),
    [...PERMISSION_CODES].sort(),
  );
  assert.equal(new Set(PERMISSION_CATALOG.map(item => item.id)).size, PERMISSION_CATALOG.length);
  assert.ok(PERMISSION_CATALOG.every(item => item.id === `permission:${item.code}`));
});

test('catalog registers the SPEC-007 event operations permission boundary', () => {
  for (const code of EVENT_OPERATION_CODES) {
    const entry = PERMISSION_CATALOG.find(item => item.code === code);
    assert.ok(entry, `${code} is missing`);
    assert.equal(entry.resource, code.startsWith('menu.') ? 'menu' : 'event_delivery');
    assert.equal(entry.riskLevel, code === 'event.delivery.retry' ? 'CRITICAL' : 'HIGH');
  }
});

test('catalog exposes only approved metadata values', () => {
  assert.ok(PERMISSION_CATALOG.every(item => ['MENU', 'ACTION', 'SPECIAL'].includes(item.type)));
  assert.ok(PERMISSION_CATALOG.every(item => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(item.riskLevel)));
  assert.ok(PERMISSION_CATALOG.every(item => item.status === 'ENABLED'));
  assert.ok(PERMISSION_CATALOG.every(item => item.resource.length > 0 && item.action.length > 0));
  assert.ok(PERMISSION_CATALOG.every(item => item.name.trim().length > 0));
});

test('future business permissions are inert SPECIAL catalog entries', () => {
  for (const code of FUTURE_SPECIAL_CODES) {
    const entry = PERMISSION_CATALOG.find(item => item.code === code);
    assert.ok(entry, `${code} is missing`);
    assert.equal(entry.type, 'SPECIAL');
    assert.equal(entry.route, null);
  }
});

test('catalog includes organization and high-sensitive employee permissions', () => {
  assert.ok(PERMISSION_CATALOG.some(item => item.code === 'organization.read'));
  assert.ok(PERMISSION_CATALOG.some(item => item.code === 'employee.high_sensitive.read'));
});

test('catalog registers every SPEC-005 governance permission on the governance resource', () => {
  for (const code of GOVERNANCE_CODES) {
    const entry = PERMISSION_CATALOG.find(item => item.code === code);
    assert.ok(entry, `${code} is missing`);
    assert.equal(entry.resource, code.startsWith('menu.') ? 'menu' : 'governance');
    assert.equal(entry.status, 'ENABLED');
  }
});
