import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  DatePicker,
  Space,
  Spin,
  Tag,
  message,
} from 'antd';
import Modal from '@/components/DraggableModal';
import { Link, useParams, useSearchParams } from 'react-router';
import dayjs from 'dayjs';
import { paymentApi, type PaymentView } from '@/api/payment';
import { invoiceApi, type InvoiceView } from '@/api/invoice';
import { refundApi, type RefundView } from '@/api/refund';
import { costApi, type CostView } from '@/api/cost';
import { useAuthStore } from '@/stores/authStore';
import { requestErrorMessage as errorMessage } from '@/api/errors';
import { BusinessTableLinks } from '@/features/crm/BusinessWorkspacePage';
import StepUpDialog from '@/features/auth/components/StepUpDialog';
import { useStepUp } from '@/features/auth/useStepUp';
import type { PermissionCode } from '@/features/authorization/types';
import FinanceCreatePage from './FinanceCreatePage';

export type FinanceKind = 'payment' | 'invoice' | 'refund' | 'cost';
type RecordView = PaymentView | InvoiceView | RefundView | CostView;
const meta = {
  payment: { title: '收款', path: '/payments', source: 'PAYMENTS' },
  invoice: { title: '发票', path: '/invoices', source: 'INVOICES' },
  refund: { title: '退款减免', path: '/refunds', source: 'REFUNDS' },
  cost: { title: '成本', path: '/costs', source: 'COSTS' },
} as const;
const statusNames: Record<string, string> = {
  PENDING: '待处理',
  CONFIRMED: '已确认',
  VOIDED: '已冲销',
  REFUNDED: '已退款',
  APPROVED: '已批准',
  REJECTED: '已驳回',
  COMPLETED: '已完成',
  EXECUTED: '已执行',
};
const categories: Record<string, string> = {
  CHANNEL: '渠道成本',
  EVIDENCE: '取证成本',
  CASE_HANDLING: '办案成本',
  LABOR: '人工成本',
  OFFICE: '办公成本',
  REIMBURSEMENT: '报销成本',
};
type ActionName = 'confirm' | 'void' | 'approve' | 'reject' | 'complete' | 'execute' | 'edit' | 'delete';
const actionNames: Record<ActionName, string> = {
  confirm: '确认收款',
  void: '冲销收款',
  approve: '审批通过',
  reject: '驳回申请',
  complete: '完成开票',
  execute: '执行退款减免',
  edit: '编辑成本',
  delete: '删除成本',
};

export default function FinanceRecordPage({ kind }: { kind: FinanceKind }) {
  const { id } = useParams();
  return id ? (
    <FinanceDetail key={kind + ':' + id} id={id} kind={kind} />
  ) : (
    <FinanceCreatePage key={kind} kind={kind} />
  );
}
function FinanceDetail({ id, kind }: { id: string; kind: FinanceKind }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [params] = useSearchParams();
  const [record, setRecord] = useState<RecordView>();
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState(false);
  const [action, setAction] = useState<{ name: ActionName; record: RecordView }>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [form] = Form.useForm();
  const alive = useRef(true);
  const sequence = useRef(0);
  const stepUp = useStepUp();
  const returnParams = new URLSearchParams(params);
  if (returnParams.has('base')) returnParams.set('record', id);
  else returnParams.delete('record');
  const back = meta[kind].path + (returnParams.size ? '?' + returnParams.toString() : '');
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const result =
        kind === 'payment'
          ? await paymentApi.detail(id)
          : kind === 'invoice'
            ? await invoiceApi.detail(id)
            : kind === 'refund'
              ? await refundApi.detail(id)
              : await costApi.detail(id);
      if (!alive.current || request !== sequence.current) return;
      setRecord((previous) => (previous && previous.version > result.data.version ? previous : result.data));
      setError('');
    } catch (e) {
      if (!alive.current || request !== sequence.current) return;
      setError(errorMessage(e));
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status && [401, 403, 404].includes(status)) {
        setRecord(undefined);
        setAction(undefined);
        form.resetFields();
      }
    }
  }, [id, kind, form]);
  useEffect(() => {
    alive.current = true;
    if (removed)
      return () => {
        alive.current = false;
        sequence.current++;
      };
    // Load the authorized route record; refresh sets state only after the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = window.setInterval(() => {
      if (!removed) void refresh();
    }, 5000);
    const focus = () => {
      if (!removed) void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      alive.current = false;
      // Invalidate all outstanding reads, including those started after this effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh, removed]);
  const permission = (name: ActionName) =>
    (kind + '.' + (name === 'reject' ? 'approve' : name === 'edit' ? 'update' : name)) as PermissionCode;
  const available: ActionName[] = !record
    ? []
    : kind === 'cost'
      ? ['edit', 'delete']
      : record && 'status' in record
        ? kind === 'payment'
          ? record.status === 'PENDING'
            ? ['confirm']
            : record.status === 'CONFIRMED'
              ? ['void']
              : []
          : record.status === 'PENDING'
            ? ['approve', 'reject']
            : record.status === 'APPROVED'
              ? [kind === 'invoice' ? 'complete' : 'execute']
              : []
        : [];
  const open = (name: ActionName) => {
    if (!record) return;
    form.resetFields();
    if (name === 'edit' && 'occurredAt' in record)
      form.setFieldsValue({ amount: record.amount, occurredAt: dayjs(record.occurredAt), note: record.note });
    setActionError('');
    setAction({ name, record });
  };
  const submit = async () => {
    if (!action || busy || !hasPermission(permission(action.name))) return;
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const current = action.record;
      let result: { data: RecordView } | undefined;
      if (kind === 'payment') {
        result =
          action.name === 'confirm'
            ? await paymentApi.confirm(id)
            : await paymentApi.void(id, { reason: values.reason.trim() });
      } else if (kind === 'invoice') {
        result =
          action.name === 'approve'
            ? await invoiceApi.approve(id, { comment: values.comment?.trim() })
            : action.name === 'reject'
              ? await invoiceApi.reject(id, { comment: values.comment.trim() })
              : await invoiceApi.complete(id, { invoiceNo: values.invoiceNo?.trim() || undefined });
      } else if (kind === 'refund') {
        if (action.name === 'approve')
          result = await stepUp.run({
            purpose: 'REFUND_APPROVE',
            target: { refundRequestId: id, expectedVersion: current.version },
            impact: '批准当前退款或减免申请；后续仍需执行资金处理。',
            mutate: (token) => {
              if (!alive.current) throw new Error('STEP_UP_CANCELLED');
              return refundApi.approve(
                id,
                { comment: values.comment?.trim(), expectedVersion: current.version },
                token,
              );
            },
          });
        else
          result =
            action.name === 'reject'
              ? await refundApi.reject(id, { comment: values.comment.trim() })
              : await refundApi.execute(id, { comment: values.comment?.trim() });
      } else if (action.name === 'edit') {
        result = await costApi.update(id, {
          amount: values.amount,
          occurredAt: values.occurredAt.toISOString(),
          note: values.note?.trim() || '',
          version: current.version,
        });
      } else {
        await costApi.remove(id);
        if (alive.current) {
          setRemoved(true);
          setRecord(undefined);
        }
      }
      if (!alive.current) return;
      if (result)
        setRecord((previous) =>
          previous && previous.version > result.data.version ? previous : result.data,
        );
      setAction(undefined);
      form.resetFields();
      message.success('操作已完成');
    } catch (e) {
      if (alive.current && (e as Error).message !== 'STEP_UP_CANCELLED') setActionError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className="unified-area-page">
      <Space wrap>
        <Link to={back}>返回{meta[kind].title}工作表</Link>
        {record && <BusinessTableLinks source={meta[kind].source} recordId={id} />}
      </Space>
      <h1>{meta[kind].title}详情</h1>
      {error && (
        <Alert type="error" title={error} action={<Button onClick={() => void refresh()}>重试</Button>} />
      )}
      {removed ? (
        <Alert type="success" title="成本已删除" />
      ) : !record && !error ? (
        <Spin aria-label="正在读取单据" />
      ) : (
        record && (
          <>
            <Space wrap style={{ marginBottom: 16 }}>
              {'status' in record && <Tag>{statusNames[record.status] || record.status}</Tag>}
              {available
                .filter((name) => hasPermission(permission(name)))
                .map((name) => (
                  <Button
                    key={name}
                    danger={['void', 'delete', 'reject'].includes(name)}
                    onClick={() => open(name)}
                  >
                    {actionNames[name]}
                  </Button>
                ))}
              <Button onClick={() => void refresh()}>刷新</Button>
            </Space>
            <Card>
              <Descriptions
                bordered
                column={{ xs: 1, sm: 2, lg: 3 }}
                items={[
                  {
                    key: 'no',
                    label: '单据编号',
                    children:
                      'paymentNo' in record
                        ? record.paymentNo
                        : 'requestNo' in record
                          ? record.requestNo
                          : record.id,
                  },
                  { key: 'amount', label: '金额（元）', children: record.amount },
                  ...('category' in record
                    ? [
                        {
                          key: 'category',
                          label: '成本分类',
                          children: categories[record.category] || record.category,
                        },
                      ]
                    : []),
                  ...('type' in record
                    ? [
                        {
                          key: 'type',
                          label: '申请类型',
                          children: record.type === 'REFUND' ? '退款' : '减免',
                        },
                      ]
                    : []),
                  ...('contractId' in record
                    ? [
                        {
                          key: 'contract',
                          label: '关联合同',
                          children: hasPermission('contract.read') ? (
                            <Link to={'/contracts/' + record.contractId}>打开关联合同</Link>
                          ) : (
                            '按单据权限查看'
                          ),
                        },
                      ]
                    : []),
                  ...('linkedCase' in record && record.linkedCase
                    ? [
                        {
                          key: 'case',
                          label: '关联案件',
                          children: (
                            <Link to={'/cases/' + record.linkedCase.id}>
                              {record.linkedCase.caseNo} · {record.linkedCase.title}
                            </Link>
                          ),
                        },
                      ]
                    : []),
                  ...('caseId' in record && record.caseId && hasPermission('case.read')
                    ? [
                        {
                          key: 'case',
                          label: '关联案件',
                          children: <Link to={'/cases/' + record.caseId}>打开关联案件</Link>,
                        },
                      ]
                    : []),
                  ...('method' in record
                    ? [
                        { key: 'method', label: '收款方式', children: record.method || '—' },
                        { key: 'account', label: '收款账户', children: record.account || '—' },
                        {
                          key: 'paidAt',
                          label: '收款时间',
                          children: record.paidAt ? dayjs(record.paidAt).format('YYYY-MM-DD HH:mm') : '—',
                        },
                      ]
                    : []),
                  ...('invoiceNo' in record
                    ? [{ key: 'invoiceNo', label: '发票号码', children: record.invoiceNo || '—' }]
                    : []),
                  ...('occurredAt' in record
                    ? [
                        {
                          key: 'occurredAt',
                          label: '发生时间',
                          children: dayjs(record.occurredAt).format('YYYY-MM-DD HH:mm'),
                        },
                      ]
                    : []),
                  ...('reason' in record
                    ? [{ key: 'reason', label: '申请说明', children: record.reason || '—' }]
                    : []),
                  ...('note' in record ? [{ key: 'note', label: '备注', children: record.note || '—' }] : []),
                  ...('remark' in record
                    ? [{ key: 'remark', label: '备注', children: record.remark || '—' }]
                    : []),
                  ...('approvalComment' in record
                    ? [{ key: 'approval', label: '审批意见', children: record.approvalComment || '—' }]
                    : []),
                  ...('voidReason' in record
                    ? [{ key: 'voidReason', label: '冲销原因', children: record.voidReason || '—' }]
                    : []),
                  ...('sourceApprovalId' in record &&
                  record.sourceApprovalId &&
                  hasPermission('approval.read')
                    ? [
                        {
                          key: 'sourceApproval',
                          label: '来源审批',
                          children: (
                            <Link
                              to={
                                '/approvals?' +
                                new URLSearchParams({ instance: record.sourceApprovalId, role: 'APPLIED' })
                              }
                            >
                              打开原审批记录
                            </Link>
                          ),
                        },
                      ]
                    : []),
                  {
                    key: 'created',
                    label: '创建时间',
                    children: dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
                  },
                  {
                    key: 'updated',
                    label: '更新时间',
                    children: dayjs(record.updatedAt).format('YYYY-MM-DD HH:mm'),
                  },
                ]}
              />
            </Card>
          </>
        )
      )}
      <Modal
        title={action ? actionNames[action.name] : ''}
        open={!!action}
        confirmLoading={busy}
        closable={!busy}
        keyboard={!busy}
        okButtonProps={{ disabled: !!action && !hasPermission(permission(action.name)) }}
        okText="确认办理"
        onOk={() => void submit()}
        onCancel={() => {
          if (!busy) setAction(undefined);
        }}
        mask={{ closable: false }}
      >
        {actionError && <Alert type="error" title={actionError} />}
        {action && ['confirm', 'void', 'execute', 'delete'].includes(action.name) && (
          <p>请核对金额和关联单据后确认，操作会更新正式业务记录。</p>
        )}
        <Form form={form} layout="vertical" disabled={busy}>
          {action?.name === 'void' && (
            <Form.Item name="reason" label="冲销原因" rules={[{ required: true, whitespace: true }]}>
              <Input.TextArea maxLength={500} />
            </Form.Item>
          )}
          {action && ['approve', 'reject', 'execute'].includes(action.name) && (
            <Form.Item
              name="comment"
              label={action.name === 'reject' ? '驳回原因' : '办理意见'}
              rules={[{ required: action.name === 'reject', whitespace: true }]}
            >
              <Input.TextArea maxLength={500} />
            </Form.Item>
          )}
          {action?.name === 'complete' && (
            <Form.Item name="invoiceNo" label="发票号码（可留空自动生成）">
              <Input maxLength={100} />
            </Form.Item>
          )}
          {action?.name === 'edit' && (
            <>
              <Form.Item name="amount" label="金额（元）" rules={[{ required: true }]}>
                <InputNumber
                  stringMode
                  min="0.01"
                  max="9999999999999999.99"
                  precision={2}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item name="occurredAt" label="发生时间" rules={[{ required: true }]}>
                <DatePicker showTime />
              </Form.Item>
              <Form.Item name="note" label="备注">
                <Input.TextArea maxLength={500} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
      <StepUpDialog {...stepUp.dialogProps} />
    </div>
  );
}
