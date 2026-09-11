import { beforeEach, expect, test, vi } from 'vitest';
import { useCostStore } from './cost-store';
import type { CostView } from '@/api/cost';

const costApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/api/cost', () => ({ costApi: costApiMock }));

function costFixture(overrides: Partial<CostView> = {}): CostView {
  return {
    id: 'cost-1',
    category: 'CHANNEL',
    amount: '2000.00',
    occurredAt: '2026-07-28T00:00:00.000Z',
    note: null,
    channelId: 'channel-1',
    caseId: null,
    createdBy: 'user-1',
    updatedBy: null,
    version: 1,
    createdAt: '2026-07-28T01:00:00.000Z',
    updatedAt: '2026-07-28T01:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCostStore.getState().reset();
});

test('removeCost removes the row and decrements listTotal by one', async () => {
  useCostStore.setState({
    costs: [costFixture(), costFixture({ id: 'cost-2', amount: '1000.00' })],
    listTotal: 2,
  });
  costApiMock.remove.mockResolvedValue({ code: 200, message: 'success', data: null });

  const ok = await useCostStore.getState().removeCost('cost-1');

  expect(ok).toBe(true);
  expect(costApiMock.remove).toHaveBeenCalledWith('cost-1');
  expect(useCostStore.getState().costs.map(cost => cost.id)).toEqual(['cost-2']);
  expect(useCostStore.getState().listTotal).toBe(1);
});

test('removeCost keeps listTotal non-negative when removing the only row', async () => {
  useCostStore.setState({ costs: [costFixture()], listTotal: 1 });
  costApiMock.remove.mockResolvedValue({ code: 200, message: 'success', data: null });

  await useCostStore.getState().removeCost('cost-1');

  expect(useCostStore.getState().costs).toEqual([]);
  expect(useCostStore.getState().listTotal).toBe(0);
});

test('removeCost returns false and leaves state unchanged on failure', async () => {
  useCostStore.setState({ costs: [costFixture()], listTotal: 1 });
  costApiMock.remove.mockRejectedValue(new Error('网络错误'));

  const ok = await useCostStore.getState().removeCost('cost-1');

  expect(ok).toBe(false);
  expect(useCostStore.getState().costs).toHaveLength(1);
  expect(useCostStore.getState().listTotal).toBe(1);
});
