import Table from '@/components/ResizableTable';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Steps,
  Switch,
  message,
} from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { type Dayjs } from 'dayjs';
import { useContractStore } from '@/stores/contract-store';
import { customerApi } from '@/api/customer';
import {
  contractApi,
  CONTRACT_TYPES,
  type ContractType,
  type ContractView,
  type CreateContractInput,
} from '@/api/contract';
import { negotiationApi, type NegotiationView } from '@/api/negotiation';
import type { CustomerView } from '@/api/types';
import { CONTRACT_TYPE_META } from './meta';

/** 类型 → 标准模板快照码（仅 FIRST_SIGN/FORMAL 有模板；其余类型不走模板）。 */
const TEMPLATE_BY_TYPE: Partial<Record<ContractType, { code: string; label: string }>> = {
  FIRST_SIGN: { code: 'FIRST_SIGN_STANDARD', label: '首签标准合同模板' },
  FORMAL: { code: 'FORMAL_STANDARD', label: '正式委托合同标准模板' },
};

/** paymentTerms 服务端 normalizeOptionalText 上限 500 字符：每期 JSON 约 60 字符，封面上限 8 期。 */
const MAX_PLAN_PERIODS = 8;

interface PlanRow {
  key: number;
  dueDate: Dayjs | null;
  amount: number | null;
}

interface WizardFormValues {
  contractType: ContractType;
  title: string;
  sourceType: 'CUSTOMER' | 'NEGOTIATION';
  negotiationId?: string;
  parentContractId?: string;
  customerId: string;
  useTemplate: boolean;
  amount: number;
  startDate?: Dayjs;
  endDate?: Dayjs;
  terms?: string;
  installment: boolean;
}

/** 金额转分（避免浮点误差），最多两位小数。 */
function toCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(value * 100);
}

interface PlanValidation {
  valid: boolean;
  message: string;
}

/**
 * 分期编辑器校验口径（镜像后端 generatePlansForEffect 校验，避免 RECEIVABLE_PLAN_MISMATCH 400）：
 * 期次 1..N 连续（由数组位次保证）、每期 dueDate 必填、金额非负且 scale≤2、合计必须=合同金额。
 */
function validatePlanRows(rows: PlanRow[], enabled: boolean, contractAmount: unknown): PlanValidation {
  if (!enabled) return { valid: true, message: '' };
  if (rows.length === 0) return { valid: false, message: '至少添加一期收款计划' };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.dueDate) return { valid: false, message: `第 ${index + 1} 期应收日必填` };
    if (row.amount === null || row.amount === undefined) return { valid: false, message: `第 ${index + 1} 期金额必填` };
    if (row.amount < 0) return { valid: false, message: `第 ${index + 1} 期金额不得为负` };
    if (!/^\d+(\.\d{1,2})?$/.test(String(row.amount))) {
      return { valid: false, message: `第 ${index + 1} 期金额最多两位小数` };
    }
  }
  const totalCents = rows.reduce((sum, row) => sum + (toCents(row.amount) ?? 0), 0);
  const amountCents = toCents(typeof contractAmount === 'number' ? contractAmount : null);
  if (amountCents === null || amountCents <= 0) return { valid: false, message: '请先填写合同金额' };
  if (totalCents !== amountCents) {
    return {
      valid: false,
      message: `分期合计 ${(totalCents / 100).toFixed(2)} 与合同金额 ${(amountCents / 100).toFixed(2)} 不一致`,
    };
  }
  return { valid: true, message: '' };
}

const ContractCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const createContract = useContractStore(state => state.createContract);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [signedNegotiations, setSignedNegotiations] = useState<NegotiationView[]>([]);
  const [parentCandidates, setParentCandidates] = useState<ContractView[]>([]);
  const [planRows, setPlanRows] = useState<PlanRow[]>([{ key: 1, dueDate: null, amount: null }]);
  const [form] = Form.useForm<WizardFormValues>();

  const contractType = Form.useWatch('contractType', form);
  const sourceType = Form.useWatch('sourceType', form);
  const installment = Form.useWatch('installment', form);
  const amount = Form.useWatch('amount', form);

  useEffect(() => {
    // 下拉数据源：客户 / 已签约谈案 / 父合同候选（拦截器已全局提示，失败保持空）。
    void customerApi.list({ page: 1, pageSize: 100 })
      .then(res => setCustomers(res.data.list))
      .catch(() => undefined);
    void negotiationApi.list({ page: 1, pageSize: 100, status: 'SIGNED' })
      .then(res => setSignedNegotiations(res.data.list))
      .catch(() => undefined);
    void contractApi.list({ page: 1, pageSize: 100 })
      .then(res => setParentCandidates(res.data.list))
      .catch(() => undefined);
  }, []);

  // 分期校验逐渲染计算（React Compiler 纪律：不手工 memo）。
  const planValidation = validatePlanRows(planRows, installment === true, amount);

  const validateStep = async (current: number): Promise<boolean> => {
    const fieldNames: (keyof WizardFormValues)[][] = [
      ['contractType', 'title', 'sourceType', 'negotiationId', 'parentContractId'],
      ['customerId'],
      [],
      ['amount'],
    ];
    try {
      await form.validateFields(fieldNames[current]);
      if (current === 3 && installment && !planValidation.valid) return false;
      return true;
    } catch {
      return false;
    }
  };

  const handleNext = async () => {
    if (await validateStep(step)) setStep(step + 1);
  };

  const buildPayload = (values: WizardFormValues): CreateContractInput => {
    const payload: CreateContractInput = {
      contractType: values.contractType,
      title: values.title.trim(),
      customerId: values.customerId,
      sourceType: values.sourceType,
      amount: values.amount.toFixed(2),
      // 不分期提交 null：后端生效时默认一期（dueDate = effectiveDate + 30 天）。
      paymentTerms: values.installment
        ? JSON.stringify({
            plans: planRows.map((row, index) => ({
              period: index + 1,
              dueDate: row.dueDate!.format('YYYY-MM-DD'),
              amount: row.amount!.toFixed(2),
            })),
          })
        : null,
    };
    if (values.sourceType === 'NEGOTIATION') payload.negotiationId = values.negotiationId;
    if (values.contractType === 'SUPPLEMENT') payload.parentContractId = values.parentContractId;
    const template = TEMPLATE_BY_TYPE[values.contractType];
    if (template && values.useTemplate) payload.templateCode = template.code;
    if (values.startDate) payload.startDate = values.startDate.format('YYYY-MM-DD');
    if (values.endDate) payload.endDate = values.endDate.format('YYYY-MM-DD');
    if (values.terms?.trim()) payload.terms = values.terms.trim();
    return payload;
  };

  const handleSubmit = async () => {
    if (!(await validateStep(3))) return;
    const values = form.getFieldsValue(true);
    setSubmitting(true);
    try {
      const created = await createContract(buildPayload(values));
      if (!created) return;
      message.success('合同创建成功');
      navigate(`/contracts/${created.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const addPlanRow = () => {
    setPlanRows(rows => [...rows, { key: Math.max(0, ...rows.map(row => row.key)) + 1, dueDate: null, amount: null }]);
  };

  const removePlanRow = (key: number) => {
    setPlanRows(rows => rows.filter(row => row.key !== key));
  };

  const updatePlanRow = (key: number, patch: Partial<PlanRow>) => {
    setPlanRows(rows => rows.map(row => (row.key === key ? { ...row, ...patch } : row)));
  };

  const planColumns = [
    {
      title: '期次',
      key: 'period',
      width: 70,
      render: (_: unknown, __: PlanRow, index: number) => index + 1,
    },
    {
      title: '应收日',
      key: 'dueDate',
      render: (_: unknown, row: PlanRow) => (
        <DatePicker
          aria-label={`第${planRows.indexOf(row) + 1}期应收日`}
          value={row.dueDate}
          onChange={value => updatePlanRow(row.key, { dueDate: value })}
        />
      ),
    },
    {
      title: '金额',
      key: 'amount',
      render: (_: unknown, row: PlanRow) => (
        <InputNumber
          aria-label={`第${planRows.indexOf(row) + 1}期金额`}
          min={0}
          precision={2}
          style={{ width: 160 }}
          value={row.amount}
          onChange={value => updatePlanRow(row.key, { amount: value })}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 70,
      render: (_: unknown, row: PlanRow) => (
        <Button
          type="text"
          danger
          icon={<MinusCircleOutlined />}
          aria-label={`删除第${planRows.indexOf(row) + 1}期`}
          disabled={planRows.length <= 1}
          onClick={() => removePlanRow(row.key)}
        />
      ),
    },
  ];

  const template = contractType ? TEMPLATE_BY_TYPE[contractType] : undefined;

  return (
    <Card title="新建合同">
      <Steps
        current={step}
        style={{ marginBottom: 24 }}
        items={[{ title: '合同类型' }, { title: '选择客户' }, { title: '合同模板' }, { title: '金额与分期' }]}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{ contractType: 'FIRST_SIGN', sourceType: 'NEGOTIATION', useTemplate: true, installment: false }}
        style={{ maxWidth: 720 }}
      >
        <div style={{ display: step === 0 ? 'block' : 'none' }}>
          <Form.Item name="contractType" label="合同类型" rules={[{ required: true, message: '请选择合同类型' }]}>
            <Select
              aria-label="合同类型"
              options={CONTRACT_TYPES.map(value => ({ value, label: CONTRACT_TYPE_META[value].text }))}
            />
          </Form.Item>
          <Form.Item name="title" label="合同标题" rules={[{ required: true, whitespace: true, message: '请输入合同标题' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="sourceType" label="签约来源" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: 'CUSTOMER', label: '客户直签' },
                { value: 'NEGOTIATION', label: '谈案签约' },
              ]}
            />
          </Form.Item>
          {sourceType === 'NEGOTIATION' && (
            <Form.Item
              name="negotiationId"
              label="关联谈案（已签约）"
              rules={[{ required: true, message: '请选择关联谈案' }]}
            >
              <Select
                aria-label="关联谈案"
                onChange={id => { const upstream = signedNegotiations.find(n => n.id === id); if (upstream) form.setFieldsValue({ customerId: upstream.customerId, amount: upstream.quotedAmount == null ? undefined : Number(upstream.quotedAmount) }); }}
                showSearch
                optionFilterProp="label"
                placeholder="选择已签约谈案"
                options={signedNegotiations.map(item => ({
                  value: item.id,
                  label: `${item.negotiationNo}（报价 ${item.quotedAmount ?? '-'}）`,
                }))}
              />
            </Form.Item>
          )}
          {contractType === 'SUPPLEMENT' && (
            <Form.Item
              name="parentContractId"
              label="父合同"
              rules={[{ required: true, message: '补充协议必须选择父合同' }]}
            >
              <Select
                aria-label="父合同"
                showSearch
                optionFilterProp="label"
                placeholder="选择父合同"
                options={parentCandidates.map(item => ({
                  value: item.id,
                  label: `${item.contractNo} ${item.title}`,
                }))}
              />
            </Form.Item>
          )}
          {contractType === 'RISK_NOTICE' && (
            <Alert
              type="info"
              showIcon
              message="风险告知书无需审批：提交后直接进入待签署，签署即为终态（无生效环节）。"
            />
          )}
        </div>

        <div style={{ display: step === 1 ? 'block' : 'none' }}>
          <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
            <Select
              aria-label="客户"
              disabled={sourceType === 'NEGOTIATION'}
              showSearch
              optionFilterProp="label"
              placeholder="搜索客户姓名/编号"
              options={customers.map(item => ({
                value: item.id,
                label: `${item.name}（${item.customerNo}）`,
              }))}
            />
          </Form.Item>
        </div>

        <div style={{ display: step === 2 ? 'block' : 'none' }}>
          {template ? (
            <Form.Item name="useTemplate" label="合同模板">
              <Radio.Group
                options={[
                  { value: true, label: `${template.label}（${template.code}）` },
                  { value: false, label: '不使用模板' },
                ]}
              />
            </Form.Item>
          ) : (
            <Alert type="info" showIcon message="该合同类型不使用模板（仅首签/正式委托合同提供标准模板）。" />
          )}
        </div>

        <div style={{ display: step === 3 ? 'block' : 'none' }}>
          <Form.Item
            name="amount"
            label="合同金额"
            rules={[{ required: true, message: '请输入合同金额' }]}
          >
            <InputNumber aria-label="合同金额" min={0.01} precision={2} style={{ width: 220 }} />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item name="startDate" label="开始日期">
              <DatePicker />
            </Form.Item>
            <Form.Item name="endDate" label="结束日期">
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.Item name="terms" label="合同条款（可选）">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
          <Form.Item name="installment" label="分期收款" valuePropName="checked">
            <Switch aria-label="分期收款" />
          </Form.Item>
          {installment && (
            <>
              <Table<PlanRow>
                columns={planColumns}
                dataSource={planRows}
                rowKey="key"
                size="small"
                pagination={false}
                style={{ marginBottom: 12 }}
              />
              <Space style={{ marginBottom: 12 }}>
                <Button
                  icon={<PlusOutlined />}
                  disabled={planRows.length >= MAX_PLAN_PERIODS}
                  onClick={addPlanRow}
                >
                  添加期次
                </Button>
                <span style={{ color: '#888' }}>最多 {MAX_PLAN_PERIODS} 期；分期合计必须等于合同金额</span>
              </Space>
              {!planValidation.valid && (
                <Alert role="alert" type="error" showIcon message={planValidation.message} style={{ marginBottom: 12 }} />
              )}
            </>
          )}
          {!installment && (
            <Alert
              type="info"
              showIcon
              message="不分期：合同生效时自动生成一期应收计划（应收日 = 生效日 + 30 天）。"
            />
          )}
        </div>
      </Form>

      <Space style={{ marginTop: 24 }}>
        {step > 0 && <Button onClick={() => setStep(step - 1)}>上一步</Button>}
        {step < 3 && <Button type="primary" onClick={() => void handleNext()}>下一步</Button>}
        {step === 3 && (
          <Button
            type="primary"
            loading={submitting}
            disabled={installment === true && !planValidation.valid}
            onClick={() => void handleSubmit()}
          >
            创建合同
          </Button>
        )}
        <Button onClick={() => navigate('/contracts')}>取消</Button>
      </Space>
    </Card>
  );
};

export default ContractCreatePage;
