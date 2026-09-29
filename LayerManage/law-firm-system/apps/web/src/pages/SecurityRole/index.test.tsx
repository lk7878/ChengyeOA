import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import SecurityRolePage from './index';
import { authorizationAdminApi } from '@/features/authorization/admin-api';
import type { RoleAuthorizationView } from '@/features/authorization/types';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/features/authorization/admin-api', () => ({ authorizationAdminApi: {
  roles: { list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), enable: vi.fn(), disable: vi.fn(), remove: vi.fn(), replacePermissions: vi.fn(), replaceDataScopes: vi.fn(), replaceFieldPermissions: vi.fn(), members: vi.fn() },
  users: { list: vi.fn(), grantRole: vi.fn(), revokeRole: vi.fn() },
  catalogs: { permissions: vi.fn(), fields: vi.fn(), dataScopes: vi.fn(), createDataScope: vi.fn() },
} }));

const role: RoleAuthorizationView = { id: 'role-1', name: '重庆分所负责人', code: 'CQ_MANAGER', type: 'BUSINESS', description: null, status: 'ENABLED', version: 2, permissionCodes: ['employee.read'], dataScopeBindings: [], fieldPermissions: [] };

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ authorization: { userId: 'root', employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false, permissions: [], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() } });
  vi.mocked(authorizationAdminApi.roles.list).mockResolvedValue({ list: [role], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
  vi.mocked(authorizationAdminApi.catalogs.permissions).mockResolvedValue([{ id: 'permission:employee.read', code: 'employee.read', name: '查看员工', type: 'ACTION', resource: 'employee', action: 'read', riskLevel: 'MEDIUM', status: 'ENABLED', route: null }]);
  vi.mocked(authorizationAdminApi.catalogs.fields).mockResolvedValue([]);
  vi.mocked(authorizationAdminApi.catalogs.dataScopes).mockResolvedValue([]);
  vi.mocked(authorizationAdminApi.roles.disable).mockResolvedValue({ ...role, status: 'DISABLED', version: 3 });
  vi.mocked(authorizationAdminApi.roles.members).mockResolvedValue([
    { id: 'member-1', userId: 'user-1', username: 'zhang', userStatus: 'ENABLED', source: 'PERMANENT', validFrom: '2026-07-18T00:00:00.000Z', validUntil: null, revokedAt: null, version: 1, state: 'ACTIVE' },
  ]);
  vi.mocked(authorizationAdminApi.users.list).mockResolvedValue({ list: [{ id: 'user-2', username: 'li', status: 'ENABLED', employee: null, lastLoginAt: null }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
});

test('edits immutable role code and supports status changes and deletion', async () => {
  render(<SecurityRolePage />);
  expect(await screen.findByText('重庆分所负责人')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /删\s*除/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /编辑重庆分所负责人/ }));
  expect(await screen.findByLabelText('角色代码')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '停用角色' }));
  await waitFor(() => expect(authorizationAdminApi.roles.disable).toHaveBeenCalledWith('role-1', 2));
});

test('deletes a business role only after confirmation with its current version', async () => {
  render(<SecurityRolePage />);
  fireEvent.click(await screen.findByRole('button', { name: /删\s*除/ }));
  expect(authorizationAdminApi.roles.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(authorizationAdminApi.roles.remove).toHaveBeenCalledWith('role-1', 2));
});

test('members tab lists role members and adds a member via grantRole', async () => {
  render(<SecurityRolePage />);
  fireEvent.click(await screen.findByRole('button', { name: /编辑重庆分所负责人/ }));
  fireEvent.click(await screen.findByRole('tab', { name: '成员' }));
  // 成员列表加载并显示。
  expect(await screen.findByText('zhang')).toBeInTheDocument();
  expect(authorizationAdminApi.roles.members).toHaveBeenCalledWith('role-1');
  // 添加成员：选用户 → 提交（按钮 icon 拼入 accessible name，用模糊匹配）。
  fireEvent.click(screen.getByRole('button', { name: /添\s*加\s*成\s*员/ }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '用户' }));
  fireEvent.click(await screen.findByText('li'));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '授权类型' }));
  fireEvent.click(await screen.findByText('永久'));
  fireEvent.click(screen.getByRole('button', { name: /确\s*定|OK/ }));
  await waitFor(() => expect(authorizationAdminApi.users.grantRole).toHaveBeenCalledWith('user-2', expect.objectContaining({ roleId: 'role-1', source: 'PERMANENT' })));
});

test('members tab requires user_role.membership.manage (or super admin) to manage members', async () => {
  useAuthStore.setState({ authorization: { userId: 'root', employeeId: null, isSystemSuperAdmin: false, isSystemAdmin: false, permissions: ['role.read'], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() } });
  render(<SecurityRolePage />);
  fireEvent.click(await screen.findByRole('button', { name: /编辑重庆分所负责人/ }));
  fireEvent.click(await screen.findByRole('tab', { name: '成员' }));
  await waitFor(() => expect(authorizationAdminApi.roles.members).toHaveBeenCalledWith('role-1'));
  expect(await screen.findByText('zhang')).toBeInTheDocument();
  // 无委派码时「添加成员」按钮不出现、移除按钮禁用。
  expect(screen.queryByRole('button', { name: /添\s*加\s*成\s*员/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /移\s*除/ })).toBeDisabled();
}, 90000);
