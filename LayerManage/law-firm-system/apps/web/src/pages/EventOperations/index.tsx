import Table from '@/components/ResizableTable';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Space,
  Spin,
  Statistic,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import StepUpDialog from '@/features/auth/components/StepUpDialog';
import { useStepUp } from '@/features/auth/useStepUp';
import { eventOperationsApi } from '@/features/event-operations/api';
import type {
  EventDeliveryDetail,
  EventDeliveryListQuery,
  EventDeliveryStatus,
  EventDeliverySummary,
  EventObservabilitySummary,
  EventOperationsSummary,
  EventRolloutStatus,
  EventSubscriptionSummary,
} from '@/features/event-operations/types';
import { useAuthStore } from '@/stores/authStore';
import './event-operations.css';

const STATUS_LABELS: Record<EventDeliveryStatus, string> = {
  PENDING: '待处理',
  RETRY_WAIT: '等待重试',
  PROCESSING: '处理中',
  MANUAL: '人工处理',
  SUCCEEDED: '已成功',
};

const STATUS_COLORS: Record<EventDeliveryStatus, string> = {
  PENDING: 'default', RETRY_WAIT: 'warning', PROCESSING: 'processing', MANUAL: 'error', SUCCEEDED: 'success',
};

const ATTEMPT_OUTCOME_LABELS: Record<EventDeliveryDetail['attempts'][number]['outcome'], string> = {
  SUCCEEDED: '执行成功（SUCCEEDED）',
  RETRY_SCHEDULED: '已安排重试（RETRY_SCHEDULED）',
  MANUAL_REQUIRED: '需要人工处理（MANUAL_REQUIRED）',
  LEASE_LOST: '租约已丢失（LEASE_LOST）',
};

const SUBSCRIPTION_STATUS_LABELS: Record<EventSubscriptionSummary['status'], string> = {
  ENABLED: '已启用（ENABLED）',
  DISABLED: '已停用（DISABLED）',
};

const FILTER_OPERATOR_LABELS: Record<'EQ' | 'IN', string> = {
  EQ: '等于（EQ）',
  IN: '包含任一值（IN）',
};

type ApprovedObservabilityAlertCode =
  | 'EVENT_OBS_MODE_MISMATCH'
  | 'EVENT_OBS_MANUAL_PRESENT'
  | 'EVENT_OBS_DISPATCHER_FAULT'
  | 'EVENT_OBS_DATABASE_FAILURES'
  | 'EVENT_OBS_WORKER_TICK_STALE'
  | 'EVENT_OBS_UNDISPATCHED_STALE'
  | 'EVENT_OBS_DUE_BACKLOG_STALE'
  | 'EVENT_OBS_LEASE_LOST'
  | 'EVENT_OBS_LEASE_LOST_EXCESSIVE'
  | 'EVENT_OBS_PROCESSING_LEASE_STALE';

const OBSERVABILITY_COPY: Readonly<Record<ApprovedObservabilityAlertCode, string>> = {
  EVENT_OBS_MODE_MISMATCH: '当前 Worker 运行状态与检查模式不一致，请按发布流程核对 Worker 开关和运行状态。',
  EVENT_OBS_MANUAL_PRESENT: '存在需要人工处理的投递，请先完成故障排查和受控处置，再继续灰度。',
  EVENT_OBS_DISPATCHER_FAULT: '存在未解决的调度故障，请先修复兼容代码或受控配置并重新验证。',
  EVENT_OBS_DATABASE_FAILURES: 'Worker 连续访问数据库失败，请检查数据库可用性，恢复后重新刷新评估。',
  EVENT_OBS_WORKER_TICK_STALE: 'Worker 心跳或最近成功执行已过期，请检查应用进程与数据库连接。',
  EVENT_OBS_UNDISPATCHED_STALE: '存在长时间未分派的事件，请检查调度流程并阻止继续灰度。',
  EVENT_OBS_DUE_BACKLOG_STALE: '存在长时间未处理的到期积压，请检查 Worker 处理能力与依赖状态。',
  EVENT_OBS_LEASE_LOST: '近期出现租约丢失，请观察 Worker 并发与处理耗时后再继续扩大灰度。',
  EVENT_OBS_LEASE_LOST_EXCESSIVE: '近期租约丢失次数过多，请停止灰度并排查并发、超时和进程稳定性。',
  EVENT_OBS_PROCESSING_LEASE_STALE: '存在租约过期后仍未恢复的处理中投递，请停止灰度并排查恢复流程。',
};

const UNKNOWN_OBSERVABILITY_COPY = '检测到未识别的事件运行告警，请停止灰度并联系系统维护人员。';

const OBSERVABILITY_STATUS_PRESENTATION: Readonly<Record<EventRolloutStatus, {
  title: string;
  description: string;
  alertType: 'success' | 'warning' | 'error';
}>> = {
  READY: {
    title: '灰度状态：就绪',
    description: '当前门禁已通过，可按发布流程继续。',
    alertType: 'success',
  },
  DEGRADED: {
    title: '灰度状态：需观察',
    description: '检测到需观察项，请在继续灰度前确认处置建议。',
    alertType: 'warning',
  },
  BLOCKED: {
    title: '灰度状态：已阻断',
    description: '当前不满足灰度条件，请停止推进并完成处置。',
    alertType: 'error',
  },
};

const OBSERVABILITY_MODE_LABELS: Readonly<Record<EventObservabilitySummary['mode'], string>> = {
  preflight: '发布前检查（preflight）',
  canary: '灰度运行（canary）',
};

type FilterDraft = {
  status: '' | EventDeliveryStatus;
  eventType: string;
  handlerCode: string;
  objectType: '' | 'ADMIN_OPERATION';
  objectId: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: FilterDraft = {
  status: '', eventType: '', handlerCode: '', objectType: '', objectId: '', from: '', to: '',
};

export default function EventOperationsPage() {
  const stepUp = useStepUp();
  const permissions = useAuthStore(state => state.authorization?.permissions ?? []);
  const canRetry = permissions.includes('event.delivery.retry');
  const [summary, setSummary] = useState<EventOperationsSummary | null>(null);
  const [rows, setRows] = useState<EventDeliverySummary[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [query, setQuery] = useState<EventDeliveryListQuery>({ page: 1, pageSize: 20 });
  const [filters, setFilters] = useState<FilterDraft>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDeliveryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [subscriptions, setSubscriptions] = useState<EventSubscriptionSummary[]>([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [subscriptionsLoaded, setSubscriptionsLoaded] = useState(false);
  const [subscriptionsError, setSubscriptionsError] = useState(false);
  const mountedRef = useRef(true);
  const queryRef = useRef(query);
  const detailIdRef = useRef<string | null>(null);
  const dashboardGenerationRef = useRef(0);
  const detailGenerationRef = useRef(0);
  const subscriptionsGenerationRef = useRef(0);
  const dashboardAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const subscriptionsAbortRef = useRef<AbortController | null>(null);

  const loadDashboard = useCallback(async (requestedQuery: EventDeliveryListQuery) => {
    const generation = ++dashboardGenerationRef.current;
    dashboardAbortRef.current?.abort();
    const controller = new AbortController();
    dashboardAbortRef.current = controller;
    if (!mountedRef.current) return;
    setLoading(true);
    setLoadError(false);
    try {
      const [summaryResponse, listResponse] = await Promise.all([
        eventOperationsApi.summary(controller.signal),
        eventOperationsApi.list(requestedQuery, controller.signal),
      ]);
      if (!isCurrentRequest(mountedRef, dashboardGenerationRef, generation)) return;
      setSummary(summaryResponse.data);
      setRows(listResponse.data.list);
      setPagination(listResponse.data.pagination);
    } catch {
      if (!isCurrentRequest(mountedRef, dashboardGenerationRef, generation)) return;
      setLoadError(true);
    } finally {
      if (isCurrentRequest(mountedRef, dashboardGenerationRef, generation)) {
        if (dashboardAbortRef.current === controller) dashboardAbortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const generation = ++detailGenerationRef.current;
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    if (!mountedRef.current || detailIdRef.current !== id) return;
    setDetailLoading(true);
    setDetailError(false);
    try {
      const response = await eventOperationsApi.detail(id, controller.signal);
      if (!isCurrentDetailRequest(mountedRef, detailGenerationRef, generation, detailIdRef, id)) return;
      setDetail(response.data);
    } catch {
      if (!isCurrentDetailRequest(mountedRef, detailGenerationRef, generation, detailIdRef, id)) return;
      setDetail(null);
      setDetailError(true);
    } finally {
      if (isCurrentDetailRequest(mountedRef, detailGenerationRef, generation, detailIdRef, id)) {
        if (detailAbortRef.current === controller) detailAbortRef.current = null;
        setDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      dashboardGenerationRef.current += 1;
      detailGenerationRef.current += 1;
      subscriptionsGenerationRef.current += 1;
      dashboardAbortRef.current?.abort();
      detailAbortRef.current?.abort();
      subscriptionsAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadDashboard(query);
    });
    return () => { active = false; };
  }, [loadDashboard, query]);

  const openDetail = (id: string) => {
    detailIdRef.current = id;
    setDetailId(id);
    setDetail(null);
    setRetryError(null);
    void loadDetail(id);
  };

  const closeDetail = () => {
    detailIdRef.current = null;
    detailGenerationRef.current += 1;
    detailAbortRef.current?.abort();
    detailAbortRef.current = null;
    setDetailId(null);
    setDetail(null);
    setDetailLoading(false);
    setDetailError(false);
    setRetryError(null);
  };

  const loadSubscriptions = async () => {
    if (subscriptionsLoaded || subscriptionsLoading) return;
    const generation = ++subscriptionsGenerationRef.current;
    subscriptionsAbortRef.current?.abort();
    const controller = new AbortController();
    subscriptionsAbortRef.current = controller;
    if (!mountedRef.current) return;
    setSubscriptionsLoading(true);
    setSubscriptionsError(false);
    try {
      const response = await eventOperationsApi.subscriptions(controller.signal);
      if (!isCurrentRequest(mountedRef, subscriptionsGenerationRef, generation)) return;
      setSubscriptions(response.data);
      setSubscriptionsLoaded(true);
    } catch {
      if (!isCurrentRequest(mountedRef, subscriptionsGenerationRef, generation)) return;
      setSubscriptionsError(true);
    } finally {
      if (isCurrentRequest(mountedRef, subscriptionsGenerationRef, generation)) {
        if (subscriptionsAbortRef.current === controller) subscriptionsAbortRef.current = null;
        setSubscriptionsLoading(false);
      }
    }
  };

  const applyFilters = () => {
    setQuery({
      page: 1,
      pageSize: pagination.pageSize,
      status: filters.status || undefined,
      eventType: normalizeText(filters.eventType),
      handlerCode: normalizeText(filters.handlerCode),
      objectType: filters.objectType || undefined,
      objectId: normalizeText(filters.objectId),
      from: toUtcTimestamp(filters.from),
      to: toUtcTimestamp(filters.to),
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  };

  const retryDelivery = async (delivery: EventDeliveryDetail) => {
    setRetrying(true);
    setRetryError(null);
    try {
      await stepUp.run({
        purpose: 'EVENT_DELIVERY_RETRY',
        target: { deliveryId: delivery.id, expectedVersion: delivery.version },
        impact: `将针对投递 ${delivery.id} 重新执行业务处理器 ${delivery.handlerCode}。处理器可能再次写入业务结果，请确认已完成故障排查。`,
        mutate: token => eventOperationsApi.retry(delivery.id, delivery.version, token),
      });
      if (!mountedRef.current) return;
      if (detailIdRef.current === delivery.id) closeDetail();
      await loadDashboard(queryRef.current);
      if (!mountedRef.current) return;
      message.success('人工重试已提交');
    } catch (error) {
      if (!mountedRef.current) return;
      if (isStepUpCancelled(error)) return;
      if (isQuarantinedDelivery(error)) {
        if (detailIdRef.current === delivery.id) {
          setRetryError('内部隔离记录不可普通重试，需部署支持并重新验证');
        }
        return;
      }
      if (isVersionConflict(error)) {
        if (detailIdRef.current === delivery.id) setRetryError('投递状态已变化，请刷新后重试');
        const refreshes: Array<Promise<void>> = [loadDashboard(queryRef.current)];
        if (detailIdRef.current === delivery.id) refreshes.push(loadDetail(delivery.id));
        await Promise.allSettled(refreshes);
        return;
      }
      if (detailIdRef.current === delivery.id) setRetryError('人工重试未完成，请稍后重试');
    } finally {
      if (mountedRef.current) setRetrying(false);
    }
  };

  const columns: TableProps<EventDeliverySummary>['columns'] = [
    {
      title: '状态', dataIndex: 'status', width: 110,
      render: (status: EventDeliveryStatus) => <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>,
    },
    { title: '事件类型', dataIndex: ['event', 'eventType'], ellipsis: true },
    { title: '处理器', dataIndex: 'handlerCode', ellipsis: true },
    { title: '对象', key: 'object', render: (_, row) => `${row.event.objectType} / ${row.event.objectId}` },
    { title: '尝试', dataIndex: 'attemptCount', width: 72 },
    { title: '更新时间', dataIndex: 'updatedAt', width: 180, render: formatDateTime },
    {
      title: '操作', key: 'actions', width: 110,
      render: (_, row) => <Button type="link" aria-label={`查看投递 ${row.id}`} onClick={() => openDetail(row.id)}>查看</Button>,
    },
  ];

  const deliveryPanel = (
    <>
      {summary && <EventObservabilityPanel summary={summary.observability} />}
      {summary?.worker.status === 'degraded' && (
        <Alert
          type="warning"
          showIcon
          title="事件处理健康状态已降级"
          description={(
            <Space direction="vertical" size={2}>
              <span>
                未解决调度故障 {summary.worker.unresolvedDispatcherFaultCount} 个；连续数据库故障 {summary.worker.consecutiveDatabaseFailures} 次
              </span>
              <span>错误码：<SafeError value={summary.worker.lastErrorCode} /></span>
              <span>错误引用：<SafeError value={summary.worker.lastErrorReference} /></span>
            </Space>
          )}
          style={{ marginBottom: 16 }}
        />
      )}
      <div className="event-summary-grid">
        {(['PENDING', 'RETRY_WAIT', 'MANUAL', 'SUCCEEDED'] as const).map(status => (
          <Card key={status} size="small"><Statistic title={STATUS_LABELS[status]} value={summary?.counts[status] ?? 0} /></Card>
        ))}
        <Card size="small" className="event-summary-wide"><Statistic title="最近 24 小时成功率" value={formatRate(summary?.recent24Hours.successRate ?? 0)} /></Card>
        <Card size="small" className="event-summary-wide"><Statistic title="最长积压" value={formatDuration(summary?.longestBacklogSeconds ?? 0)} /></Card>
      </div>

      <div className="event-filters" role="search" aria-label="事件投递筛选">
        <select aria-label="投递状态" value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value as FilterDraft['status'] }))}>
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Input aria-label="事件类型" placeholder="事件类型" maxLength={200} value={filters.eventType} onChange={event => setFilters(current => ({ ...current, eventType: event.target.value }))} />
        <Input aria-label="处理器" placeholder="处理器代码" maxLength={100} value={filters.handlerCode} onChange={event => setFilters(current => ({ ...current, handlerCode: event.target.value }))} />
        <select aria-label="对象类型" value={filters.objectType} onChange={event => setFilters(current => ({ ...current, objectType: event.target.value as FilterDraft['objectType'] }))}>
          <option value="">全部对象</option>
          <option value="ADMIN_OPERATION">管理员治理操作</option>
        </select>
        <Input aria-label="对象 ID" placeholder="对象 ID" maxLength={200} value={filters.objectId} onChange={event => setFilters(current => ({ ...current, objectId: event.target.value }))} />
        <Input aria-label="开始时间" type="datetime-local" value={filters.from} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} />
        <Input aria-label="结束时间" type="datetime-local" value={filters.to} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} />
        <Button type="primary" onClick={applyFilters}>应用筛选</Button>
        <Button onClick={() => { setFilters(EMPTY_FILTERS); setQuery({ page: 1, pageSize: pagination.pageSize }); }}>重置</Button>
      </div>

      {loadError && <Alert type="error" showIcon title="事件运维数据加载失败" action={<Button onClick={() => void loadDashboard(queryRef.current)}>重新加载</Button>} />}
      {loading ? (
        <div aria-label="正在加载事件投递" style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}><Spin /></div>
      ) : (
        <Table<EventDeliverySummary>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          scroll={{ x: 980 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无投递" /> }}
          pagination={{
            current: pagination.page,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: false,
            onChange: (page, pageSize) => setQuery(current => ({ ...current, page, pageSize })),
          }}
        />
      )}
    </>
  );

  const subscriptionsPanel = (
    <>
      {subscriptionsError && <Alert type="error" showIcon title="订阅状态加载失败" />}
      <Table<EventSubscriptionSummary>
        rowKey="id"
        loading={subscriptionsLoading}
        dataSource={subscriptions}
        pagination={false}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无订阅" /> }}
        columns={[
          { title: '订阅代码', dataIndex: 'code' },
          { title: '范围', key: 'scope', render: (_, row) => row.internal ? '内部隔离（只读）' : '业务订阅（只读）' },
          { title: '事件类型', key: 'event', render: (_, row) => `${row.eventType}.v${row.eventVersion}` },
          { title: '处理器', dataIndex: 'handlerCode' },
          { title: '状态', dataIndex: 'status', render: status => <Tag>{SUBSCRIPTION_STATUS_LABELS[status as EventSubscriptionSummary['status']]}</Tag> },
          { title: '安全过滤摘要', key: 'filter', render: (_, row) => formatFilterSummary(row) },
        ]}
      />
    </>
  );

  return (
    <section className="event-operations-page" aria-labelledby="event-operations-title">
      <div className="event-operations-heading">
        <div><h1 id="event-operations-title">事件运维</h1><p>查看投递健康状态、安全错误证据并处理人工队列。</p></div>
        <Button icon={<ReloadOutlined />} onClick={() => void loadDashboard(queryRef.current)}>刷新</Button>
      </div>
      <Tabs
        defaultActiveKey="deliveries"
        onChange={key => { if (key === 'subscriptions') void loadSubscriptions(); }}
        items={[
          { key: 'deliveries', label: '投递监控', children: deliveryPanel },
          { key: 'subscriptions', label: '订阅状态', children: subscriptionsPanel },
        ]}
      />
      <Drawer title="投递详情" size="large" open={detailId !== null} onClose={closeDetail} destroyOnHidden>
        {detailLoading && <div style={{ minHeight: 160, display: 'grid', placeItems: 'center' }}><Spin /></div>}
        {detailError && <Alert type="error" showIcon title="投递详情加载失败" />}
        {retryError && <Alert type="warning" showIcon title={retryError} style={{ marginBottom: 16 }} />}
        {detail && <EventDeliveryDetailView detail={detail} canRetry={canRetry} retrying={retrying} onRetry={retryDelivery} />}
      </Drawer>
      <StepUpDialog {...stepUp.dialogProps} />
    </section>
  );
}

function EventObservabilityPanel({ summary }: { summary: EventObservabilitySummary }) {
  const presentation = OBSERVABILITY_STATUS_PRESENTATION[summary.status];
  const metrics = summary.metrics;
  return (
    <section className="event-observability" role="region" aria-label="事件灰度状态">
      <Alert
        type={presentation.alertType}
        showIcon
        title={presentation.title}
        description={(
          <div>
            <p className="event-observability-status-copy">{presentation.description}</p>
            <div className="event-observability-meta">
              <span>{OBSERVABILITY_MODE_LABELS[summary.mode]}</span>
              <span>评估时间：{formatUtcDateTime(summary.evaluatedAt)}</span>
            </div>
            {summary.alerts.length > 0 && (
              <ol className="event-observability-alerts" aria-label="灰度处置建议">
                {summary.alerts.map((alert, index) => (
                  <li key={`${index}-${alert.severity}`}>{observabilityAlertCopy(alert.code)}</li>
                ))}
              </ol>
            )}
          </div>
        )}
      />
      <div className="event-observability-grid" role="list" aria-label="事件可观测性指标">
        <ObservabilityMetric title="未分派事件" value={String(metrics.undispatchedCount)} />
        <ObservabilityMetric title="最老未分派年龄" value={formatDuration(metrics.oldestUndispatchedSeconds)} />
        <ObservabilityMetric title="到期积压" value={String(metrics.dueBacklogCount)} />
        <ObservabilityMetric title="最老到期积压年龄" value={formatDuration(metrics.oldestDueBacklogSeconds)} />
        <ObservabilityMetric title="人工处理" value={String(metrics.manualCount)} />
        <ObservabilityMetric title="处理中" value={String(metrics.processingCount)} />
        <ObservabilityMetric title="租约已过期" value={String(metrics.expiredProcessingCount)} />
        <ObservabilityMetric title="长期过期未恢复" value={String(metrics.staleExpiredProcessingCount)} />
        <ObservabilityMetric title="近 15 分钟租约丢失" value={String(metrics.leaseLost15mCount)} />
        <ObservabilityMetric title="最近成功执行" value={formatNullableUtcDateTime(metrics.lastSuccessfulTickAt)} />
        <ObservabilityMetric title="最近心跳" value={formatNullableUtcDateTime(metrics.lastHeartbeatAt)} />
      </div>
    </section>
  );
}

function ObservabilityMetric({ title, value }: { title: string; value: string }) {
  return (
    <div role="listitem" aria-label={`${title}：${value}`}>
      <Card size="small"><Statistic title={title} value={value} /></Card>
    </div>
  );
}

function observabilityAlertCopy(code: string): string {
  if (Object.prototype.hasOwnProperty.call(OBSERVABILITY_COPY, code)) {
    return OBSERVABILITY_COPY[code as ApprovedObservabilityAlertCode];
  }
  return UNKNOWN_OBSERVABILITY_COPY;
}

function EventDeliveryDetailView({
  detail,
  canRetry,
  retrying,
  onRetry,
}: {
  detail: EventDeliveryDetail;
  canRetry: boolean;
  retrying: boolean;
  onRetry: (delivery: EventDeliveryDetail) => Promise<void>;
}) {
  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Tag color={STATUS_COLORS[detail.status]}>{STATUS_LABELS[detail.status]}</Tag>
        {detail.status === 'MANUAL' && canRetry && !detail.internal && (
          <Button type="primary" danger loading={retrying} aria-label={`人工重试 ${detail.id}`} onClick={() => void onRetry(detail)}>人工重试</Button>
        )}
      </Space>
      {detail.internal && (
        <Alert
          type="warning"
          showIcon
          title="内部隔离记录不可普通重试，需部署支持并重新验证"
          style={{ marginBottom: 16 }}
        />
      )}
      <Descriptions size="small" bordered column={1}>
        <Descriptions.Item label="投递 ID">{detail.id}</Descriptions.Item>
        <Descriptions.Item label="处理器">{detail.handlerCode}</Descriptions.Item>
        <Descriptions.Item label="版本">{detail.version}</Descriptions.Item>
        <Descriptions.Item label="尝试次数">{detail.attemptCount}</Descriptions.Item>
        <Descriptions.Item label="人工重试次数">{detail.manualRetryCount}</Descriptions.Item>
        <Descriptions.Item label="下次执行">{formatNullableDateTime(detail.nextAttemptAt)}</Descriptions.Item>
        <Descriptions.Item label="错误码"><SafeError value={detail.lastErrorCode} /></Descriptions.Item>
        <Descriptions.Item label="错误引用"><SafeError value={detail.lastErrorReference} /></Descriptions.Item>
      </Descriptions>

      <h3 className="event-detail-section">安全事件摘要</h3>
      <Descriptions size="small" bordered column={1}>
        <Descriptions.Item label="事件类型">{detail.event.eventType}.v{detail.event.eventVersion}</Descriptions.Item>
        <Descriptions.Item label="来源模块">{detail.event.sourceModule}</Descriptions.Item>
        <Descriptions.Item label="业务对象">{detail.event.objectType} / {detail.event.objectId}</Descriptions.Item>
        <Descriptions.Item label="Trace ID">{detail.event.traceId}</Descriptions.Item>
        <Descriptions.Item label="发生时间">{formatDateTime(detail.event.occurredAt)}</Descriptions.Item>
        {Object.entries(detail.payloadSummary).map(([key, value]) => (
          <Descriptions.Item label={key} key={key}>{formatSafeScalar(value)}</Descriptions.Item>
        ))}
      </Descriptions>

      <h3 className="event-detail-section">尝试时间线</h3>
      {detail.attemptsTruncated && <Alert type="info" showIcon title={`仅展示最新 200 次，共 ${detail.attemptsTotal} 次`} style={{ marginBottom: 12 }} />}
      {detail.attempts.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无尝试记录" /> : (
        <ol className="event-attempt-list">
          {detail.attempts.map(attempt => (
            <li key={attempt.attemptNumber}>
              <Space wrap>
                <strong>第 {attempt.attemptNumber} 次</strong>
                <Tag>{ATTEMPT_OUTCOME_LABELS[attempt.outcome]}</Tag>
                <span>{attempt.durationMs} ms</span>
                <span>{formatDateTime(attempt.startedAt)}</span>
              </Space>
              {(attempt.errorCode || attempt.errorReference) && (
                <div className="event-safe-error"><SafeError value={attempt.errorCode} /> / <SafeError value={attempt.errorReference} /></div>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function SafeError({ value }: { value: string | null }) {
  return <span className="event-safe-error">{value ?? '—'}</span>;
}

function formatSafeScalar(value: string | number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function normalizeText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

function toUtcTimestamp(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('zh-CN', { hour12: false });
}

function formatNullableDateTime(value: string | null): string {
  return value ? formatDateTime(value) : '—';
}

function formatUtcDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : `${parsed.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function formatNullableUtcDateTime(value: string | null): string {
  return value ? formatUtcDateTime(value) : '—';
}

function formatRate(value: number): string {
  const bounded = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return `${(bounded * 100).toFixed(1)}%`;
}

function formatDuration(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes} 分钟`);
  parts.push(`${remainder} 秒`);
  return parts.join(' ');
}

function formatFilterSummary(subscription: EventSubscriptionSummary): string {
  const summary = subscription.filterSummary;
  if (summary.mode === 'ALL') return '全部事件';
  if (summary.mode === 'INVALID') return '过滤配置无效';
  if (summary.conditions.length === 0) return '无条件';
  return summary.conditions.map(condition => (
    `${condition.field} / ${FILTER_OPERATOR_LABELS[condition.operator]} / ${condition.valueCount} 个值`
  )).join('；');
}

function isStepUpCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === 'STEP_UP_CANCELLED';
}

function isVersionConflict(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { message?: string } } })?.response;
  return response?.status === 409 || response?.data?.message === 'AUTHORIZATION_VERSION_CONFLICT';
}

function isQuarantinedDelivery(error: unknown): boolean {
  const response = (error as { response?: { data?: { message?: string } } })?.response;
  return response?.data?.message === 'EVENT_DELIVERY_QUARANTINED';
}

function isCurrentRequest(
  mounted: { current: boolean },
  generationRef: { current: number },
  generation: number,
): boolean {
  return mounted.current && generationRef.current === generation;
}

function isCurrentDetailRequest(
  mounted: { current: boolean },
  generationRef: { current: number },
  generation: number,
  detailId: { current: string | null },
  requestedId: string,
): boolean {
  return isCurrentRequest(mounted, generationRef, generation) && detailId.current === requestedId;
}
