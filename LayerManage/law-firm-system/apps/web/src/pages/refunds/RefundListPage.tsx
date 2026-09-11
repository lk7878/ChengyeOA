import Table from '@/components/ResizableTable';
// SPEC-011 Task 11: 退款/减免列表页（FIN-03）。沿 PaymentListPage 形态（AntD 6 + store 模式）。
// 列表 + type/status 筛选 + 分页；新建弹窗类型 Radio 切换：
//   REFUND→收款单选择器（仅 CONFIRMED，选定后金额只读回填，contractId 抄自收款）；
//   WAIVER→先选合同再选计划（仅 PENDING/PARTIAL，金额上限=计划余额前端提示）+ reason 必填。
// 行操作：PENDING→审批通过/拒绝（refund.approve——SPECIAL/CRITICAL 码，按钮沿既有
// HIGH/CRITICAL 敏感操作形态：Modal + 高风险警示 Alert + 意见/原因录入）；
// APPROVED→执行（refund.execute，Popconfirm 提示资金影响）。
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import StepUpDialog from '@/features/auth/components/StepUpDialog';
import { useStepUp } from '@/features/auth/useStepUp';
import { useRefundStore, type RefundListFilters } from '@/stores/refund-store';
import { useAuthStore } from '@/stores/authStore';
import { contractApi, type ContractView } from '@/api/contract';
import { paymentApi, type PaymentPlanView, type PaymentView } from '@/api/payment';
import {
  REFUND_STATUSES,
  REFUND_TYPES,
  type RefundStatus,
  type RefundType,
  type RefundView,
} from '@/api/refund';

const REFUND_TYPE_META: Record<RefundType, { text: string; color: string }> = {
  REFUND: { text: '退款', color: 'blue' },
  WAIVER: { text: '减免', color: 'purple' },
};

const REFUND_STATUS_META: Record<RefundStatus, { text: string; color: string }> = {
  PENDING: { text: '待审批', color: 'gold' },
  APPROVED: { text: '已批准', color: 'blue' },
  REJECTED: { text: '已驳回', color: 'red' },
  EXECUTED: { text: '已执行', color: 'green' },
};

interface CreateFormValues {
  type: RefundType;
  contractId?: string;
  paymentId?: string;
  planId?: string;
  amount?: number;
  reason?: string;
}

type ActionModal = 'approve' | 'reject' | null;

const RefundListPage: React.FC<{ caseNo?: string }> = ({ caseNo }) => {
  const {
    refunds, listTotal, listPage, listPageSize, listLoading, listError,
    fetchRefunds, applyFilters, createRefund, approveRefund, rejectRefund, executeRefund,
  } = useRefundStore();
  const stepUp = useStepUp();
  const canCreate = useAuthStore(state => state.hasPermission('refund.create'));
  const canApprove = useAuthStore(state => state.hasPermission('refund.approve'));
  const canExecute = useAuthStore(state => state.hasPermission('refund.execute'));
  const [status, setStatus] = useState<RefundStatus | undefined>(undefined);
  const [type, setType] = useState<RefundType | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedPayments, setConfirmedPayments] = useState<PaymentView[]>([]);
  const [receivableContracts, setReceivableContracts] = useState<ContractView[]>([]);
  const [waiverPlans, setWaiverPlans] = useState<PaymentPlanView[]>([]);
  const [createForm] = Form.useForm<CreateFormValues>();
  const [activeModal, setActiveModal] = useState<ActionModal>(null);
  const [activeRecord, setActiveRecord] = useState<RefundView | null>(null);
  const [actionForm] = Form.useForm<{ comment?: string }>();
  const watchedType = Form.useWatch('type', createForm);
  const watchedPlanId = Form.useWatch('planId', createForm);
  // 减免计划余额上限 = 计划应收 − 已收（派生态，选计划后前端提示 + 预填）。
  const watchedPlan = waiverPlans.find(item => item.id === watchedPlanId);
  const waiverMaxAmount = watchedPlan
    ? Number(watchedPlan.amount) - Number(watchedPlan.receivedAmount)
    : undefined;

  useEffect(() => { void applyFilters({ caseNo }); }, [caseNo, applyFilters]);

  const openCreate = () => {
    createForm.resetFields();
    createForm.setFieldValue('type', 'REFUND');
    setWaiverPlans([]);
    setCreateOpen(true);
    {
      // 退款锚点仅接受 CONFIRMED 收款（后端口径），前端预筛减少 409。
      void paymentApi.list({ page: 1, pageSize: 100, status: 'CONFIRMED', caseNo })
        .then(res => setConfirmedPayments(res.data.list))
        .catch(() => undefined);
    }
    {
      void contractApi.list({ page: 1, pageSize: 100, caseNo })
        .then(res => setReceivableContracts(res.data.list.filter(
          item => item.status === 'SIGNED' || item.status === 'EFFECTIVE',
        )))
        .catch(() => undefined);
    }
  };

  const handleTypeChange = (value: RefundType) => {
    if (value === 'REFUND') {
      // 反向切 REFUND：清 WAIVER 侧 planId/contractId 与计划下拉，防止残留减免锚点。
      createForm.setFieldsValue({ planId: undefined, contractId: undefined, amount: undefined });
      setWaiverPlans([]);
    } else {
      // 切 WAIVER：清 REFUND 侧 paymentId 及其派生的 contractId，重置计划下拉，
      // 避免 contract Select 预填旧合同但计划下拉为空（误导性 UI）。
      createForm.setFieldsValue({ paymentId: undefined, contractId: undefined, planId: undefined, amount: undefined });
      setWaiverPlans([]);
    }
  };

  const handlePaymentSelect = (paymentId: string) => {
    const payment = confirmedPayments.find(item => item.id === paymentId);
    if (!payment) return;
    // 选定后金额只读回填；contractId 抄自收款（REFUND 类型锚 payment，交叉锚点禁填）。
    createForm.setFieldsValue({ contractId: payment.contractId, amount: Number(payment.amount) });
  };

  const handleContractSelect = (contractId: string) => {
    createForm.setFieldsValue({ planId: undefined, amount: undefined });
    setWaiverPlans([]);
    // 减免锚点计划：仅 PENDING/PARTIAL（后端口径），余额 = amount − receivedAmount 前端提示。
    void contractApi.plans(contractId)
      .then(res => setWaiverPlans(res.data.filter(
        item => item.status === 'PENDING' || item.status === 'PARTIAL',
      )))
      .catch(() => undefined);
  };

  // 计划选择后预填金额为余额上限（上限提示由派生态 waiverMaxAmount 提供）。
  const handlePlanSelect = (planId: string) => {
    const plan = waiverPlans.find(item => item.id === planId);
    if (!plan) return;
    createForm.setFieldValue('amount', Number(plan.amount) - Number(plan.receivedAmount));
  };

  const handleSearch = () => {
    const filters: RefundListFilters = {};
    if (type) filters.type = type;
    if (status) filters.status = status;
    void applyFilters({ ...filters, caseNo });
  };

  const handleReset = () => {
    setType(undefined);
    setStatus(undefined);
    void applyFilters({ caseNo });
  };

  const handleCreate = async (values: CreateFormValues) => {
    // REFUND 类型无 contractId 注册字段（锚 payment），从所选收款派生；
    // WAIVER 类型 contractId 由合同 Select（Form.Item）注册，直接取用。
    let contractId = values.contractId;
    if (values.type === 'REFUND') {
      const payment = confirmedPayments.find(item => item.id === values.paymentId);
      if (!payment) return;
      contractId = payment.contractId;
    }
    if (!contractId || !values.amount || !values.reason?.trim()) return;
    setSubmitting(true);
    try {
      const input: {
        type: RefundType;
        contractId: string;
        amount: string;
        reason: string;
        paymentId?: string;
        planId?: string;
      } = {
        type: values.type,
        contractId,
        amount: values.amount.toFixed(2),
        reason: values.reason.trim(),
      };
      if (values.type === 'REFUND' && values.paymentId) input.paymentId = values.paymentId;
      if (values.type === 'WAIVER' && values.planId) input.planId = values.planId;
      const created = await createRefund({ ...input, caseNo });
      if (!created) return;
      message.success('退款/减免申请已提交');
      setCreateOpen(false);
      void fetchRefunds(1);
    } finally {
      setSubmitting(false);
    }
  };

  const openAction = (modal: Exclude<ActionModal, null>, record: RefundView) => {
    actionForm.resetFields();
    setActiveRecord(record);
    setActiveModal(modal);
  };

  const handleActionOk = async () => {
    if (!activeRecord) return;
    const values = await actionForm.validateFields();
    setSubmitting(true);
    try {
      if (activeModal === 'approve') {
        // Task 7（SPEC-013）：refund.approve 真实 Step-Up——先 MFA 挑战发证（REFUND_APPROVE，
        // target 绑定 refundRequestId+expectedVersion），再持证调用审批 API。expectedVersion
        // 取列表行版本（后端前置校验：与重读版本不符 → 409）。
        const expectedVersion = activeRecord.version;
        const ok = await stepUp.run({
          purpose: 'REFUND_APPROVE',
          target: { refundRequestId: activeRecord.id, expectedVersion },
          impact: '审批通过退款/减免申请（批准后不可撤销）',
          mutate: token => approveRefund(activeRecord.id, {
            comment: values.comment?.trim() || undefined,
            expectedVersion,
          }, token),
        });
        if (ok) {
          message.success('退款/减免已批准');
        } else {
          // SPEC-014 Task 3：approve 失败（409 陈旧 expectedVersion / 403 STEP_UP 等，store 吞错
          // 返回 false）——内联提示 + 保持动作 Modal 打开，用户可重试或取消。具体业务码已由
          // request 拦截器全局 message.error 提示（双提示可接受）。
          message.error('审批操作失败，请重试');
          return;
        }
      } else if (activeModal === 'reject') {
        const ok = await rejectRefund(activeRecord.id, { comment: values.comment!.trim() });
        if (ok) message.success('退款/减免已驳回');
      }
      setActiveModal(null);
      setActiveRecord(null);
    } catch (error) {
      // STEP_UP_CANCELLED（用户取消挑战）：静默保持动作模态，不提示成功也不提示错误。
      // 其余异常（如审批 API 直接抛错）：沿 SPEC-014 Task 3 内联提示，Modal 保持打开。
      if (!(error instanceof Error && error.message === 'STEP_UP_CANCELLED')) {
        message.error('审批操作失败，请重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleExecute = async (record: RefundView) => {
    const ok = await executeRefund(record.id);
    if (ok) message.success('退款/减免已执行');
  };

  const columns = [
    { title: '案件编号 / 名称', key: 'linkedCase', width: 230, render: (_: unknown, row: RefundView) => row.linkedCase ? <span><a href={'/cases?caseNo=' + encodeURIComponent(row.linkedCase.caseNo)}>{row.linkedCase.caseNo}</a><br />{row.linkedCase.title}</span> : '待关联案件' },
    { title: '申请编号', dataIndex: 'requestNo', key: 'requestNo', width: 170 },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (value: RefundType) => {
        const meta = REFUND_TYPE_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    { title: '合同', dataIndex: 'contractId', key: 'contractId', width: 140 },
    { title: '客户', dataIndex: 'customerId', key: 'customerId', width: 140 },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'right' as const },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: RefundStatus) => {
        const meta = REFUND_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    ...((canApprove || canExecute)
      ? [{
          title: '操作',
          key: 'action',
          width: 200,
          render: (_: unknown, record: RefundView) => {
            if (record.status === 'PENDING' && canApprove) {
              return (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => openAction('approve', record)}>审批通过</Button>
                  <Button type="link" size="small" onClick={() => openAction('reject', record)}>拒绝</Button>
                </Space>
              );
            }
            if (record.status === 'APPROVED' && canExecute) {
              return (
                <Popconfirm
                  title="确认执行该退款/减免？"
                  description={record.type === 'REFUND'
                    ? '执行后将把对应收款置为已退款并回补合同已收金额。'
                    : '执行后将冲抵应收计划余额，操作不可撤销。'}
                  onConfirm={() => void handleExecute(record)}
                >
                  <Button type="link" size="small">执行</Button>
                </Popconfirm>
              );
            }
            return null;
          },
        }]
      : []),
  ];

  const actionModalTitle: Record<Exclude<ActionModal, null>, string> = {
    approve: '审批通过',
    reject: '驳回申请',
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]} align="middle">
          <Col flex="auto">
            <Space wrap>
              <Select
                aria-label="类型筛选"
                placeholder="类型筛选"
                value={type}
                onChange={value => setType(value)}
                style={{ width: 110 }}
                allowClear
                options={REFUND_TYPES.map(value => ({ value, label: REFUND_TYPE_META[value].text }))}
              />
              <Select
                aria-label="状态筛选"
                placeholder="状态筛选"
                value={status}
                onChange={value => setStatus(value)}
                style={{ width: 130 }}
                allowClear
                options={REFUND_STATUSES.map(value => ({ value, label: REFUND_STATUS_META[value].text }))}
              />
              <Button type="primary" onClick={handleSearch}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          {canCreate && (
            <Col>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建申请</Button>
            </Col>
          )}
        </Row>
      </Card>

      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="退款/减免列表加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<RefundView>
        columns={columns}
        dataSource={refunds}
        rowKey="id"
        loading={listLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无退款/减免申请' }}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: listTotal,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchRefunds(page, pageSize),
        }}
      />

      <Modal
        title="新建退款/减免申请"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={submitting}
        okText="确定"
        width={600}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Radio.Group aria-label="申请类型" onChange={event => handleTypeChange(event.target.value)}>
              <Radio value="REFUND">退款</Radio>
              <Radio value="WAIVER">减免</Radio>
            </Radio.Group>
          </Form.Item>
          {watchedType === 'WAIVER' ? (
            <>
              <Form.Item name="contractId" label="合同" rules={[{ required: true, message: '请选择合同' }]}>
                <Select
                  aria-label="合同"
                  showSearch
                  optionFilterProp="label"
                  placeholder="仅可选择已签署/已生效合同"
                  onChange={handleContractSelect}
                  options={receivableContracts.map(item => ({
                    value: item.id,
                    label: `${item.contractNo} ${item.title}（金额 ${item.amount}）`,
                  }))}
                />
              </Form.Item>
              <Form.Item name="planId" label="应收计划" rules={[{ required: true, message: '请选择应收计划' }]}>
                <Select
                  aria-label="应收计划"
                  placeholder="仅可选择待收/部分收款计划"
                  onChange={handlePlanSelect}
                  options={waiverPlans.map(item => ({
                    value: item.id,
                    label: `第${item.period}期 ${item.planNo}（应收 ${item.amount}，已收 ${item.receivedAmount}）`,
                  }))}
                />
              </Form.Item>
              {waiverMaxAmount !== undefined && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={`该计划余额上限 ${waiverMaxAmount.toFixed(2)} 元`}
                />
              )}
            </>
          ) : (
            <Form.Item
              name="paymentId"
              label="收款单"
              rules={[{ required: true, message: '请选择收款单' }]}
            >
              <Select
                aria-label="收款单"
                showSearch
                optionFilterProp="label"
                placeholder="仅可选择已确认收款"
                onChange={handlePaymentSelect}
                options={confirmedPayments.map(item => ({
                  value: item.id,
                  label: `${item.paymentNo}（金额 ${item.amount}）`,
                }))}
              />
            </Form.Item>
          )}
          <Form.Item
            name="amount"
            label={watchedType === 'WAIVER' ? '减免金额' : '退款金额'}
            rules={[
              { required: true, message: '请输入金额' },
              { type: 'number', min: 0.01, message: '金额须大于 0' },
            ]}
          >
            <InputNumber
              aria-label="金额"
              min={0.01}
              precision={2}
              max={watchedType === 'WAIVER' ? waiverMaxAmount : undefined}
              disabled={watchedType === 'REFUND'}
              style={{ width: 220 }}
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label="申请事由"
            rules={[{ required: true, whitespace: true, message: '请填写申请事由' }]}
          >
            <Input.TextArea rows={2} maxLength={500} placeholder="必填" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={activeModal ? actionModalTitle[activeModal] : ''}
        open={activeModal !== null}
        onCancel={() => { setActiveModal(null); setActiveRecord(null); }}
        onOk={() => void handleActionOk()}
        confirmLoading={submitting}
        okText={activeModal === 'reject' ? '确认驳回' : '确认批准'}
        okButtonProps={{ danger: activeModal === 'reject' }}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={activeModal === 'approve'
            ? '审批通过为高敏感操作（SPECIAL/CRITICAL 权限码），批准后不可撤销。'
            : '驳回为高敏感操作，请确认后再提交。'}
        />
        <Form form={actionForm} layout="vertical">
          {activeModal === 'approve' && (
            <Form.Item name="comment" label="审批意见（可选）">
              <Input.TextArea rows={3} maxLength={500} />
            </Form.Item>
          )}
          {activeModal === 'reject' && (
            <Form.Item
              name="comment"
              label="驳回原因"
              rules={[{ required: true, whitespace: true, message: '请输入驳回原因' }]}
            >
              <Input.TextArea rows={3} maxLength={500} placeholder="必填" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <StepUpDialog {...stepUp.dialogProps} />
    </div>
  );
};

export default RefundListPage;
