import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { masterDataApi } from '@/features/master-data/api';
import type { OrganizationNode } from '@/features/master-data/types';
import OrganizationPage from './index';

vi.mock('@/features/master-data/api', () => ({ masterDataApi: { organizations: {
  tree: vi.fn(), create: vi.fn(), update: vi.fn(), move: vi.fn(), disable: vi.fn(), enable: vi.fn(),
} } }));

const root: OrganizationNode = { id: 'root', code: 'ROOT', name: '总所', type: 'FIRM', parentId: null, path: '/root', level: 0, sort: 0, status: 'ENABLED', version: 1,
  children: [{ id: 'branch', code: 'BJ', name: '北京分所', type: 'BRANCH', parentId: 'root', path: '/root/branch', level: 1, sort: 0, status: 'ENABLED', version: 1,
    children: [{ id: 'dept', code: 'LEGAL', name: '深层业务部', type: 'DEPARTMENT', parentId: 'branch', path: '/root/branch/dept', level: 2, sort: 0, status: 'ENABLED', version: 1, children: [] }] }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(masterDataApi.organizations.tree).mockResolvedValue({ code: 200, message: 'success', data: [root] });
  vi.mocked(masterDataApi.organizations.create).mockResolvedValue({ code: 200, message: 'success', data: {} as never });
});

test('renders arbitrary tree depth and keeps root mutation actions absent', async () => {
  render(<OrganizationPage />);
  expect(await screen.findByText('深层业务部')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /总所/ }));
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
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(masterDataApi.organizations.create).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'branch', code: 'NEW_DEPT' })));
  expect(masterDataApi.organizations.tree).toHaveBeenCalledTimes(2);
});
