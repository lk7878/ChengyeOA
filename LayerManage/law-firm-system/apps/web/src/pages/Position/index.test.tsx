import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { masterDataApi } from '@/features/master-data/api';
import type { OrganizationNode } from '@/features/master-data/types';
import PositionPage from './index';

vi.mock('@/features/master-data/api', () => ({ masterDataApi: {
  organizations: { tree: vi.fn() },
  positions: { list: vi.fn(), create: vi.fn(), update: vi.fn(), disable: vi.fn(), enable: vi.fn() },
} }));

const branch: OrganizationNode = { id: 'branch', code: 'BJ', name: '北京分所', type: 'BRANCH', parentId: 'root', path: '/root/branch', level: 1, sort: 0, status: 'ENABLED', version: 1, children: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(masterDataApi.organizations.tree).mockResolvedValue({ code: 200, message: 'success', data: [branch] });
  vi.mocked(masterDataApi.positions.list).mockResolvedValue({ code: 200, message: 'success', data: [] });
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
