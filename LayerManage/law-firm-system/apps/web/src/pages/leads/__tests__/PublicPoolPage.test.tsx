import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import PublicPoolPage from '../PublicPoolPage';
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

function poolLead(overrides: Partial<LeadView> = {}): LeadView {
  return {
    id: 'lead-9',
    leadNo: 'L2607300009',
    name: '王五',
    phone: '139****2222',
    wechat: null,
    channelId: null,
    sourceType: 'NATURAL',
    sourceDetail: null,
    campaignId: null,
    referralCustomerId: null,
    intentionLevel: 4,
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
    createdAt: '2026-07-30T02:00:00.000Z',
    updatedAt: '2026-07-30T02:00:00.000Z',
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

test('claims a pool lead through the claim action and refreshes the pool', async () => {
  const lead = poolLead();
  api.pool.mockResolvedValue(pageOf([lead]));
  api.claim.mockResolvedValue({ code: 200, message: 'success', data: { ...lead, poolStatus: 'PRIVATE', assignedTo: 'emp-1' } });

  render(<MemoryRouter><PublicPoolPage /></MemoryRouter>);
  expect(await screen.findByText('王五')).toBeInTheDocument();
  expect(api.pool).toHaveBeenCalledWith(expect.objectContaining({ page: 1, poolStatus: 'PUBLIC' }));

  fireEvent.click(screen.getByRole('button', { name: /领取/ }));
  fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(api.claim).toHaveBeenCalledWith('lead-9'));
  await waitFor(() => expect(api.pool).toHaveBeenCalledTimes(2));
});

test('switches to the recycled pool tab and queries with poolStatus=RECYCLED', async () => {
  api.pool.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><PublicPoolPage /></MemoryRouter>);
  await screen.findByText('暂无可领取线索');

  fireEvent.click(screen.getByRole('tab', { name: '回收池' }));
  await waitFor(() => expect(api.pool).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, poolStatus: 'RECYCLED' }),
  ));
});
