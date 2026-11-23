import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { authorizationAdminApi } from '@/features/authorization/admin-api';
import { contractApi } from '@/api/contract';
import request from '@/api/request';
import ContractReadGrantsPage from './ContractReadGrants';

vi.mock('@/api/request', () => ({ default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/api/contract', () => ({ contractApi: { list: vi.fn() } }));
vi.mock('@/features/authorization/admin-api', () => ({ authorizationErrorMessage: String, authorizationAdminApi: { users: { list: vi.fn() } } }));

beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({ authorization: { userId: 'admin', employeeId: null, isSystemSuperAdmin: true,
    isSystemAdmin: false, permissions: [], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() } });
});

test('selects the named account, confirms grant and revoke, and reloads the exact contract', async () => {
  const user = { id: 'lawyer', username: 'test-user', employee: { id: 'e', name: '测试律师' }, status: 'ENABLED', lastLoginAt: null };
  vi.mocked(authorizationAdminApi.users.list).mockResolvedValue({ list: [user], pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } });
  const contract = { id: 'selected', contractNo: 'TEST-1', title: '测试合同', deletedAt: null };
  vi.mocked(contractApi.list).mockResolvedValue({ data: { list: [contract] } } as never);
  vi.mocked(request.get).mockResolvedValueOnce({ data: [] })
    .mockResolvedValueOnce({ data: [{ createdAt: '2026-01-01', contract }] })
    .mockResolvedValueOnce({ data: [] });
  render(<ContractReadGrantsPage/>);
  const people = screen.getByRole('combobox', { name: '按账号或姓名搜索人员' });
  fireEvent.mouseDown(people);
  fireEvent.change(people, { target: { value: '测试律师' } });
  fireEvent.click(await screen.findByText('测试律师（test-user）'));
  expect(authorizationAdminApi.users.list).toHaveBeenCalledWith({ keyword: '测试律师', pageSize: 50 });
  const contracts = screen.getByRole('combobox', { name: '搜索合同编号或名称' });
  fireEvent.mouseDown(contracts);
  fireEvent.click(await screen.findByText('TEST-1 · 测试合同'));
  fireEvent.click(screen.getByRole('button', { name: '授予只读权限' }));
  expect(request.put).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: '确认授予' }));
  const url = '/v1/authorization/users/lawyer/contract-read-grants/selected';
  await waitFor(() => expect(request.put).toHaveBeenCalledWith(url));
  fireEvent.click(await screen.findByRole('button', { name: /撤\s*销/ }));
  expect(request.delete).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: '确认撤销' }));
  await waitFor(() => expect(request.delete).toHaveBeenCalledWith(url));
  expect(await screen.findByText('该账号暂无单份合同授权')).toBeInTheDocument();
});

test('a non-super administrator cannot open this page or query staff', () => {
  const auth = useAuthStore.getState().authorization!;
  useAuthStore.setState({ authorization: { ...auth, isSystemAdmin: true, isSystemSuperAdmin: false } });
  render(<ContractReadGrantsPage/>);
  expect(screen.getByText('仅超级管理员可管理单份合同授权')).toBeInTheDocument();
  expect(authorizationAdminApi.users.list).not.toHaveBeenCalled();
});
