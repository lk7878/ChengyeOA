import assert from 'node:assert/strict';
import test from 'node:test';
import { PERMISSION_CODES } from '../../app/domain/authorization/permission-catalog';
import { SYSTEM_ADMIN_PERMISSION_CODES } from '../../app/domain/admin-governance/system-admin-permissions';

test('SYSTEM_ADMIN uses an immutable explicit permission allowlist', () => {
  assert.equal(Object.isFrozen(SYSTEM_ADMIN_PERMISSION_CODES), true);
  assert.deepEqual(SYSTEM_ADMIN_PERMISSION_CODES, [
    'menu.admin_governance',
    'governance.catalog.read',
    'governance.operation.create',
    'governance.operation.read_self',
    'governance.audit.read',
    'organization.read',
    'position.read',
    'professional_team.read',
    'permission.trace.self',
    'menu.event_operations',
    'event.delivery.read',
  ]);
  assert.equal(new Set(SYSTEM_ADMIN_PERMISSION_CODES).size, SYSTEM_ADMIN_PERMISSION_CODES.length);
  assert.ok(SYSTEM_ADMIN_PERMISSION_CODES.every(code => PERMISSION_CODES.includes(code)));
});

test('SYSTEM_ADMIN excludes review, retry, all-operation, and legacy escalation permissions', () => {
  for (const prohibited of [
    'governance.review',
    'governance.retry',
    'governance.operation.read_all',
    'user.role.manage',
    'role.permission.manage',
  ]) {
    assert.equal(SYSTEM_ADMIN_PERMISSION_CODES.includes(prohibited as never), false);
  }
  assert.equal(SYSTEM_ADMIN_PERMISSION_CODES.includes('employee.read' as never), false);
  assert.equal(SYSTEM_ADMIN_PERMISSION_CODES.includes('event.delivery.retry' as never), false);
});
