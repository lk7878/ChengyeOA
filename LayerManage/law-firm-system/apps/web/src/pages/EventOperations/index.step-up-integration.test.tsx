import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { message } from 'antd';
import { authApi } from '@/api/auth';
import { eventOperationsApi } from '@/features/event-operations/api';
import { useAuthStore } from '@/stores/authStore';
import EventOperationsPage from './index';

vi.mock('@/api/auth', () => ({ authApi: { stepUp: vi.fn(), mfaStatus: vi.fn(), sessions: vi.fn() } }));
vi.mock('@/features/event-operations/api', () => ({ eventOperationsApi: {
  summary: vi.fn(), list: vi.fn(), detail: vi.fn(), subscriptions: vi.fn(), retry: vi.fn(),
} }));

const summary = {
  counts: { PENDING: 0, RETRY_WAIT: 0, PROCESSING: 0, MANUAL: 1, SUCCEEDED: 0 },
  recent24Hours: { total: 1, succeeded: 0, successRate: 0 }, longestBacklogSeconds: 1,
  worker: { status: 'healthy', workerEnabled: true, lastSuccessfulTickAt: null, lastDatabaseFailureAt: null,
    consecutiveDatabaseFailures: 0, databaseFailureTotal: 0, lastErrorCode: null, lastErrorReference: null },
  observability: {
    status: 'BLOCKED', mode: 'canary', evaluatedAt: '2026-07-23T12:00:00.000Z',
    metrics: {
      undispatchedCount: 0, oldestUndispatchedSeconds: 0, dueBacklogCount: 0, oldestDueBacklogSeconds: 0,
      manualCount: 1, processingCount: 0, expiredProcessingCount: 0, staleExpiredProcessingCount: 0,
      leaseLost15mCount: 0, lastSuccessfulTickAt: null, lastHeartbeatAt: null,
    },
    alerts: [{ code: 'EVENT_OBS_MANUAL_PRESENT', severity: 'BLOCKED', value: 1, threshold: 1 }],
  },
};
const delivery = {
  id: 'd1', status: 'MANUAL', handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION', attemptCount: 5,
  manualRetryCount: 0, nextAttemptAt: null, lastErrorCode: 'GOVERNANCE_SOURCE_INVALID',
  lastErrorReference: '11111111-1111-4111-8111-111111111111', version: 7, startedAt: null, completedAt: null,
  createdAt: '2026-07-22T09:00:00.000Z', updatedAt: '2026-07-22T10:00:00.000Z',
  event: { id: 'e1', eventType: 'admin.operation.reviewed', eventVersion: 1, sourceModule: 'ADMIN_GOVERNANCE',
    objectType: 'ADMIN_OPERATION', objectId: 'op1', traceId: 'trace-safe', occurredAt: '2026-07-22T09:00:00.000Z',
    createdAt: '2026-07-22T09:00:00.000Z' },
};
const detail = { ...delivery, payloadSummary: { operationId: 'op1' }, attemptsTotal: 0, attemptsTruncated: false, attempts: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(eventOperationsApi.summary).mockResolvedValue({ code: 200, message: 'OK', data: summary } as never);
  vi.mocked(eventOperationsApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
    list: [delivery], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  } } as never);
  vi.mocked(eventOperationsApi.detail).mockResolvedValue({ code: 200, message: 'OK', data: detail } as never);
  vi.mocked(authApi.mfaStatus).mockResolvedValue({code:200,message:'OK',data:{enabled:true}} as never);
  vi.mocked(authApi.sessions).mockResolvedValue({code:200,message:'OK',data:[{current:true,assuranceLevel:'MFA'}]} as never);
  vi.mocked(authApi.stepUp).mockResolvedValue({
    code: 200, message: 'OK', data: { stepUpToken: 'fresh-one-time-token', expiresIn: 300 },
  });
  useAuthStore.setState({ authorization: {
    userId: 'u1', employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false,
    permissions: ['event.delivery.read', 'event.delivery.retry'], menus: ['menu.event_operations'],
    fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString(),
  } as never });
});

test('real Step-Up hook returns a retry conflict to the page and clears the one-time request', async () => {
  const globalError = vi.spyOn(message, 'error').mockImplementation(() => undefined as never);
  vi.mocked(eventOperationsApi.retry).mockRejectedValue({
    response: { status: 409, data: { message: 'AUTHORIZATION_VERSION_CONFLICT' } },
  });
  render(<EventOperationsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看投递 d1' }));
  fireEvent.click(await screen.findByRole('button', { name: '人工重试 d1' }));
  fireEvent.change(await screen.findByLabelText('当前六位验证码'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));

  expect(await screen.findByText('投递状态已变化，请刷新后重试')).toBeInTheDocument();
  expect(eventOperationsApi.retry).toHaveBeenCalledOnce();
  expect(eventOperationsApi.retry).toHaveBeenCalledWith('d1', 7, 'fresh-one-time-token');
  await waitFor(() => expect(eventOperationsApi.detail).toHaveBeenCalledTimes(2));
  expect(eventOperationsApi.list).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText('当前六位验证码')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '人工重试 d1' })).not.toBeDisabled();
  expect(document.body.textContent).not.toContain('AUTHORIZATION_VERSION_CONFLICT');
  expect(document.body.textContent).not.toContain('fresh-one-time-token');
  expect(globalError).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  globalError.mockRestore();
});
