import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { message } from 'antd';
import { eventOperationsApi } from '@/features/event-operations/api';
import { useAuthStore } from '@/stores/authStore';
import EventOperationsPage from './index';
import MainLayout from '@/components/Layout';

const runStepUp = vi.hoisted(() => vi.fn());

vi.mock('@/features/auth/useStepUp', () => ({
  useStepUp: () => ({
    run: runStepUp,
    dialogProps: {
      open: false, purpose: 'EVENT_DELIVERY_RETRY', impact: '', loading: false,
      error: null, onCancel: vi.fn(), onVerify: vi.fn(),
    },
  }),
}));
vi.mock('@/features/auth/components/StepUpDialog', () => ({ default: () => null }));
vi.mock('@/features/event-operations/api', () => ({ eventOperationsApi: {
  summary: vi.fn(), list: vi.fn(), detail: vi.fn(), subscriptions: vi.fn(), retry: vi.fn(),
} }));

const summary = {
  counts: { PENDING: 1, RETRY_WAIT: 2, PROCESSING: 1, MANUAL: 3, SUCCEEDED: 9 },
  recent24Hours: { total: 10, succeeded: 9, successRate: 0.9 },
  longestBacklogSeconds: 3661,
  worker: {
    status: 'healthy', workerEnabled: true, lastSuccessfulTickAt: '2026-07-22T12:00:00.000Z',
    lastDatabaseFailureAt: null, consecutiveDatabaseFailures: 0, databaseFailureTotal: 0,
    unknownHandlerCount: 0, invalidFilterCount: 0, invalidEnvelopeCount: 0,
    unresolvedDispatcherFaultCount: 0, lastDegradedAt: null,
    lastErrorCode: null, lastErrorReference: null,
  },
  observability: {
    status: 'READY',
    mode: 'preflight',
    evaluatedAt: '2026-07-23T12:36:00.000Z',
    metrics: {
      undispatchedCount: 4,
      oldestUndispatchedSeconds: 45,
      dueBacklogCount: 2,
      oldestDueBacklogSeconds: 90,
      manualCount: 0,
      processingCount: 3,
      expiredProcessingCount: 1,
      staleExpiredProcessingCount: 0,
      leaseLost15mCount: 0,
      lastSuccessfulTickAt: '2026-07-23T12:34:00.000Z',
      lastHeartbeatAt: '2026-07-23T12:35:00.000Z',
    },
    alerts: [],
  },
} as const;

const manualDelivery = {
  id: 'd1', status: 'MANUAL', handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
  internal: false,
  attemptCount: 205, manualRetryCount: 1, nextAttemptAt: null,
  lastErrorCode: 'GOVERNANCE_SOURCE_INVALID',
  lastErrorReference: '11111111-1111-4111-8111-111111111111', version: 7,
  startedAt: '2026-07-22T10:00:00.000Z', completedAt: null,
  createdAt: '2026-07-22T09:00:00.000Z', updatedAt: '2026-07-22T10:01:00.000Z',
  event: {
    id: 'e1', eventType: 'admin.operation.reviewed', eventVersion: 1,
    sourceModule: 'ADMIN_GOVERNANCE', objectType: 'ADMIN_OPERATION', objectId: 'op1',
    traceId: 'trace-safe', occurredAt: '2026-07-22T09:00:00.000Z', createdAt: '2026-07-22T09:00:00.000Z',
  },
} as const;

const detail = {
  ...manualDelivery,
  payloadSummary: {
    operationId: 'op1', operationType: 'SYSTEM_ADMIN_GRANT', riskLevel: 'HIGH', status: 'APPROVED',
  },
  attemptsTotal: 205,
  attemptsTruncated: true,
  attempts: [{
    attemptNumber: 205, outcome: 'MANUAL_REQUIRED', errorCode: 'GOVERNANCE_SOURCE_INVALID',
    errorReference: '22222222-2222-4222-8222-222222222222', durationMs: 12,
    startedAt: '2026-07-22T10:00:00.000Z', completedAt: '2026-07-22T10:00:00.012Z',
  }],
} as const;

const manualDeliveryD2 = {
  ...manualDelivery,
  id: 'd2', version: 11,
  event: { ...manualDelivery.event, id: 'e2', objectId: 'op2', traceId: 'trace-safe-d2' },
} as const;
const detailD2 = {
  ...detail,
  ...manualDeliveryD2,
  payloadSummary: { operationId: 'op2', operationType: 'D2_OPERATION', riskLevel: 'MEDIUM', status: 'REJECTED' },
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const emptyPage = {
  list: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(eventOperationsApi.summary).mockResolvedValue({ code: 200, message: 'OK', data: summary } as never);
  vi.mocked(eventOperationsApi.list).mockResolvedValue({ code: 200, message: 'OK', data: emptyPage } as never);
  vi.mocked(eventOperationsApi.detail).mockResolvedValue({ code: 200, message: 'OK', data: detail } as never);
  vi.mocked(eventOperationsApi.subscriptions).mockResolvedValue({ code: 200, message: 'OK', data: [] } as never);
  vi.mocked(eventOperationsApi.retry).mockResolvedValue({
    code: 200, message: 'OK', data: { id: 'd1', status: 'PENDING', version: 8 },
  } as never);
  runStepUp.mockImplementation(async request => request.mutate('one-time-step-up'));
  useAuthStore.setState({ authorization: {
    userId: 'u1', employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false,
    permissions: ['event.delivery.read', 'event.delivery.retry'], menus: ['menu.event_operations'],
    fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString(),
  } as never });
});

test('shows loading and then the empty state with summary cards', async () => {
  let resolveList!: (value: unknown) => void;
  vi.mocked(eventOperationsApi.list).mockImplementation(() => new Promise(resolve => { resolveList = resolve; }) as never);
  render(<EventOperationsPage />);

  expect(screen.getByLabelText('正在加载事件投递')).toBeInTheDocument();
  await waitFor(() => expect(eventOperationsApi.list).toHaveBeenCalledOnce());
  resolveList({ code: 200, message: 'OK', data: emptyPage });

  expect(await screen.findByText('暂无投递')).toBeInTheDocument();
  expect(screen.getAllByText('待处理').length).toBeGreaterThan(0);
  expect(screen.getAllByText('人工处理').length).toBeGreaterThan(0);
  expect(screen.getByText('90.0%')).toBeInTheDocument();
  expect(screen.getByText('1 小时 1 分钟 1 秒')).toBeInTheDocument();
});

test('renders the READY preflight gate with every metric and UTC evaluation time', async () => {
  render(<EventOperationsPage />);

  expect(await screen.findByText('灰度状态：就绪')).toBeInTheDocument();
  expect(screen.getByText('发布前检查（preflight）')).toBeInTheDocument();
  expect(screen.getByText('评估时间：2026-07-23 12:36:00 UTC')).toBeInTheDocument();
  const metrics = screen.getByRole('list', { name: '事件可观测性指标' });
  const expectedCards = [
    '未分派事件：4',
    '最老未分派年龄：45 秒',
    '到期积压：2',
    '最老到期积压年龄：1 分钟 30 秒',
    '人工处理：0',
    '处理中：3',
    '租约已过期：1',
    '长期过期未恢复：0',
    '近 15 分钟租约丢失：0',
    '最近成功执行：2026-07-23 12:34:00 UTC',
    '最近心跳：2026-07-23 12:35:00 UTC',
  ];
  expect(within(metrics).getAllByRole('listitem')).toHaveLength(expectedCards.length);
  for (const name of expectedCards) {
    expect(within(metrics).getByRole('listitem', { name })).toBeInTheDocument();
  }
});

test('renders the DEGRADED canary gate with code-owned lease-loss advice', async () => {
  vi.mocked(eventOperationsApi.summary).mockResolvedValue({ code: 200, message: 'OK', data: {
    ...summary,
    observability: {
      ...summary.observability,
      status: 'DEGRADED',
      mode: 'canary',
      alerts: [{ code: 'EVENT_OBS_LEASE_LOST', severity: 'DEGRADED', value: 1, threshold: 1 }],
    },
  } } as never);
  render(<EventOperationsPage />);

  expect(await screen.findByText('灰度状态：需观察')).toBeInTheDocument();
  expect(screen.getByText('灰度运行（canary）')).toBeInTheDocument();
  expect(screen.getByText('近期出现租约丢失，请观察 Worker 并发与处理耗时后再继续扩大灰度。')).toBeInTheDocument();
});

test('renders BLOCKED alert advice in the API-provided stable order', async () => {
  vi.mocked(eventOperationsApi.summary).mockResolvedValue({ code: 200, message: 'OK', data: {
    ...summary,
    observability: {
      ...summary.observability,
      status: 'BLOCKED',
      mode: 'canary',
      alerts: [
        { code: 'EVENT_OBS_MANUAL_PRESENT', severity: 'BLOCKED', value: 1, threshold: 1 },
        { code: 'EVENT_OBS_WORKER_TICK_STALE', severity: 'BLOCKED', value: 121, threshold: 120 },
      ],
    },
  } } as never);
  render(<EventOperationsPage />);

  expect(await screen.findByText('灰度状态：已阻断')).toBeInTheDocument();
  const advice = screen.getByRole('list', { name: '灰度处置建议' });
  const items = within(advice).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('存在需要人工处理的投递，请先完成故障排查和受控处置，再继续灰度。');
  expect(items[1]).toHaveTextContent('Worker 心跳或最近成功执行已过期，请检查应用进程与数据库连接。');
});

test('uses reviewed UTF-8 code-owned copy for every approved alert code', async () => {
  const approvedAlerts = [
    ['EVENT_OBS_MODE_MISMATCH', '当前 Worker 运行状态与检查模式不一致，请按发布流程核对 Worker 开关和运行状态。'],
    ['EVENT_OBS_MANUAL_PRESENT', '存在需要人工处理的投递，请先完成故障排查和受控处置，再继续灰度。'],
    ['EVENT_OBS_DISPATCHER_FAULT', '存在未解决的调度故障，请先修复兼容代码或受控配置并重新验证。'],
    ['EVENT_OBS_DATABASE_FAILURES', 'Worker 连续访问数据库失败，请检查数据库可用性，恢复后重新刷新评估。'],
    ['EVENT_OBS_WORKER_TICK_STALE', 'Worker 心跳或最近成功执行已过期，请检查应用进程与数据库连接。'],
    ['EVENT_OBS_UNDISPATCHED_STALE', '存在长时间未分派的事件，请检查调度流程并阻止继续灰度。'],
    ['EVENT_OBS_DUE_BACKLOG_STALE', '存在长时间未处理的到期积压，请检查 Worker 处理能力与依赖状态。'],
    ['EVENT_OBS_LEASE_LOST', '近期出现租约丢失，请观察 Worker 并发与处理耗时后再继续扩大灰度。'],
    ['EVENT_OBS_LEASE_LOST_EXCESSIVE', '近期租约丢失次数过多，请停止灰度并排查并发、超时和进程稳定性。'],
    ['EVENT_OBS_PROCESSING_LEASE_STALE', '存在租约过期后仍未恢复的处理中投递，请停止灰度并排查恢复流程。'],
  ] as const;
  vi.mocked(eventOperationsApi.summary).mockResolvedValue({ code: 200, message: 'OK', data: {
    ...summary,
    observability: {
      ...summary.observability,
      status: 'BLOCKED',
      alerts: approvedAlerts.map(([code]) => ({ code, severity: 'BLOCKED', value: 1, threshold: 1 })),
    },
  } } as never);
  render(<EventOperationsPage />);

  await screen.findByText('灰度状态：已阻断');
  for (const [, copy] of approvedAlerts) expect(screen.getByText(copy)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/瀛樺湪|闇€|妫€|绂佹|�/u);
});

test('uses one generic fallback and never renders unknown alert or injected backend fields', async () => {
  const injectedMarker = 'BACKEND_INJECTED_MARKER';
  vi.mocked(eventOperationsApi.summary).mockResolvedValue({ code: 200, message: 'OK', data: {
    ...summary,
    observability: {
      ...summary.observability,
      status: 'BLOCKED',
      backendTitle: injectedMarker,
      metrics: { ...summary.observability.metrics, injectedMetric: injectedMarker },
      alerts: [{
        code: injectedMarker,
        severity: 'BLOCKED',
        value: 7,
        threshold: 1,
        message: injectedMarker,
        rawError: injectedMarker,
      }],
    },
  } } as never);
  render(<EventOperationsPage />);

  expect(await screen.findByText('检测到未识别的事件运行告警，请停止灰度并联系系统维护人员。')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain(injectedMarker);
});

test('keeps the observability region accessible and exposes no mutation controls', async () => {
  render(<EventOperationsPage />);

  const region = await screen.findByRole('region', { name: '事件灰度状态' });
  expect(region).toHaveClass('event-observability');
  expect(region.querySelector('.event-observability-grid')).not.toBeNull();
  expect(screen.queryByRole('button', { name: /Worker.*(?:启用|停用)|删除|跳过|编辑|重放|回放|归档|清理/u })).not.toBeInTheDocument();
});

test('explicit refresh aborts stale dashboard work and keeps the newest observability result', async () => {
  render(<EventOperationsPage />);
  await screen.findByText('灰度状态：就绪');

  const staleSummary = deferred<unknown>();
  const staleList = deferred<unknown>();
  const currentSummary = deferred<unknown>();
  const currentList = deferred<unknown>();
  vi.mocked(eventOperationsApi.summary)
    .mockImplementationOnce(() => staleSummary.promise as never)
    .mockImplementationOnce(() => currentSummary.promise as never);
  vi.mocked(eventOperationsApi.list)
    .mockImplementationOnce(() => staleList.promise as never)
    .mockImplementationOnce(() => currentList.promise as never);

  fireEvent.click(screen.getByRole('button', { name: /刷新/u }));
  await waitFor(() => expect(eventOperationsApi.summary).toHaveBeenCalledTimes(2));
  const staleSummarySignal = vi.mocked(eventOperationsApi.summary).mock.calls[1][0] as AbortSignal;
  const staleListSignal = vi.mocked(eventOperationsApi.list).mock.calls[1][1] as AbortSignal;
  expect(staleSummarySignal).toBe(staleListSignal);
  expect(staleSummarySignal.aborted).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: /刷新/u }));
  await waitFor(() => expect(eventOperationsApi.summary).toHaveBeenCalledTimes(3));
  expect(staleSummarySignal.aborted).toBe(true);

  await act(async () => {
    currentSummary.resolve({ code: 200, message: 'OK', data: {
      ...summary,
      observability: { ...summary.observability, status: 'DEGRADED', mode: 'canary', alerts: [] },
    } });
    currentList.resolve({ code: 200, message: 'OK', data: emptyPage });
  });
  expect(await screen.findByText('灰度状态：需观察')).toBeInTheDocument();

  await act(async () => {
    staleSummary.resolve({ code: 200, message: 'OK', data: {
      ...summary,
      observability: { ...summary.observability, status: 'BLOCKED', alerts: [] },
    } });
    staleList.resolve({ code: 200, message: 'OK', data: emptyPage });
  });
  expect(screen.getByText('灰度状态：需观察')).toBeInTheDocument();
  expect(screen.queryByText('灰度状态：已阻断')).not.toBeInTheDocument();
});

test('shows persistent dispatcher degradation and identifies the internal read-only quarantine subscription', async () => {
  vi.mocked(eventOperationsApi.summary).mockResolvedValue({ code: 200, message: 'OK', data: {
    ...summary,
    worker: {
      ...summary.worker,
      status: 'degraded',
      unknownHandlerCount: 1,
      unresolvedDispatcherFaultCount: 1,
      lastDegradedAt: '2026-07-22T12:01:00.000Z',
      lastErrorCode: 'HANDLER_NOT_REGISTERED',
      lastErrorReference: '33333333-3333-4333-8333-333333333333',
    },
  } } as never);
  vi.mocked(eventOperationsApi.subscriptions).mockResolvedValue({ code: 200, message: 'OK', data: [{
    id: 'subscription:event-dispatch-quarantine-v1',
    code: 'event-dispatch-quarantine-v1',
    eventType: 'system.event.quarantine',
    eventVersion: 1,
    handlerCode: 'EVENT_DISPATCH_QUARANTINE',
    status: 'DISABLED',
    internal: true,
    filterSummary: { mode: 'ALL' },
    createdAt: '2026-07-22T12:00:00.000Z',
    updatedAt: '2026-07-22T12:00:00.000Z',
  }] } as never);
  render(<EventOperationsPage />);

  expect(await screen.findByText('事件处理健康状态已降级')).toBeInTheDocument();
  expect(screen.getByText('HANDLER_NOT_REGISTERED')).toBeInTheDocument();
  expect(screen.getByText('33333333-3333-4333-8333-333333333333')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('tab')[1]);
  expect(await screen.findByText('内部隔离（只读）')).toBeInTheDocument();
});

test('labels an internal quarantine detail and hides the ordinary retry action', async () => {
  const quarantine = {
    ...manualDelivery,
    id: 'quarantine-1',
    internal: true,
    handlerCode: 'EVENT_DISPATCH_QUARANTINE',
    lastErrorCode: 'EVENT_ENVELOPE_INVALID',
  } as const;
  vi.mocked(eventOperationsApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
    list: [quarantine], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  } } as never);
  vi.mocked(eventOperationsApi.detail).mockResolvedValue({ code: 200, message: 'OK', data: {
    ...detail,
    ...quarantine,
    payloadSummary: {},
    attemptsTotal: 0,
    attemptsTruncated: false,
    attempts: [],
  } } as never);
  render(<EventOperationsPage />);

  fireEvent.click(await screen.findByRole('button', { name: '查看投递 quarantine-1' }));
  expect(await screen.findByText('内部隔离记录不可普通重试，需部署支持并重新验证')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '人工重试 quarantine-1' })).not.toBeInTheDocument();
});

test('shows a bounded safe error state without exposing the thrown message', async () => {
  vi.mocked(eventOperationsApi.summary).mockRejectedValue(new Error('postgresql://secret@internal'));
  vi.mocked(eventOperationsApi.list).mockRejectedValue(new Error('raw worker stack secret-worker-1'));
  render(<EventOperationsPage />);

  expect(await screen.findByText('事件运维数据加载失败')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('postgresql://');
  expect(document.body.textContent).not.toContain('secret-worker-1');
});

test('applies bounded filters and requests the selected pagination page', async () => {
  vi.mocked(eventOperationsApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
    list: [manualDelivery], pagination: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
  } } as never);
  render(<EventOperationsPage />);

  await screen.findByRole('button', { name: '查看投递 d1' });
  fireEvent.change(screen.getByRole('combobox', { name: '投递状态' }), { target: { value: 'MANUAL' } });
  fireEvent.change(screen.getByRole('textbox', { name: '事件类型' }), { target: { value: 'admin.operation.reviewed' } });
  fireEvent.change(screen.getByRole('textbox', { name: '处理器' }), { target: { value: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION' } });
  fireEvent.change(screen.getByRole('combobox', { name: '对象类型' }), { target: { value: 'ADMIN_OPERATION' } });
  fireEvent.change(screen.getByRole('textbox', { name: '对象 ID' }), { target: { value: '11111111-1111-4111-8111-111111111111' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(eventOperationsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({
    page: 1, pageSize: 20, status: 'MANUAL', eventType: 'admin.operation.reviewed',
    handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION', objectType: 'ADMIN_OPERATION',
    objectId: '11111111-1111-4111-8111-111111111111',
  }), expect.any(AbortSignal)));

  const secondPage = document.querySelector('.ant-pagination-item-2');
  expect(secondPage).not.toBeNull();
  fireEvent.click(secondPage!);
  await waitFor(() => expect(eventOperationsApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 2 }), expect.any(AbortSignal),
  ));
  expect(screen.getByRole('textbox', { name: '事件类型' })).toHaveAttribute('maxlength', '200');
  expect(screen.getByRole('textbox', { name: '处理器' })).toHaveAttribute('maxlength', '100');
  expect(screen.getByRole('textbox', { name: '对象 ID' })).toHaveAttribute('maxlength', '200');
});

test('shows only safe detail fields and explains when attempts are truncated to the newest 200', async () => {
  vi.mocked(eventOperationsApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
    list: [manualDelivery], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  } } as never);
  vi.mocked(eventOperationsApi.detail).mockResolvedValue({ code: 200, message: 'OK', data: {
    ...detail,
    payload: { password: 'raw-secret-payload' },
    workerId: 'secret-worker-1', lockedBy: 'secret-lease-owner',
    attempts: [{ ...detail.attempts[0], rawError: 'raw stack trace', workerId: 'secret-worker-2' }],
  } } as never);
  render(<EventOperationsPage />);

  fireEvent.click(await screen.findByRole('button', { name: '查看投递 d1' }));
  expect(await screen.findByText('投递详情')).toBeInTheDocument();
  expect(screen.getByText('SYSTEM_ADMIN_GRANT')).toBeInTheDocument();
  expect(screen.getByText('仅展示最新 200 次，共 205 次')).toBeInTheDocument();
  expect(screen.getAllByText('GOVERNANCE_SOURCE_INVALID').length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toContain('raw-secret-payload');
  expect(document.body.textContent).not.toContain('raw stack trace');
  expect(document.body.textContent).not.toContain('secret-worker');
  expect(document.body.textContent).not.toContain('secret-lease-owner');
});

test('shows subscriptions as read-only safe summaries', async () => {
  vi.mocked(eventOperationsApi.subscriptions).mockResolvedValue({ code: 200, message: 'OK', data: [{
    id: 's1', code: 'admin-operation-reviewed-notification-v1', eventType: 'admin.operation.reviewed',
    eventVersion: 1, handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION', status: 'ENABLED',
    internal: false,
    filterSummary: { mode: 'FILTERED', conditions: [{ field: 'status', operator: 'IN', valueCount: 2 }] },
    createdAt: '2026-07-22T09:00:00.000Z', updatedAt: '2026-07-22T09:00:00.000Z',
    filterJson: { raw: 'must-not-render' },
  }] } as never);
  render(<EventOperationsPage />);

  fireEvent.click(screen.getByRole('tab', { name: '订阅状态' }));
  expect(await screen.findByText('admin-operation-reviewed-notification-v1')).toBeInTheDocument();
  expect(screen.getByText('status / 包含任一值（IN） / 2 个值')).toBeInTheDocument();
  expect(screen.getByText('已启用（ENABLED）')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑|启用|停用|删除/ })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('must-not-render');
});

test('renders code-owned Chinese labels for attempt outcomes', async () => {
  vi.mocked(eventOperationsApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
    list: [manualDelivery], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  } } as never);
  render(<EventOperationsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看投递 d1' }));
  expect(await screen.findByText('需要人工处理（MANUAL_REQUIRED）')).toBeInTheDocument();
});

test('keeps the latest selected detail when older requests resolve last', async () => {
  const d1Request = deferred<unknown>();
  const d2Request = deferred<unknown>();
  vi.mocked(eventOperationsApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
    list: [manualDelivery, manualDeliveryD2], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
  } } as never);
  vi.mocked(eventOperationsApi.detail).mockImplementation(id => (
    (id === 'd1' ? d1Request.promise : d2Request.promise) as never
  ));
  runStepUp.mockImplementation(() => new Promise(() => undefined));
  render(<EventOperationsPage />);

  fireEvent.click(await screen.findByRole('button', { name: '查看投递 d1' }));
  await waitFor(() => expect(eventOperationsApi.detail).toHaveBeenCalledWith('d1', expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: '查看投递 d2' }));
  await waitFor(() => expect(eventOperationsApi.detail).toHaveBeenCalledWith('d2', expect.any(AbortSignal)));
  await act(async () => { d2Request.resolve({ code: 200, message: 'OK', data: detailD2 }); });
  expect(await screen.findByText('D2_OPERATION')).toBeInTheDocument();
  await act(async () => { d1Request.resolve({ code: 200, message: 'OK', data: detail }); });
  expect(screen.getByText('D2_OPERATION')).toBeInTheDocument();
  expect(screen.queryByText('SYSTEM_ADMIN_GRANT')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '人工重试 d2' }));
  await waitFor(() => expect(runStepUp).toHaveBeenCalledWith(expect.objectContaining({
    target: { deliveryId: 'd2', expectedVersion: 11 },
  })));
});

test('keeps a newer filtered dashboard loading and ignores an older refresh failure', async () => {
  vi.mocked(eventOperationsApi.list).mockResolvedValueOnce({ code: 200, message: 'OK', data: {
    list: [manualDelivery], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  } } as never);
  const oldRefresh = deferred<unknown>();
  const newFilter = deferred<unknown>();
  vi.mocked(eventOperationsApi.list)
    .mockImplementationOnce(() => oldRefresh.promise as never)
    .mockImplementationOnce(() => newFilter.promise as never);
  render(<EventOperationsPage />);
  await screen.findByRole('button', { name: '查看投递 d1' });

  fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
  await waitFor(() => expect(eventOperationsApi.list).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByRole('textbox', { name: '事件类型' }), { target: { value: 'admin.operation.reviewed' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(eventOperationsApi.list).toHaveBeenCalledTimes(3));

  await act(async () => { oldRefresh.reject(new Error('stale raw database failure')); });
  expect(screen.getByLabelText('正在加载事件投递')).toBeInTheDocument();
  expect(screen.queryByText('事件运维数据加载失败')).not.toBeInTheDocument();
  await act(async () => { newFilter.resolve({ code: 200, message: 'OK', data: {
    list: [manualDeliveryD2], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  } }); });
  expect(await screen.findByRole('button', { name: '查看投递 d2' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看投递 d1' })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('stale raw database failure');
});

test('aborts outstanding detail work on unmount', async () => {
  const pendingDetail = deferred<unknown>();
  vi.mocked(eventOperationsApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
    list: [manualDelivery], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  } } as never);
  vi.mocked(eventOperationsApi.detail).mockImplementation(() => pendingDetail.promise as never);
  const view = render(<EventOperationsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看投递 d1' }));
  await waitFor(() => expect(eventOperationsApi.detail).toHaveBeenCalledOnce());
  const signal = vi.mocked(eventOperationsApi.detail).mock.calls[0][1] as AbortSignal;
  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { pendingDetail.resolve({ code: 200, message: 'OK', data: detail }); });
});

test('uses one layout main landmark and a named search region for filters', async () => {
  render(<MemoryRouter><MainLayout><EventOperationsPage /></MainLayout></MemoryRouter>);
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(await screen.findByRole('search', { name: '事件投递筛选' })).toBeInTheDocument();
});

test('loads after the development StrictMode effect remount', async () => {
  render(<StrictMode><EventOperationsPage /></StrictMode>);
  expect(await screen.findByText('暂无投递')).toBeInTheDocument();
  expect(eventOperationsApi.summary).toHaveBeenCalled();
  expect(eventOperationsApi.list).toHaveBeenCalled();
});

test('binds MANUAL retry to delivery version, forwards token directly, closes detail and refreshes', async () => {
  const success = vi.spyOn(message, 'success').mockImplementation(() => undefined as never);
  vi.mocked(eventOperationsApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
    list: [manualDelivery], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  } } as never);
  render(<EventOperationsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看投递 d1' }));
  await screen.findByText('投递详情');
  fireEvent.click(screen.getByRole('button', { name: '人工重试 d1' }));

  await waitFor(() => expect(runStepUp).toHaveBeenCalledOnce());
  const request = runStepUp.mock.calls[0][0];
  expect(request).toMatchObject({
    purpose: 'EVENT_DELIVERY_RETRY',
    target: { deliveryId: 'd1', expectedVersion: 7 },
  });
  expect(request.impact).toContain('重新执行业务处理器');
  expect(eventOperationsApi.retry).toHaveBeenCalledWith('d1', 7, 'one-time-step-up');
  await waitFor(() => expect(eventOperationsApi.summary).toHaveBeenCalledTimes(2));
  expect(eventOperationsApi.list).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('投递详情')).not.toBeInTheDocument();
  expect(success).toHaveBeenCalledWith('人工重试已提交');
  expect(localStorage.length).toBe(0);
  success.mockRestore();
});

test('keeps the detail safe on Step-Up cancellation and refreshes stale detail on conflict', async () => {
  vi.mocked(eventOperationsApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
    list: [manualDelivery], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  } } as never);
  runStepUp.mockRejectedValueOnce(new Error('STEP_UP_CANCELLED'));
  render(<EventOperationsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看投递 d1' }));
  await screen.findByText('投递详情');
  fireEvent.click(screen.getByRole('button', { name: '人工重试 d1' }));
  await waitFor(() => expect(runStepUp).toHaveBeenCalledOnce());
  expect(eventOperationsApi.retry).not.toHaveBeenCalled();
  expect(screen.getByText('投递详情')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: '人工重试 d1' })).not.toBeDisabled());

  runStepUp.mockRejectedValueOnce({ response: { status: 409, data: { message: 'AUTHORIZATION_VERSION_CONFLICT' } } });
  fireEvent.click(screen.getByRole('button', { name: '人工重试 d1' }));
  await waitFor(() => expect(eventOperationsApi.detail).toHaveBeenCalledTimes(2));
  expect(screen.getByText('投递状态已变化，请刷新后重试')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('AUTHORIZATION_VERSION_CONFLICT');
});
