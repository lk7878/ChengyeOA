import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import PermissionTracePage from './index';
import { authorizationAdminApi } from '@/features/authorization/admin-api';

vi.mock('@/features/authorization/admin-api', () => ({ authorizationAdminApi: {
  catalogs: { permissions: vi.fn() }, users: { list: vi.fn() }, trace: { user: vi.fn() },
} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authorizationAdminApi.catalogs.permissions).mockResolvedValue([]);
  vi.mocked(authorizationAdminApi.users.list).mockResolvedValue({ list: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
});

test('shows authorization provenance without rendering sensitive field values', async () => {
  vi.mocked(authorizationAdminApi.trace.user).mockResolvedValue({ userId: 'user-1', employeeId: 'employee-1', permissionCode: 'employee.read', allowed: false, refusalCode: 'PERMISSION_DENIED', evaluatedAt: '2026-07-19T00:00:00.000Z', sources: [{ sourceType: 'ROLE', sourceId: 'grant-1', permissionCode: 'employee.read', scopeTypes: ['BRANCH'], validUntil: '2026-08-01T00:00:00.000Z', state: 'ACTIVE' }], fieldCapabilities: [{ sourceRoleId: 'role-1', resource: 'employee', fieldCode: 'employee.phone', readLevel: 'MASKED', canWrite: false, canExport: false }] });
  render(<PermissionTracePage initialUserId="user-1" initialPermissionCode="employee.read" />);
  expect(await screen.findByText('PERMISSION_DENIED')).toBeInTheDocument();
  expect(screen.getByText('角色')).toBeInTheDocument();
  expect(screen.getByText('指定分所')).toBeInTheDocument();
  expect(screen.getByText('脱敏读取')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('13800000000');
});
