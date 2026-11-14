import { businessLabel } from '@/locales/business-labels';
import Table from '@/components/ResizableTable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  RetweetOutlined,
  StopOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import { Alert, Button, DatePicker, Empty, message, Select, Space, Tabs, Tag, Tooltip } from 'antd';
import Modal from '@/components/DraggableModal';
import axios from 'axios';
import { governanceApi, governanceErrorMessage } from '@/features/admin-governance/api';
import OperationCreateDrawer from '@/features/admin-governance/components/OperationCreateDrawer';
import OperationDetailDrawer from '@/features/admin-governance/components/OperationDetailDrawer';
import ReviewDialog from '@/features/admin-governance/components/ReviewDialog';
import { hashCanonicalPayload } from '@/features/admin-governance/canonical-json';
import { OPERATION_LABELS } from '@/features/admin-governance/form-rules';
import type {
  AdminOperationDetail,
  AdminOperationSummary,
  CreateGovernanceOperationInput,
  GovernanceCatalogEntry,
  GovernanceListScope,
  GovernanceStatus,
  GovernedOperationType,
} from '@/features/admin-governance/types';
import { useAuthStore } from '@/stores/authStore';
import StepUpDialog from '@/features/auth/components/StepUpDialog';
import { useStepUp } from '@/features/auth/useStepUp';
import './governance.css';

const STATUS_LABELS: Record<GovernanceStatus, string> = {
  PENDING_REVIEW: '待审核',
  APPROVED: '已批准',
  REJECTED: '已驳回',
  CANCELLED: '已撤销',
  EXECUTING: '执行中',
  SUCCEEDED: '执行成功',
  FAILED: '执行失败',
  PENDING_POST_REVIEW: '待事后审核',
  CONFIRMED: '已确认',
  FLAGGED: '已标记异常',
};
const STATUS_COLORS: Partial<Record<GovernanceStatus, string>> = {
  PENDING_REVIEW: 'gold',
  PENDING_POST_REVIEW: 'gold',
  APPROVED: 'blue',
  EXECUTING: 'processing',
  SUCCEEDED: 'success',
  CONFIRMED: 'success',
  FAILED: 'error',
  REJECTED: 'error',
  FLAGGED: 'error',
  CANCELLED: 'default',
};

function errorCode(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; code?: string } | undefined;
    return data?.message ?? data?.code ?? 'NETWORK_ERROR';
  }
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR';
}

export default function AdminGovernancePage({ initialOperationId }: { initialOperationId?: string } = {}) {
  const stepUp = useStepUp();
  const mounted = useRef(true),
    detailSequence = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const sequence = detailSequence;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  const authorization = useAuthStore((state) => state.authorization);
  const isSuper = Boolean(authorization?.isSystemSuperAdmin);
  const permissions = authorization?.permissions ?? [];
  const selfUserId = authorization?.userId;
  const [scope, setScope] = useState<GovernanceListScope>('mine');
  const [status, setStatus] = useState<GovernanceStatus | undefined>();
  const [operationType, setOperationType] = useState<GovernedOperationType | undefined>();
  const [dateRange, setDateRange] = useState<[string, string] | undefined>();
  const [catalog, setCatalog] = useState<GovernanceCatalogEntry[]>([]);
  const [rows, setRows] = useState<AdminOperationSummary[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewOperation, setReviewOperation] = useState<AdminOperationSummary | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminOperationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    kind: 'cancel' | 'retry';
    operation: AdminOperationSummary;
  } | null>(null);

  const canCreate = permissions.includes('governance.operation.create');
  const canReview = isSuper && permissions.includes('governance.review');
  const canRetry = isSuper && permissions.includes('governance.retry');
  const listQuery = useMemo(
    () => ({
      scope,
      status,
      operationType,
      from: dateRange?.[0],
      to: dateRange?.[1],
      page: pagination.page,
      pageSize: pagination.pageSize,
    }),
    [dateRange, operationType, pagination.page, pagination.pageSize, scope, status],
  );

  const loadOperations = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await governanceApi.list(listQuery);
      setRows(response.data.list);
      setPagination((current) => ({ ...current, total: response.data.pagination.total }));
    } catch {
      setRows([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [listQuery]);

  useEffect(() => {
    let active = true;
    governanceApi
      .catalog()
      .then((response) => {
        if (active) setCatalog(response.data);
      })
      .catch((error) => {
        if (active) message.error(governanceErrorMessage(errorCode(error)));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setLoading(true);
        setLoadError(false);
        return governanceApi.list(listQuery);
      })
      .then((response) => {
        if (!active || response === null) return;
        setRows(response.data.list);
        setPagination((current) => ({ ...current, total: response.data.pagination.total }));
      })
      .catch(() => {
        if (active) {
          setRows([]);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [listQuery]);

  const openDetail = useCallback(async (id: string) => {
    const seq = ++detailSequence.current;
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(false);
    try {
      const result = await governanceApi.detail(id);
      if (mounted.current && detailSequence.current === seq) setDetail(result.data);
    } catch {
      if (mounted.current && detailSequence.current === seq) setDetailError(true);
    } finally {
      if (mounted.current && detailSequence.current === seq) setDetailLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    if (initialOperationId)
      void Promise.resolve().then(() => {
        if (active) void openDetail(initialOperationId);
      });
    return () => {
      active = false;
    };
  }, [initialOperationId, openDetail]);

  useEffect(() => {
    const id = detailId || reviewOperation?.id || confirmation?.operation.id;
    if (!id) return;
    let active = true,
      pending = false;
    const validate = async () => {
      if (pending) return;
      pending = true;
      try {
        await governanceApi.detail(id);
      } catch {
        if (active) {
          detailSequence.current++;
          setDetail(null);
          setDetailError(true);
          setDetailLoading(false);
          setReviewOperation(null);
          setConfirmation(null);
        }
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(() => void validate(), 5000);
    window.addEventListener('focus', validate);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', validate);
    };
  }, [detailId, reviewOperation?.id, confirmation?.operation.id]);

  async function createOperation(input: CreateGovernanceOperationInput) {
    setSubmitting(true);
    try {
      const entry = catalog.find((item) => item.operationType === input.operationType);
      const created =
        entry && requiresStepUp(entry.riskLevel)
          ? await stepUp.run({
              purpose: 'ADMIN_GOVERNANCE_CREATE',
              target: {
                operationType: input.operationType,
                targetType: input.targetType,
                targetId: input.targetId,
                expectedTargetVersion: input.expectedTargetVersion,
                payloadHash: await hashCanonicalPayload(input.payload),
              },
              impact: `提交“${OPERATION_LABELS[input.operationType]}”治理申请`,
              mutate: (token) => governanceApi.create(input, token),
            })
          : await governanceApi.create(input);
      message.success('治理申请已提交');
      setCreateOpen(false);
      await loadOperations();
      void openDetail(created.data.id);
    } catch (error) {
      if (errorCode(error) !== 'STEP_UP_CANCELLED') message.error(governanceErrorMessage(errorCode(error)));
      throw error;
    } finally {
      setSubmitting(false);
    }
  }

  async function review(decision: 'APPROVE' | 'REJECT' | 'CONFIRM' | 'FLAG', comment?: string) {
    if (!reviewOperation) return;
    setSubmitting(true);
    try {
      const input = { decision, comment, expectedOperationVersion: reviewOperation.version };
      if (decision === 'APPROVE' && requiresStepUp(reviewOperation.riskLevel)) {
        await stepUp.run({
          purpose: 'ADMIN_GOVERNANCE_APPROVE',
          target: {
            operationId: reviewOperation.id,
            expectedOperationVersion: reviewOperation.version,
            decision: 'APPROVE',
          },
          impact: `批准治理申请 ${reviewOperation.operationNo}`,
          mutate: (token) => governanceApi.review(reviewOperation.id, input, token),
        });
      } else {
        await governanceApi.review(reviewOperation.id, input);
      }
      message.success('审核结论已提交');
      setReviewOperation(null);
      await loadOperations();
    } catch (error) {
      if (errorCode(error) !== 'STEP_UP_CANCELLED') message.error(governanceErrorMessage(errorCode(error)));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(operation: AdminOperationSummary) {
    try {
      await governanceApi.cancel(operation.id, { expectedOperationVersion: operation.version });
      message.success('治理申请已撤销');
      await loadOperations();
    } catch (error) {
      message.error(governanceErrorMessage(errorCode(error)));
    }
  }

  async function retry(operation: AdminOperationSummary) {
    try {
      const input = { expectedOperationVersion: operation.version };
      if (requiresStepUp(operation.riskLevel)) {
        await stepUp.run({
          purpose: 'ADMIN_GOVERNANCE_RETRY',
          target: { operationId: operation.id, expectedOperationVersion: operation.version },
          impact: `重试治理申请 ${operation.operationNo}`,
          mutate: (token) => governanceApi.retry(operation.id, input, token),
        });
      } else {
        await governanceApi.retry(operation.id, input);
      }
      message.success('已提交重试');
      await loadOperations();
    } catch (error) {
      if (errorCode(error) !== 'STEP_UP_CANCELLED') message.error(governanceErrorMessage(errorCode(error)));
    }
  }

  const columns = useMemo(
    () => [
      { title: '申请编号', dataIndex: 'operationNo', width: 190, fixed: 'left' as const },
      {
        title: '治理操作',
        dataIndex: 'operationType',
        width: 180,
        render: (value: GovernedOperationType) => OPERATION_LABELS[value],
      },
      {
        title: '风险',
        dataIndex: 'riskLevel',
        width: 90,
        render: (value: string) => <Tag>{businessLabel(value)}</Tag>,
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 120,
        render: (value: GovernanceStatus) => <Tag color={STATUS_COLORS[value]}>{STATUS_LABELS[value]}</Tag>,
      },
      {
        title: '目标',
        key: 'target',
        width: 210,
        render: (_: unknown, row: AdminOperationSummary) =>
          `${businessLabel(row.targetType)} · ${row.targetId}`,
      },
      { title: '申请人', dataIndex: 'requesterUserId', width: 180 },
      {
        title: '更新时间',
        dataIndex: 'updatedAt',
        width: 180,
        render: (value: string) => new Date(value).toLocaleString(),
      },
      {
        title: '操作',
        key: 'actions',
        width: 152,
        fixed: 'right' as const,
        render: (_: unknown, row: AdminOperationSummary) => {
          const administratorTargetConflict = row.targetType === 'USER' && row.targetId === selfUserId;
          const reviewable =
            canReview &&
            row.requesterUserId !== selfUserId &&
            !administratorTargetConflict &&
            (row.status === 'PENDING_REVIEW' || row.status === 'PENDING_POST_REVIEW');
          const cancellable = row.requesterUserId === selfUserId && row.status === 'PENDING_REVIEW';
          const retryable = canRetry && (row.status === 'FAILED' || row.status === 'APPROVED');
          return (
            <Space size={2}>
              <Tooltip title="查看详情">
                <Button
                  type="text"
                  icon={<EyeOutlined />}
                  aria-label={`查看 ${row.operationNo}`}
                  onClick={() => void openDetail(row.id)}
                />
              </Tooltip>
              {reviewable && (
                <Tooltip title="审核">
                  <Button
                    type="text"
                    icon={<AuditOutlined />}
                    aria-label={`审核 ${row.operationNo}`}
                    onClick={() => setReviewOperation(row)}
                  />
                </Tooltip>
              )}
              {cancellable && (
                <Tooltip title="撤销">
                  <Button
                    type="text"
                    danger
                    icon={<StopOutlined />}
                    aria-label={`撤销 ${row.operationNo}`}
                    onClick={() => setConfirmation({ kind: 'cancel', operation: row })}
                  />
                </Tooltip>
              )}
              {retryable && (
                <Tooltip title={row.status === 'APPROVED' ? '恢复执行' : '重试'}>
                  <Button
                    type="text"
                    icon={<RetweetOutlined />}
                    aria-label={`重试 ${row.operationNo}`}
                    onClick={() => setConfirmation({ kind: 'retry', operation: row })}
                  />
                </Tooltip>
              )}
            </Space>
          );
        },
      },
    ],
    [canRetry, canReview, openDetail, selfUserId],
  );

  const tabItems = [
    { key: 'mine', label: '我的申请' },
    ...(isSuper
      ? [
          { key: 'reviewable', label: '待我审核' },
          { key: 'all', label: '全部记录' },
        ]
      : []),
  ];

  return (
    <section className="governance-page">
      <div className="governance-heading">
        <div>
          <h1>管理员治理</h1>
          <p>高风险管理权限与主数据纠正的双人审核承业中心</p>
        </div>
        {canCreate && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            aria-label="新建治理申请"
            onClick={() => setCreateOpen(true)}
          >
            新建申请
          </Button>
        )}
      </div>
      <Tabs
        activeKey={scope}
        items={tabItems}
        onChange={(key) => {
          setScope(key as GovernanceListScope);
          setPagination((current) => ({ ...current, page: 1 }));
        }}
      />
      <div className="governance-toolbar">
        <Select
          allowClear
          placeholder="状态"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPagination((current) => ({ ...current, page: 1 }));
          }}
          options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <Select
          allowClear
          placeholder="治理操作"
          value={operationType}
          onChange={(value) => {
            setOperationType(value);
            setPagination((current) => ({ ...current, page: 1 }));
          }}
          options={catalog.map((item) => ({
            value: item.operationType,
            label: OPERATION_LABELS[item.operationType],
          }))}
        />
        <DatePicker.RangePicker
          onChange={(dates) => {
            setDateRange(
              dates?.[0] && dates[1]
                ? [dates[0].startOf('day').toISOString(), dates[1].endOf('day').toISOString()]
                : undefined,
            );
            setPagination((current) => ({ ...current, page: 1 }));
          }}
        />
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined />} aria-label="刷新治理记录" onClick={() => void loadOperations()} />
        </Tooltip>
      </div>
      {loadError ? (
        <Alert
          type="error"
          showIcon
          title="治理记录加载失败"
          description="请检查网络或权限后重试。"
          action={<Button onClick={() => void loadOperations()}>重新加载</Button>}
        />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 1320 }}
          locale={{ emptyText: <Empty description="暂无治理申请" /> }}
          pagination={{
            current: pagination.page,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            onChange: (page, pageSize) => setPagination({ ...pagination, page, pageSize }),
          }}
        />
      )}
      <OperationCreateDrawer
        open={createOpen}
        catalog={catalog}
        submitting={submitting}
        onClose={() => setCreateOpen(false)}
        onSubmit={createOperation}
      />
      <ReviewDialog
        operation={reviewOperation}
        submitting={submitting}
        onClose={() => setReviewOperation(null)}
        onSubmit={review}
      />
      <Modal
        open={Boolean(confirmation)}
        title={
          confirmation?.kind === 'cancel'
            ? '确认撤销这项待审核申请？'
            : confirmation?.operation.status === 'APPROVED'
              ? '确认恢复这项已批准但未完成的操作？'
              : '确认重试这项失败操作？'
        }
        okText={confirmation?.kind === 'cancel' ? '撤销' : '继续'}
        cancelText="返回"
        onCancel={() => setConfirmation(null)}
        onOk={async () => {
          if (!confirmation) return;
          if (confirmation.kind === 'cancel') await cancel(confirmation.operation);
          else await retry(confirmation.operation);
          setConfirmation(null);
        }}
        destroyOnHidden
      />
      <OperationDetailDrawer
        open={Boolean(detailId)}
        loading={detailLoading}
        error={detailError}
        detail={detail}
        onClose={() => {
          detailSequence.current++;
          setDetailId(null);
          setDetail(null);
        }}
        onReload={() => {
          if (detailId) void openDetail(detailId);
        }}
      />
      <StepUpDialog {...stepUp.dialogProps} />
    </section>
  );
}

function requiresStepUp(risk: string): boolean {
  return risk === 'HIGH' || risk === 'CRITICAL';
}
