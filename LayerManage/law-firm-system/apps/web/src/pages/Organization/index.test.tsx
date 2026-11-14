import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { masterDataApi } from '@/features/master-data/api';
import type { OrganizationNode } from '@/features/master-data/types';
import OrganizationPage from './index';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/features/master-data/api', () => ({ masterDataApi: { organizations: {
  managerOptions: vi.fn(), copy: vi.fn(), remove: vi.fn(), tree: vi.fn(), create: vi.fn(), update: vi.fn(), move: vi.fn(), disable: vi.fn(), enable: vi.fn(),
} } }));

const root: OrganizationNode = { id: 'root', code: 'ROOT', name: '总所', type: 'FIRM', parentId: null, path: '/root', level: 0, sort: 0, status: 'ENABLED', version: 1,
  children: [{ id: 'branch', code: 'BJ', name: '北京分所', type: 'BRANCH', parentId: 'root', path: '/root/branch', level: 1, sort: 1, status: 'ENABLED', version: 1,
    children: [{ id: 'dept', code: 'LEGAL', name: '深层业务部', type: 'DEPARTMENT', parentId: 'branch', path: '/root/branch/dept', level: 2, sort: 2, status: 'ENABLED', version: 1, children: [] }] }] };

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ authorization: { userId: 'admin', employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false, permissions: [], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() } });
  vi.mocked(masterDataApi.organizations.managerOptions).mockResolvedValue({ code: 200, message: 'success', data: [{ id: 'manager', name: '张律师', employeeNo: 'EMP_01', status: 'FORMAL' }] });
  vi.mocked(masterDataApi.organizations.tree).mockResolvedValue({ code: 200, message: 'success', data: [root] });
  vi.mocked(masterDataApi.organizations.create).mockResolvedValue({ code: 200, message: 'success', data: {} as never });
});

test('renders arbitrary tree depth and keeps root mutation actions absent', async () => {
  render(<OrganizationPage />);
  expect(await screen.findByText('深层业务部')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /apartment 总所 ROOT/ }));
  expect(screen.queryByRole('button', { name: '移动组织' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '停用组织' })).not.toBeInTheDocument();
});

test('creates beneath the selected parent and refreshes the tree', async () => {
  render(<OrganizationPage />);
  fireEvent.click(await screen.findByText('北京分所'));
  fireEvent.click(screen.getByRole('button', { name: /新增下级组织/ }));
  fireEvent.change(screen.getByLabelText('组织编码'), { target: { value: 'NEW_DEPT' } });
  fireEvent.change(screen.getByLabelText('组织名称'), { target: { value: '新部门' } });
  fireEvent.mouseDown(screen.getByLabelText('组织类型'));
  fireEvent.click((await screen.findAllByText('部门')).at(-1)!);
  fireEvent.click(screen.getByRole('button', { name: /保.*存/ }));
  await waitFor(() => expect(masterDataApi.organizations.create).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'branch', code: 'NEW_DEPT' })));
  expect(masterDataApi.organizations.tree).toHaveBeenCalledTimes(2);
});

test('explains invalid numeric codes before sending a request and allows correction without losing input', async () => {
  render(<OrganizationPage />);
  await screen.findByText('深层业务部');
  fireEvent.click(screen.getByRole('button', { name: /新增下级组织/ }));
  fireEvent.change(screen.getByLabelText('组织编码'), { target: { value: '001' } });
  fireEvent.change(screen.getByLabelText('组织名称'), { target: { value: '律师部' } });
  fireEvent.click(screen.getByRole('button', { name: /保.*存/ }));
  await waitFor(() => expect(screen.getByLabelText('组织编码')).toHaveAttribute('aria-invalid', 'true'));
  expect(screen.getAllByText(/以英文字母开头/).length).toBeGreaterThan(0);
  expect(masterDataApi.organizations.create).not.toHaveBeenCalled();
  expect(screen.getByLabelText('组织名称')).toHaveValue('律师部');
  fireEvent.change(screen.getByLabelText('组织编码'), { target: { value: 'dept_001' } });
  fireEvent.click(screen.getByRole('button', { name: /保.*存/ }));
  await waitFor(() => expect(masterDataApi.organizations.create).toHaveBeenCalledWith({
    code: 'DEPT_001', name: '律师部', type: 'DEPARTMENT', parentId: 'root', sort: 3, managerEmployeeId: null,
  }));
});

test('creating below a department defaults to a group instead of an invalid department', async () => {
  render(<OrganizationPage />);
  fireEvent.click(await screen.findByText('深层业务部'));
  fireEvent.click(screen.getByRole('button', { name: /新增下级组织/ }));
  fireEvent.change(screen.getByLabelText('组织编码'), { target: { value: 'GROUP_01' } });
  fireEvent.change(screen.getByLabelText('组织名称'), { target: { value: '业务工作组' } });
  fireEvent.click(screen.getByRole('button', { name: /保.*存/ }));
  await waitFor(() => expect(masterDataApi.organizations.create).toHaveBeenCalledWith(expect.objectContaining({
    type: 'GROUP', parentId: 'dept',
  })));
});

test('blocks ordinary administrators before fetching organization management data', () => {
  useAuthStore.setState({ authorization: { ...useAuthStore.getState().authorization!, isSystemSuperAdmin: false, isSystemAdmin: true } });
  render(<OrganizationPage />);
  expect(screen.getByText('仅系统超级管理员可以管理组织架构')).toBeInTheDocument();
  expect(masterDataApi.organizations.tree).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '编辑组织' })).not.toBeInTheDocument();
});

test('searches organization codes and preserves the ancestor path', async () => {
  render(<OrganizationPage />);
  await screen.findByText('深层业务部');
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索组织' }), { target: { value: 'LEGAL' } });
  expect(screen.getByText('深层业务部')).toBeInTheDocument();
  expect(screen.getByText('北京分所')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索组织' }), { target: { value: '不存在组织' } });
  expect(screen.getByText('没有匹配的组织')).toBeInTheDocument();
});

test('copies the selected organization after editing its new code and name', async () => {
  const copied = { ...root.children[0], id: 'copied', path: '/root/copied', sort: 3, name: '重庆分所' };
  vi.mocked(masterDataApi.organizations.tree).mockResolvedValueOnce({ code: 200, message: 'success', data: [root] })
    .mockResolvedValueOnce({ code: 200, message: 'success', data: [{ ...root, children: [...root.children, copied] }] });
  vi.mocked(masterDataApi.organizations.copy).mockResolvedValue({ code: 200, message: 'success', data: copied });
  render(<OrganizationPage />);
  fireEvent.click(await screen.findByText('北京分所'));
  fireEvent.click(screen.getByRole('button', { name: '收起总所的下级组织' }));
  fireEvent.click(screen.getByRole('button', { name: '复制组织' }));
  expect(screen.getByLabelText('组织名称')).toHaveValue('北京分所');
  expect(await screen.findByText(/将同时复制全部下级组织和各级岗位/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('组织编码'), { target: { value: 'COPY_BRANCH' } });
  fireEvent.change(screen.getByLabelText('组织名称'), { target: { value: '重庆分所' } });
  fireEvent.click(screen.getByRole('button', { name: /保.*存/ }));
  await waitFor(() => expect(masterDataApi.organizations.copy).toHaveBeenCalledWith('branch', {
    sourceVersion: 1, code: 'COPY_BRANCH', name: '重庆分所', type: 'BRANCH', parentId: 'root', sort: 3, managerEmployeeId: null,
  }));
  expect(masterDataApi.organizations.create).not.toHaveBeenCalled();
  expect(await screen.findByRole('heading', { name: '重庆分所' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '收起总所的下级组织' })).toHaveAttribute('aria-expanded', 'true');
});

test('selects a template in the add dialog and saves its structure via the copy endpoint', async () => {
  vi.mocked(masterDataApi.organizations.copy).mockResolvedValue({ code: 200, message: 'success', data: root.children[0] });
  render(<OrganizationPage />);
  await screen.findByText('北京分所');
  fireEvent.click(screen.getByRole('button', { name: '新增下级组织' }));
  fireEvent.mouseDown(screen.getByLabelText('复制相似组织（可选）'));
  fireEvent.click((await screen.findAllByText('北京分所（BJ）')).at(-1)!);
  expect(screen.getByLabelText('组织名称')).toHaveValue('北京分所');
  fireEvent.change(screen.getByLabelText('组织编码'), { target: { value: 'NEW_BRANCH' } });
  fireEvent.click(screen.getByRole('button', { name: /保.*存/ }));
  await waitFor(() => expect(masterDataApi.organizations.copy).toHaveBeenCalledWith('branch', expect.objectContaining({ code: 'NEW_BRANCH', parentId: 'root' })));
});

test('sets the department manager from active employee candidates', async () => {
  vi.mocked(masterDataApi.organizations.update).mockResolvedValue({ code: 200, message: 'success', data: root as never });
  render(<OrganizationPage />);
  fireEvent.click(await screen.findByText('深层业务部'));
  fireEvent.click(screen.getByRole('button', { name: '设置部门负责人' }));
  await waitFor(() => expect(masterDataApi.organizations.managerOptions).toHaveBeenCalled());
  fireEvent.mouseDown(screen.getByLabelText('部门负责人'));
  fireEvent.click((await screen.findAllByText('张律师（EMP_01）')).at(-1)!);
  fireEvent.click(screen.getByRole('button', { name: /保.*存/ }));
  await waitFor(() => expect(masterDataApi.organizations.update).toHaveBeenCalledWith('dept', {
    name: '深层业务部', sort: 2, version: 1, managerEmployeeId: 'manager',
  }));
});

test('confirms deletion and keeps failures visible in Chinese', async () => {
  vi.mocked(masterDataApi.organizations.remove).mockRejectedValue(new Error('ORGANIZATION_DELETE_IN_USE'));
  render(<OrganizationPage />);
  fireEvent.click(await screen.findByText('深层业务部'));
  fireEvent.click(screen.getByRole('button', { name: '删除组织' }));
  expect(masterDataApi.organizations.remove).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(masterDataApi.organizations.remove).toHaveBeenCalledWith('dept', { version: 1 }));
  expect(await screen.findByText(/该组织存在下级、岗位或历史关联/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '深层业务部' })).toBeInTheDocument();
});

test('SPEC-003-B folds only the chosen branch and preserves it across refresh and search', async () => {
  render(<OrganizationPage />);
  await screen.findByText('深层业务部');
  fireEvent.click(screen.getByRole('button', { name: '收起北京分所的下级组织' }));
  expect(screen.queryByText('深层业务部')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '总所' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '展开北京分所的下级组织' })).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
  await waitFor(() => expect(masterDataApi.organizations.tree).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('深层业务部')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索组织' }), { target: { value: 'LEGAL' } });
  expect(screen.getByText('深层业务部')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索组织' }), { target: { value: '' } });
  expect(screen.queryByText('深层业务部')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '展开北京分所的下级组织' }));
  expect(screen.getByText('深层业务部')).toBeInTheDocument();
});

test('SPEC-003-B leaves have no collapse toggle and a server sort conflict retains the input', async () => {
  vi.mocked(masterDataApi.organizations.create).mockRejectedValueOnce(new Error('ORGANIZATION_SORT_CONFLICT'));
  render(<OrganizationPage />);
  await screen.findByText('深层业务部');
  expect(screen.queryByRole('button', { name: '收起深层业务部的下级组织' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '新增下级组织' }));
  fireEvent.change(screen.getByLabelText('组织编码'), { target: { value: 'SORT_NEW' } });
  fireEvent.change(screen.getByLabelText('组织名称'), { target: { value: '并发新增部门' } });
  fireEvent.click(screen.getByRole('button', { name: /保.*存/ }));
  expect(await screen.findByText(/排序号已被其他组织占用，请刷新/)).toBeInTheDocument();
  expect(screen.getByLabelText('组织名称')).toHaveValue('并发新增部门');
});
