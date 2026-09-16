import { expect, test } from 'vitest';
import { notificationTarget } from './notification-target';
import type { AuthorizationSummary } from '@/features/authorization/types';
const auth: AuthorizationSummary = {
  userId: 'u',
  employeeId: null,
  isSystemAdmin: false,
  isSystemSuperAdmin: false,
  permissions: ['approval.read', 'governance.catalog.read'],
  menus: ['menu.admin_governance'],
  evaluatedAt: new Date().toISOString(),
  validUntil: null,
  fieldCapabilities: {},
};
test('formal notification IDs preserve record identity and require current navigation authorization', () => {
  expect(
    notificationTarget(
      { relatedType: 'APPROVAL_INSTANCE', relatedId: 'id /?&', routeUrl: '/dashboard' },
      auth,
    ),
  ).toBe('/approvals?role=TODO&instance=id+%2F%3F%26');
  expect(notificationTarget({ relatedType: 'ADMIN_OPERATION', relatedId: 'op', routeUrl: null }, auth)).toBe(
    '/security/admin-governance?operationId=op',
  );
  expect(
    notificationTarget(
      { relatedType: 'APPROVAL_INSTANCE', relatedId: 'ap', routeUrl: null },
      { ...auth, permissions: [] },
    ),
  ).toBeNull();
  expect(notificationTarget({ routeUrl: '/approvals' }, { ...auth, validUntil: '2000-01-01' })).toBeNull();
});
test('untrusted notification routes cannot leave the app or introduce unknown destinations', () => {
  for (const routeUrl of [
    'https://example.org',
    '//example.org',
    '/\\example.org',
    '/unknown',
    'javascript:alert(1)',
  ])
    expect(notificationTarget({ routeUrl }, auth)).toBeNull();
  expect(notificationTarget({ routeUrl: '/approvals?instance=real' }, auth)).toBe('/approvals?instance=real');
});

test('SOP and quality notifications open original records only with current permissions', () => {
  for (const [relatedType, routeUrl, permission] of [
    ['SOP_TASK', '/sop/tasks/original-task', 'sop.task.read'],
    ['QUALITY_ISSUE', '/quality/issues/original-issue', 'quality.issue.read'],
  ] as const) {
    const row = { relatedType, relatedId: routeUrl.split('/').at(-1), routeUrl };
    expect(notificationTarget(row, { ...auth, permissions: [permission, 'case.read'], menus: ['menu.quality', 'menu.sop_tasks'] })).toBe(routeUrl);
    expect(notificationTarget(row, { ...auth, permissions: [], menus: [] })).toBeNull();
  }
});
