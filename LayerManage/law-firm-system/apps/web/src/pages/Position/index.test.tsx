import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { masterDataApi } from '@/features/master-data/api';
import type { OrganizationNode } from '@/features/master-data/types';
import PositionPage from './index';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/features/master-data/api', () => ({ masterDataApi: {
  organizations: { options: vi.fn() },
  positions: { list: vi.fn(), create: vi.fn(), update: vi.fn(), disable: vi.fn(), enable: vi.fn(), remove: vi.fn() },
} }));

const branch: OrganizationNode = { id: 'branch', code: 'BJ', name: '北京分所', type: 'BRANCH', parentId: 'root', path: '/root/branch', level: 1, sort: 0, status: 'ENABLED', version: 1, children: [] };

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ authorization: null });
  vi.mocked(masterDataApi.organizations.options).mockResolvedValue({ code: 200, message: 'success', data: [branch] });
  vi.mocked(masterDataApi.positions.list).mockResolvedValue({ code: 200, message: 'success', data: [] });
});

test('super-admin deletion confirms first, sends the displayed version and refreshes positions', async () => {
  useAuthStore.setState({ authorization: { userId: 'root', employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false, permissions: [], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() } });
  vi.mocked(masterDataApi.positions.list).mockResolvedValue({ code: 200, message: 'success', data: [{ id: 'p1', organizationId: 'branch', code: 'GW_001', name: '待删岗位', categoryCode: 'LEGAL', level: 1, responsibilities: null, status: 'ENABLED', version: 4, activeAssignmentCount: 0 }] });
  vi.mocked(masterDataApi.positions.remove).mockResolvedValue({ code: 200, message: 'success', data: null });
  render(<PositionPage />);
  fireEvent.click(await screen.findByRole('button', { name: '删除待删岗位' }));
  expect(masterDataApi.positions.remove).not.toHaveBeenCalled();
  expect(screen.getByText(/存在当前或历史任职关联/)).toBeInTheDocument();
  vi.mocked(masterDataApi.positions.list).mockResolvedValue({ code: 200, message: 'success', data: [] });
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(masterDataApi.positions.remove).toHaveBeenCalledWith('p1', { version: 4 }));
  expect(await screen.findByText('暂无岗位')).toBeInTheDocument();
});

test('ordinary accounts do not see position delete controls', async () => {
  vi.mocked(masterDataApi.positions.list).mockResolvedValue({ code: 200, message: 'success', data: [{ id: 'p1', organizationId: 'branch', code: 'GW_001', name: '普通岗位', categoryCode: 'LEGAL', level: 1, responsibilities: null, status: 'ENABLED', version: 1, activeAssignmentCount: 0 }] });
  render(<PositionPage />);
  await screen.findByText('普通岗位');
  expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
});

test('filters positions by organization and renders a retryable empty state', async () => {
  render(<PositionPage />);
  expect(await screen.findByText('暂无岗位')).toBeInTheDocument();
  await waitFor(() => expect(masterDataApi.positions.list).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'branch' })));
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  await waitFor(() => expect(masterDataApi.positions.list).toHaveBeenCalledTimes(2));
});

test('opens organization-bound position creation', async () => {
  render(<PositionPage />);
  await screen.findByText('暂无岗位');
  fireEvent.click(screen.getByRole('button', { name: /新增岗位/ }));
  expect(screen.getByDisplayValue('北京分所')).toBeDisabled();
  expect(screen.getByLabelText('岗位编码')).toBeInTheDocument();
});

test('creation uses Chinese category selection while submitting a stable generated code', async () => {
  vi.mocked(masterDataApi.positions.create).mockResolvedValue({ code: 200, message: 'success', data: {} as never });
  render(<PositionPage />);
  await screen.findByText('暂无岗位');
  fireEvent.click(screen.getByRole('button', { name: /新增岗位/ }));
  expect(screen.getByLabelText('岗位编码')).toBeDisabled();
  expect(screen.getByDisplayValue(/^岗位编号 \d+$/)).toBeInTheDocument();
  expect(screen.getByText('法律专业')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('岗位名称'), { target: { value: '主办律师' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '岗位分类' }));
  fireEvent.click(await screen.findByText('行政', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(masterDataApi.positions.create).toHaveBeenCalledWith(expect.objectContaining({
    organizationId: 'branch', name: '主办律师', categoryCode: 'ADMIN', code: expect.stringMatching(/^[A-Z][A-Z0-9_]{1,31}$/),
  })));
});

test('position edits send only mutable fields, excluding the disabled code input', async () => {
  vi.mocked(masterDataApi.positions.list).mockResolvedValue({ code: 200, message: 'success', data: [{
    id: 'position-1', organizationId: 'branch', code: 'LAWYER_01', name: '主办律师',
    categoryCode: 'LEGAL', level: 1, responsibilities: '办案职责', status: 'ENABLED', version: 3,
    activeAssignmentCount: 0,
  }] });
  vi.mocked(masterDataApi.positions.update).mockResolvedValue({ code: 200, message: 'success', data: {} as never });
  render(<PositionPage />);
  fireEvent.click(await screen.findByRole('button', { name: /编辑/ }));
  fireEvent.change(screen.getByLabelText('岗位名称'), { target: { value: '资深律师' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
  await waitFor(() => expect(masterDataApi.positions.update).toHaveBeenCalledWith('position-1', {
    name: '资深律师', categoryCode: 'LEGAL', level: 1, responsibilities: '办案职责', version: 3,
  }));
});
