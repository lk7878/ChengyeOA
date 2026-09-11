import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import SecurityUserPage from './index';
import { authorizationAdminApi } from '@/features/authorization/admin-api';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/features/authorization/admin-api', () => ({ authorizationAdminApi: {
  users: { list: vi.fn(), authorization: vi.fn(), grantRole: vi.fn(), revokeRole: vi.fn(), grantSpecial: vi.fn(), revokeSpecial: vi.fn() },
  roles: { list: vi.fn() }, catalogs: { permissions: vi.fn(), dataScopes: vi.fn() },
} }));

const page = { list: [{ id: 'self-user', username: 'admin', status: 'ENABLED', employee: null, lastLoginAt: null }, { id: 'target-user', username: 'lawyer', status: 'ENABLED', employee: null, lastLoginAt: null }], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 } };

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ authorization: { userId: 'self-user', employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false, permissions: [], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() } });
  vi.mocked(authorizationAdminApi.users.list).mockResolvedValue(page);
  vi.mocked(authorizationAdminApi.roles.list).mockResolvedValue({ list: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
  vi.mocked(authorizationAdminApi.catalogs.permissions).mockResolvedValue([]);
  vi.mocked(authorizationAdminApi.catalogs.dataScopes).mockResolvedValue([]);
  vi.mocked(authorizationAdminApi.users.authorization).mockResolvedValue({ userId: 'target-user', status: 'ENABLED', roleGrants: [], specialGrants: [] });
});

test('disables self modification and opens the audited grant workflow for another user', async () => {
  render(<SecurityUserPage />);
  expect(await screen.findByRole('button', { name: '管理 admin 的授权' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '管理 lawyer 的授权' }));
  await waitFor(() => expect(authorizationAdminApi.users.authorization).toHaveBeenCalledWith('target-user'));
  expect(await screen.findByRole('button', { name: '授予角色' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '授予角色' }));
  expect(await screen.findByText('授权期限')).toBeInTheDocument();
  expect(screen.getByText('长期')).toBeInTheDocument();
  expect(screen.getByText('临时')).toBeInTheDocument();
});
