import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuthorizationContext,
  AuthorizationService,
} from '../../app/application/authorization/authorization-service';

function context(permissionCodes: AuthorizationContext['permissionCodes']): AuthorizationContext {
  return {
    userId: 'user-1',
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: [],
    fieldRules: [],
    permissionCodes,
    evaluatedAt: new Date('2026-07-18T12:00:00.000Z'),
  };
}

test('allows registered actions present in the real-time context', () => {
  const service = new AuthorizationService();
  assert.doesNotThrow(() => service.requireAction(context(['organization.read']), 'organization.read'));
  assert.deepEqual(service.allowedActions(context(['organization.read']), 'organization'), ['organization.read']);
});

test('uses stable denial codes for missing ordinary and special actions', () => {
  const service = new AuthorizationService();
  assert.throws(
    () => service.requireAction(context([]), 'organization.read'),
    error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PERMISSION_DENIED'),
  );
  assert.throws(
    () => service.requireAction(context([]), 'employee.high_sensitive.read'),
    error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'SPECIAL_PERMISSION_REQUIRED'),
  );
});
