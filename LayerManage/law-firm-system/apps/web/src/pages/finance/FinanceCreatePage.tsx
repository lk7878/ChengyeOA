import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  message,
} from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router';
import dayjs, { type Dayjs } from 'dayjs';
import { contractApi, type ContractView } from '@/api/contract';
import { paymentApi } from '@/api/payment';
import { invoiceApi } from '@/api/invoice';
import { refundApi, type RefundType } from '@/api/refund';
import { costApi, COST_CATEGORIES, type CostCategory } from '@/api/cost';
import { caseApi } from '@/api/business';
import request from '@/api/request';
import { requestErrorMessage } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { get } from '@/features/workspaces/api';
import type { Directory, Workspace } from '@/features/workspaces/types';
import { moneyBalance, moneyMinor } from '@/features/workspaces/money';
import FinanceChoicePicker, { type ChoiceLoader } from './FinanceChoicePicker';
import type { FinanceKind } from './FinanceRecordPage';

const names = { payment: '登记收款', invoice: '申请发票', refund: '申请退款减免', cost: '登记成本' };
const paths = { payment: '/payments', invoice: '/invoices', refund: '/refunds', cost: '/costs' };
const categories: Record<CostCategory, string> = {
  CHANNEL: '渠道成本',
  EVIDENCE: '取证成本',
  CASE_HANDLING: '办案成本',
  LABOR: '人工成本',
  OFFICE: '办公成本',
  REIMBURSEMENT: '报销成本',
};
interface Values {
  workspaceId: string;
  branchId?: string;
  contractId?: string;
  paymentPlanId?: string;
  amount: string;
  method?: string;
  account?: string;
  paidAt?: Dayjs;
  remark?: string;
  reason?: string;
  type: RefundType;
  paymentId?: string;
  planId?: string;
  category: CostCategory;
  occurredAt: Dayjs;
  note?: string;
  caseId?: string;
  channelId?: string;
}
export default function FinanceCreatePage({ kind }: { kind: FinanceKind }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [form] = Form.useForm<Values>();
  const [workspaces, setWorkspaces] = useState<Workspace[]>();
  const [directory, setDirectory] = useState<{ workspaceId: string; data: Directory }>();
  const [boundContract, setBoundContract] = useState<ContractView>();
  const [boundCase, setBoundCase] = useState<{
    id: string;
    caseNo: string;
    title: string;
    branchId?: string | null;
  }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  const attempt = useRef<{ body: string; key: string } | undefined>(undefined);
  const workspaceId = Form.useWatch('workspaceId', form) || params.get('workspace') || '';
  const branchId = Form.useWatch('branchId', form);
  const contractId = Form.useWatch('contractId', form) || params.get('contract') || '';
  const refundType = Form.useWatch('type', form) || 'REFUND';
  const category = Form.useWatch('category', form) || (params.get('case') ? 'CASE_HANDLING' : 'OFFICE');
  const boundContractId = params.get('contract');
  const boundCaseId = params.get('case');
  const back = paths[kind] + (params.size ? '?' + params.toString() : '');
  const organizations = directory?.workspaceId === workspaceId ? directory.data.organizations : [];
  const canReadContract = hasPermission('contract.read');
  const canReadPayment = hasPermission('payment.read');
  const canReadCase = hasPermission('case.read');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    void get<{ workspaces: Workspace[] }>('/workspaces')
      .then((result) => {
        if (active) setWorkspaces(result.workspaces);
      })
      .catch((e) => {
        if (active) setError(requestErrorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void get<Directory>('/collaboration/options?workspaceId=' + encodeURIComponent(workspaceId))
      .then((data) => {
        if (active) setDirectory({ workspaceId, data });
      })
      .catch((e) => {
        if (active) {
          setDirectory(undefined);
          setError(requestErrorMessage(e));
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId, revision]);
  useEffect(() => {
    if (!boundContractId || !canReadContract || kind === 'cost') return;
    let active = true;
    void contractApi
      .detail(boundContractId)
      .then((result) => {
        if (active) {
          setBoundContract(result.data);
          form.setFieldValue('contractId', result.data.id);
        }
      })
      .catch((e) => {
        if (active) {
          setBoundContract(undefined);
          setError(requestErrorMessage(e));
        }
      });
    return () => {
      active = false;
    };
  }, [boundContractId, canReadContract, kind, form, revision]);
  useEffect(() => {
    if (!boundCaseId || !canReadCase || kind !== 'cost') return;
    let active = true;
    void caseApi
      .detail(boundCaseId)
      .then(({ data }) => {
        if (!active) return;
        setBoundCase(data);
        form.setFieldsValue({ caseId: data.id, branchId: data.branchId || undefined });
      })
      .catch((e) => {
        if (active) {
          setBoundCase(undefined);
          setError(requestErrorMessage(e));
        }
      });
    return () => {
      active = false;
    };
  }, [boundCaseId, canReadCase, kind, form, revision]);
  const contractChoices: ChoiceLoader = useCallback(
    async (page, keyword) => {
      if (!branchId || !canReadContract) return { list: [], total: 0 };
      const result = await contractApi.list({ page, pageSize: 20, branchId, keyword: keyword || undefined });
      return {
        list: result.data.list.map((row) => ({ id: row.id, label: row.contractNo + ' · ' + row.title })),
        total: result.data.total,
      };
    },
    [branchId, canReadContract],
  );
  const caseChoices: ChoiceLoader = useCallback(
    async (page, keyword) => {
      if (!branchId || !canReadCase) return { list: [], total: 0 };
      const result = await caseApi.list({ page, pageSize: 20, branchId, keyword: keyword || undefined });
      return {
        list: result.data.list.map((row) => ({ id: row.id, label: row.caseNo + ' · ' + row.title })),
        total: result.data.total,
      };
    },
    [branchId, canReadCase],
  );
  const paymentChoices: ChoiceLoader = useCallback(
    async (page, keyword) => {
      if (!contractId || !canReadPayment) return { list: [], total: 0 };
      const result = await paymentApi.list({ page, pageSize: 20, contractId, status: 'CONFIRMED' });
      // Server pagination is authoritative; search only narrows the displayed page.
      return {
        list: result.data.list
          .filter((row) => !keyword || row.paymentNo.includes(keyword))
          .map((row) => ({
            id: row.id,
            label: row.paymentNo + ' · ' + row.amount + ' 元',
            amount: row.amount,
          })),
        total: result.data.total,
      };
    },
    [contractId, canReadPayment],
  );
  const planChoices: ChoiceLoader = useCallback(
    async (page, keyword) => {
      if (!contractId || !canReadPayment) return { list: [], total: 0 };
      const result = await contractApi.plans(contractId);
      const rows = result.data
        .filter((row) => !['RECEIVED', 'CANCELLED'].includes(row.status))
        .map((row) => ({
          id: row.id,
          label: row.planNo + ' · 剩余 ' + moneyBalance(row.amount, row.receivedAmount) + ' 元',
          remaining: moneyBalance(row.amount, row.receivedAmount),
        }))
        .filter((row) => !keyword || row.label.includes(keyword));
      return { list: rows.slice((page - 1) * 20, page * 20), total: rows.length };
    },
    [contractId, canReadPayment],
  );
  const channelChoices: ChoiceLoader = useCallback(
    async (page) => {
      if (!hasPermission('cost.create')) return { list: [], total: 0 };
      const result = await request.get<{
        data: { list: { id: string; name: string }[]; pagination: { total: number } };
      }>('/v1/channels', { params: { page, pageSize: 20 } });
      return {
        list: result.data.list.map((row) => ({ id: row.id, label: row.name })),
        total: result.data.pagination.total,
      };
    },
    [hasPermission],
  );
  const resetAnchors = () =>
    form.setFieldsValue({
      paymentId: undefined,
      planId: undefined,
      paymentPlanId: undefined,
      amount: undefined,
    });
  const submit = async () => {
    if (busy || !hasPermission(`${kind}.create`)) return;
    let values: Values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (
        !workspaces?.some((row) => row.id === values.workspaceId) ||
        !directory ||
        directory.workspaceId !== values.workspaceId
      )
        throw new Error('请选择当前已授权的工作区。');
      if (moneyMinor(values.amount) <= 0n) throw new Error('金额必须大于零。');
      const orgIds = new Set(organizations.map((row) => row.id));
      let input;
      if (kind !== 'cost') {
        if (!values.contractId || !canReadContract) throw new Error('请选择有权读取的关联合同。');
        const target = (await contractApi.detail(values.contractId)).data;
        if (!target.branchId || !orgIds.has(target.branchId))
          throw new Error('合同不属于当前工作区的授权组织。');
        const common = {
          contractId: target.id,
          amount: values.amount,
          ...(params.get('caseNo') ? { caseNo: params.get('caseNo')! } : {}),
        };
        if (kind === 'payment')
          input = {
            ...common,
            paymentPlanId: values.paymentPlanId,
            method: values.method?.trim(),
            account: values.account?.trim(),
            paidAt: values.paidAt?.toISOString(),
            remark: values.remark?.trim(),
          };
        else if (kind === 'invoice') input = { ...common, reason: values.reason?.trim() };
        else {
          if (!canReadPayment) throw new Error('选择退款收款或减免计划需要收款读取权限。');
          if (values.type === 'REFUND') {
            const payment = (await paymentApi.detail(values.paymentId!)).data;
            if (payment.contractId !== target.id) throw new Error('收款状态或金额已变化，请重新选择原收款。');
          } else {
            const plans = (await contractApi.plans(target.id)).data;
            const plan = plans.find((row) => row.id === values.planId);
            if (!plan) throw new Error('减免金额超过当前计划余额，请核对。');
          }
          input = {
            ...common,
            type: values.type,
            reason: values.reason!.trim(),
            ...(values.type === 'REFUND' ? { paymentId: values.paymentId } : { planId: values.planId }),
          };
        }
      } else {
        const caseId = ['EVIDENCE', 'CASE_HANDLING', 'REIMBURSEMENT'].includes(values.category)
          ? values.caseId
          : undefined;
        if (caseId) {
          if (!canReadCase) throw new Error('关联案件需要案件读取权限。');
          const target = (await caseApi.detail(caseId)).data;
          if (!target.branchId || !orgIds.has(target.branchId))
            throw new Error('案件不属于当前工作区的授权组织。');
        }
        input = {
          category: values.category,
          amount: values.amount,
          occurredAt: values.occurredAt.toISOString(),
          note: values.note?.trim(),
          caseId,
          ...(values.category === 'CHANNEL' ? { channelId: values.channelId } : {}),
        };
      }
      const body = JSON.stringify(input);
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      // On an uncertain network result, preserve the same request and key for recovery.
      const payload = { ...input, idempotencyKey: attempt.current!.key };
      if (!alive.current) return;
      const result =
        kind === 'payment'
          ? await paymentApi.create(payload as Parameters<typeof paymentApi.create>[0])
          : kind === 'invoice'
            ? await invoiceApi.create(payload as Parameters<typeof invoiceApi.create>[0])
            : kind === 'refund'
              ? await refundApi.create(payload as Parameters<typeof refundApi.create>[0])
              : await costApi.create(payload as Parameters<typeof costApi.create>[0]);
      if (!alive.current) return;
      message.success('已保存正式单据');
      navigate(paths[kind] + '/' + result.data.id + (params.size ? '?' + params.toString() : ''));
    } catch (e) {
      if (alive.current) setError(requestErrorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className="unified-area-page">
      <Link to={back}>返回工作表</Link>
      <h1>{names[kind]}</h1>
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={() => setRevision((n) => n + 1)}>刷新授权与选项</Button>}
        />
      )}
      {!workspaces && !error && <Spin aria-label="正在加载工作区" />}
      {kind !== 'cost' && !canReadContract && (
        <Alert type="warning" title="此操作需要关联合同读取权限，请联系负责人配置岗位授权。" />
      )}
      {kind === 'refund' && !canReadPayment && (
        <Alert type="warning" title="退款与减免需要收款及应收计划读取权限。" />
      )}
      <Card>
        <Form
          form={form}
          layout="vertical"
          disabled={busy}
          validateMessages={{ required: '${label}为必填项', whitespace: '${label}不能为空' }}
          initialValues={{
            workspaceId: params.get('workspace') || undefined,
            contractId: boundContractId || undefined,
            caseId: params.get('case') || undefined,
            category: params.get('case') ? 'CASE_HANDLING' : 'OFFICE',
            type: 'REFUND',
            occurredAt: dayjs(),
          }}
        >
          <Form.Item name="workspaceId" label="工作区" rules={[{ required: true }]}>
            <Select
              aria-label="财务工作区"
              options={workspaces?.map((row) => ({ value: row.id, label: row.name }))}
              onChange={() => {
                form.setFieldValue(
                  'branchId',
                  kind === 'cost' ? boundCase?.branchId || undefined : undefined,
                );
                if (!boundContractId) {
                  form.setFieldValue('contractId', undefined);
                  resetAnchors();
                }
              }}
            />
          </Form.Item>
          {(!boundContractId || kind === 'cost') && (
            <Form.Item
              name="branchId"
              label="关联记录所属组织"
              rules={[{ required: kind !== 'cost' || ['EVIDENCE', 'CASE_HANDLING'].includes(category) }]}
            >
              <Select
                aria-label="关联组织"
                disabled={kind === 'cost' && Boolean(boundCaseId)}
                options={organizations.map((row) => ({ value: row.id, label: row.name }))}
                onChange={() => {
                  form.setFieldValue('contractId', undefined);
                  if (!params.get('case')) form.setFieldValue('caseId', undefined);
                  resetAnchors();
                }}
              />
            </Form.Item>
          )}
          {kind !== 'cost' && (
            <Form.Item name="contractId" label="关联合同" rules={[{ required: true }]}>
              {boundContractId ? (
                <Select
                  disabled
                  options={
                    boundContract
                      ? [
                          {
                            value: boundContract.id,
                            label: boundContract.contractNo + ' · ' + boundContract.title,
                          },
                        ]
                      : []
                  }
                />
              ) : (
                <FinanceChoicePicker
                  key={String(branchId)}
                  label="关联合同"
                  load={contractChoices}
                  disabled={!branchId || !canReadContract}
                  onPick={resetAnchors}
                />
              )}
            </Form.Item>
          )}
          {kind === 'payment' && (
            <Form.Item name="paymentPlanId" label="指定应收期次（可选）">
              <FinanceChoicePicker
                key={contractId}
                label="指定应收期次（可选）"
                load={planChoices}
                disabled={!contractId || !canReadPayment}
              />
            </Form.Item>
          )}
          {kind === 'refund' && (
            <>
              <Form.Item name="type" label="申请类型" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'REFUND', label: '退款' },
                    { value: 'WAIVER', label: '减免' },
                  ]}
                  onChange={resetAnchors}
                />
              </Form.Item>
              {refundType === 'REFUND' ? (
                <Form.Item name="paymentId" label="原收款" rules={[{ required: true }]}>
                  <FinanceChoicePicker
                    key={'payment:' + contractId}
                    label="原收款"
                    load={paymentChoices}
                    disabled={!contractId || !canReadPayment}
                    onPick={(row) => form.setFieldValue('amount', row?.amount)}
                  />
                </Form.Item>
              ) : (
                <Form.Item name="planId" label="减免期次" rules={[{ required: true }]}>
                  <FinanceChoicePicker
                    key={'plan:' + contractId}
                    label="减免期次"
                    load={planChoices}
                    disabled={!contractId || !canReadPayment}
                    onPick={(row) => form.setFieldValue('amount', row?.remaining)}
                  />
                </Form.Item>
              )}
            </>
          )}
          {kind === 'cost' && (
            <>
              <Form.Item name="category" label="成本类别" rules={[{ required: true }]}>
                <Select
                  options={COST_CATEGORIES.map((value) => ({ value, label: categories[value] }))}
                  onChange={() =>
                    form.setFieldsValue({ channelId: undefined, caseId: params.get('case') || undefined })
                  }
                />
              </Form.Item>
              {['EVIDENCE', 'CASE_HANDLING', 'REIMBURSEMENT'].includes(category) && (
                <Form.Item
                  name="caseId"
                  label="关联案件"
                  rules={[{ required: category !== 'REIMBURSEMENT' }]}
                >
                  {params.get('case') ? (
                    <Select
                      disabled
                      options={
                        boundCase
                          ? [{ value: boundCase.id, label: boundCase.caseNo + ' · ' + boundCase.title }]
                          : []
                      }
                    />
                  ) : (
                    <FinanceChoicePicker
                      key={String(branchId)}
                      label="关联案件"
                      load={caseChoices}
                      disabled={!branchId || !canReadCase}
                    />
                  )}
                </Form.Item>
              )}
              {category === 'CHANNEL' && (
                <Form.Item name="channelId" label="关联渠道" rules={[{ required: true }]}>
                  <FinanceChoicePicker
                    label="关联渠道"
                    load={channelChoices}
                    disabled={!hasPermission('cost.create')}
                  />
                </Form.Item>
              )}
            </>
          )}
          <Form.Item name="amount" label="金额（元）" rules={[{ required: true }]}>
            <InputNumber
              aria-label="单据金额"
              stringMode
              readOnly={kind === 'refund' && refundType === 'REFUND'}
              min="0.01"
              max="9999999999999999.99"
              precision={2}
              style={{ width: '100%' }}
            />
          </Form.Item>
          {kind === 'payment' && (
            <>
              <Form.Item name="method" label="收款方式">
                <Input maxLength={50} />
              </Form.Item>
              <Form.Item name="account" label="收款账户">
                <Input maxLength={100} />
              </Form.Item>
              <Form.Item name="paidAt" label="到账时间">
                <DatePicker showTime placeholder="请选择日期和时间" />
              </Form.Item>
              <Form.Item name="remark" label="备注">
                <Input.TextArea maxLength={500} />
              </Form.Item>
            </>
          )}
          {(kind === 'invoice' || kind === 'refund') && (
            <Form.Item
              name="reason"
              label="申请说明"
              rules={[{ required: kind === 'refund', whitespace: true }]}
            >
              <Input.TextArea maxLength={500} />
            </Form.Item>
          )}
          {kind === 'cost' && (
            <>
              <Form.Item name="occurredAt" label="发生时间" rules={[{ required: true }]}>
                <DatePicker showTime placeholder="请选择日期和时间" />
              </Form.Item>
              <Form.Item name="note" label="备注">
                <Input.TextArea maxLength={500} />
              </Form.Item>
            </>
          )}
          <Space>
            <Button
              type="primary"
              loading={busy}
              disabled={
                !hasPermission(`${kind}.create`) ||
                (kind !== 'cost' && !canReadContract) ||
                (kind === 'refund' && !canReadPayment)
              }
              onClick={() => void submit()}
            >
              保存单据
            </Button>
            <Link to={back}>取消</Link>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
