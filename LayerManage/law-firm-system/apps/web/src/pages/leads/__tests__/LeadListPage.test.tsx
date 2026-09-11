import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import LeadListPage from '../LeadListPage';
import { useLeadStore } from '@/stores/lead-store';
import type { LeadView } from '@/api/types';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  pool: vi.fn(),
  claim: vi.fn(),
  detail: vi.fn(),
  transition: vi.fn(),
  assign: vi.fn(),
  recycle: vi.fn(),
  convert: vi.fn(),
  addFollow: vi.fn(),
  follows: vi.fn(),
  appointments: vi.fn(),
  create: vi.fn(),
}));
vi.mock('@/api/lead', () => ({ leadApi: api }));

function leadFixture(overrides: Partial<LeadView> = {}): LeadView {
  return {
    id: 'lead-1',
    leadNo: 'L2607300001',
    name: '张三',
    phone: '13800001111',
    wechat: null,
    channelId: null,
    sourceType: 'MANUAL',
    sourceDetail: null,
    campaignId: null,
    referralCustomerId: null,
    intentionLevel: 3,
    status: 'NEW',
    poolStatus: 'PUBLIC',
    branchId: null,
    professionalTeamId: null,
    assignedTo: null,
    assignedAt: null,
    firstResponseSeconds: null,
    isValid: true,
    invalidReason: null,
    tags: null,
    createdBy: 'user-1',
    version: 1,
    createdAt: '2026-07-30T01:00:00.000Z',
    updatedAt: '2026-07-30T01:00:00.000Z',
    ...overrides,
  };
}

function pageOf(list: LeadView[], total = list.length) {
  return { code: 200, message: 'success', data: { list, page: 1, pageSize: 10, total } };
}

beforeEach(() => {
  vi.clearAllMocks();
  useLeadStore.getState().reset();
});

test('renders the lead list with server data', async () => {
  api.list.mockResolvedValue(pageOf([leadFixture()]));
  render(<MemoryRouter><LeadListPage /></MemoryRouter>);

  expect(await screen.findByText('张三')).toBeInTheDocument();
  expect(screen.getByText('L2607300001')).toBeInTheDocument();
  expect(screen.getByText('13800001111')).toBeInTheDocument();
  expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
});

test('filter interaction fires list query with keyword and status params', async () => {
  api.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><LeadListPage /></MemoryRouter>);
  await screen.findByText('暂无线索');

  fireEvent.change(screen.getByPlaceholderText('搜索姓名/电话/编号'), { target: { value: '李四' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '状态筛选' }));
  fireEvent.click(await screen.findByText('已联系'));
  fireEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

  await waitFor(() => expect(api.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 10, keyword: '李四', status: 'CONTACTED' }),
  ));
});

test('shows the empty state when the server returns no leads', async () => {
  api.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><LeadListPage /></MemoryRouter>);

  expect(await screen.findByText('暂无线索')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('shows an error state when the list request fails', async () => {
  api.list.mockRejectedValue(new Error('网络错误'));
  render(<MemoryRouter><LeadListPage /></MemoryRouter>);

  expect(await screen.findByText('线索列表加载失败')).toBeInTheDocument();
  expect(screen.getByText('网络错误')).toBeInTheDocument();
});

test('renders the masked phone verbatim without unmasking', async () => {
  api.list.mockResolvedValue(pageOf([leadFixture({ phone: '138****1111', wechat: 'wx***89' })]));
  render(<MemoryRouter><LeadListPage /></MemoryRouter>);

  expect(await screen.findByText('138****1111')).toBeInTheDocument();
  expect(screen.getByText('wx***89')).toBeInTheDocument();
  expect(screen.queryByText('13800001111')).not.toBeInTheDocument();
});
