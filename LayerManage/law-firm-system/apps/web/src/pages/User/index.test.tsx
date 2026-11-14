import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { userApi, roleApi } from '@/api/user';
import { useAuthStore } from '@/stores/authStore';
import UserPage from './index';

vi.mock('@/api/user', () => ({ userApi: { list: vi.fn(), delete: vi.fn() }, roleApi: { list: vi.fn() } }));

test('a branch super administrator can be deleted after confirmation while admin remains protected', async () => {
  useAuthStore.setState({ authorization: { userId: 'root', employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false, permissions: ['user.status.manage'], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() } });
  vi.mocked(roleApi.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } } });
  vi.mocked(userApi.list).mockResolvedValue({ code: 200, message: 'success', data: { list: [
    { id: 'disabled', username: 'branch-admin', status: 'DISABLED', createdAt: '2026-09-01', userRoles: [{ id: 'grant', userId: 'disabled', roleId: 'super', role: { id: 'super', name: '超级管理员', code: 'SYSTEM_SUPER_ADMIN', type: 'SYSTEM', status: 'ENABLED' } }] },
    { id: 'protected', username: 'admin', status: 'DISABLED', createdAt: '2026-09-01' },
  ], pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 } } });
  vi.mocked(userApi.delete).mockResolvedValue({ code: 200, message: 'success', data: null });
  render(<UserPage />);
  const branch = (await screen.findByText('branch-admin')).closest('tr')!;
  expect(within(screen.getByText('admin').closest('tr')!).getByRole('button', { name: /删\s*除/ })).toBeDisabled();
  fireEvent.click(within(branch).getByRole('button', { name: /删\s*除/ }));
  expect(userApi.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(userApi.delete).toHaveBeenCalledWith('disabled', { recipientUserId: undefined }));
});
