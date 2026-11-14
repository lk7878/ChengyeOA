import { describe, expect, test } from 'vitest';
import { normalizeAuthorizationSummary } from './api';

describe('normalizeAuthorizationSummary', () => {
  test('maps backend codes and refreshes at the earliest finite grant expiry', () => {
    const summary = normalizeAuthorizationSummary({
      userId: 'user-1',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: true,
      evaluatedAt: '2026-07-19T00:00:00.000Z',
      permissionCodes: ['menu.organization', 'organization.read'],
      menuCodes: ['menu.organization'],
      grants: [
        { validUntil: null },
        { validUntil: '2026-07-21T00:00:00.000Z' },
        { validUntil: '2026-07-20T00:00:00.000Z' },
      ],
      fieldCapabilities: [],
    });

    expect(summary.permissions).toEqual(['menu.organization', 'organization.read']);
    expect(summary.isSystemAdmin).toBe(true);
    expect(summary.menus).toEqual(['menu.organization']);
    expect(summary.validUntil).toBe('2026-07-20T00:00:00.000Z');
  });

  test('reduces field rules using the union of readable roles', () => {
    const summary = normalizeAuthorizationSummary({
      userId: 'user-1', employeeId: 'employee-1', isSystemSuperAdmin: false, isSystemAdmin: false,
      evaluatedAt: '2026-07-19T00:00:00.000Z', permissionCodes: [], menuCodes: [], grants: [],
      fieldCapabilities: [
        { sourceRoleId: 'role-1', resource: 'employee', fieldCode: 'employee.phone', readLevel: 'READ', canWrite: true, canExport: true },
        { sourceRoleId: 'role-2', resource: 'employee', fieldCode: 'employee.phone', readLevel: 'NONE', canWrite: true, canExport: true },
      ],
    });

    expect(summary.fieldCapabilities['employee.phone']).toEqual({
      resource: 'employee', fieldCode: 'employee.phone', readLevel: 'READ', canWrite: true, canExport: true,
    });
  });
});
