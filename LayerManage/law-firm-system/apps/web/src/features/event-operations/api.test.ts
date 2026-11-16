import { beforeEach, expect, test, vi } from 'vitest';
import { eventOperationsApi } from './api';

const requestMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/api/request', () => ({ default: requestMock }));

beforeEach(() => {
  requestMock.get.mockReset();
  requestMock.post.mockReset();
  requestMock.get.mockResolvedValue({ code: 200, message: 'OK', data: {} });
  requestMock.post.mockResolvedValue({ code: 200, message: 'OK', data: {} });
});

test('calls the bounded event operations endpoints with typed query parameters', async () => {
  await eventOperationsApi.summary();
  await eventOperationsApi.list({
    page: 2,
    pageSize: 50,
    status: 'MANUAL',
    eventType: 'admin.operation.reviewed',
    handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
    objectType: 'ADMIN_OPERATION',
    objectId: '11111111-1111-4111-8111-111111111111',
    from: '2026-07-22T00:00:00.000Z',
    to: '2026-07-22T23:59:59.000Z',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  await eventOperationsApi.detail('delivery-1');
  await eventOperationsApi.subscriptions();

  expect(requestMock.get).toHaveBeenNthCalledWith(1, '/v1/event-operations/summary');
  expect(requestMock.get).toHaveBeenNthCalledWith(2, '/v1/event-operations/deliveries', {
    params: expect.objectContaining({ page: 2, pageSize: 50, status: 'MANUAL' }),
  });
  expect(requestMock.get).toHaveBeenNthCalledWith(3, '/v1/event-operations/deliveries/delivery-1');
  expect(requestMock.get).toHaveBeenNthCalledWith(4, '/v1/event-operations/subscriptions');
});

test('retries with the version and no Step-Up header', async () => {
  await eventOperationsApi.retry('delivery-1', 7);

  expect(requestMock.post).toHaveBeenCalledWith(
    '/v1/event-operations/deliveries/delivery-1/retry',
    { expectedVersion: 7 },
    { suppressGlobalError: true },
  );
  expect(JSON.stringify(requestMock.post.mock.calls[0])).not.toContain('payload');
});
