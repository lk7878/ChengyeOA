import LinkedContractCase from '../Case/LinkedContractCase';
import { BusinessTableLinks } from '@/features/crm/BusinessWorkspacePage';
import Table from '@/components/ResizableTable';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Timeline,
  message,
} from 'antd';
import Modal from '@/components/DraggableModal';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router';
import dayjs, { type Dayjs } from 'dayjs';
import { useContractStore } from '@/stores/contract-store';
import { useAuthStore } from '@/stores/authStore';
import type { ContractAction } from '@/api/contract';
import type { PaymentPlanView, PaymentView } from '@/api/payment';
import {
  CONTRACT_ACTION_META,
  CONTRACT_STATUS_META,
  CONTRACT_TYPE_META,
  PAYMENT_PLAN_STATUS_META,
  PAYMENT_STATUS_META,
  availableContractActions,
} from './meta';

type ActionModal = 'approve' | 'reject' | 'sign' | 'effect' | 'terminate' | 'void' | null;

const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm';

function formatDateTime(value: string | null): string {
  return value ? dayjs(value).format(DATE_TIME_FORMAT) : '-';
}

const ContractDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const {
    detail,
    fetchContractDetail, resetDetail,
    submitContract, approveContract, rejectContract, signContract,
    effectContract, terminateContract, voidContract,
  } = useContractStore();
  const { contract, plans, payments, loading, error } = detail;
  const hasPermission = useAuthStore(state => state.hasPermission);
  const canReadPayments = useAuthStore(state => state.hasPermission('payment.read'));

  const [activeModal, setActiveModal] = useState<ActionModal>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionForm] = Form.useForm<{ comment?: string; reason?: string; signDate?: Dayjs; effectiveDate?: Dayjs }>();

  useEffect(() => {
    if (id) void fetchContractDetail(id);
    return () => resetDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, canReadPayments]);

  const openModal = (modal: Exclude<ActionModal, null>) => {
    actionForm.resetFields();
    setActiveModal(modal);
  };

  const runSubmit = async (action: () => Promise<boolean>, successText: string): Promise<boolean> => {
    setSubmitting(true);
    try {
      const ok = await action();
      if (ok) {
        message.success(successText);
        setActiveModal(null);
      }
      return ok;
    } finally {
      setSubmitting(false);
    }
  };

  const handleModalOk = async () => {
    const values = await actionForm.validateFields();
    switch (activeModal) {
      case 'approve':
        await runSubmit(() => approveContract(id, { comment: values.comment?.trim() || undefined }), '审批通过');
        break;
      case 'reject':
        await runSubmit(() => rejectContract(id, { comment: values.comment!.trim() }), '已驳回');
        break;
      case 'sign':
        await runSubmit(
          () => signContract(id, values.signDate ? { signDate: values.signDate.toISOString() } : {}),
          '签署成功',
        );
        break;
      case 'effect':
        await runSubmit(
          () => effectContract(id, values.effectiveDate ? { effectiveDate: values.effectiveDate.toISOString() } : {}),
          '合同已生效',
        );
        break;
      case 'terminate': {
        const ok = await runSubmit(() => terminateContract(id, { reason: values.reason!.trim() }), '合同已终止');
        // SPEC-012 Task 6：终止联动取消未清计划——回源刷新计划列表展示 CANCELLED 态。
        if (ok) await fetchContractDetail(id);
        break;
      }
      case 'void':
        await runSubmit(() => voidContract(id, { reason: values.reason!.trim() }), '合同已作废');
        break;
      default:
        break;
    }
  };

  const handleActionClick = (action: ContractAction) => {
    if (action === 'submit') return;
    openModal(action);
  };

  if (loading && !contract) {
    return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>;
  }

  if (error && !contract) {
    return (
      <Alert
        role="alert"
        type="error"
        showIcon
        message="合同详情加载失败"
        description={error}
        action={<Button onClick={() => navigate('/contracts')}>返回列表</Button>}
      />
    );
  }

  if (!contract) return null;

  const statusMeta = CONTRACT_STATUS_META[contract.status] ?? { text: contract.status, color: 'default' };
  const typeMeta = CONTRACT_TYPE_META[contract.contractType] ?? { text: contract.contractType, color: 'default' };
  // SPEC-012 Task 6：未清计划计数（PENDING/PARTIAL）——终止弹窗提示「将取消 N 个未清付款计划」。
  const unsettledPlanCount = plans.filter(p => p.status === 'PENDING' || p.status === 'PARTIAL').length;
  const available = new Set(availableContractActions(contract.contractType, contract.status));
  // 按钮矩阵：无权限码隐藏；有码但状态不可用则禁用。
  const visibleActions = (Object.keys(CONTRACT_ACTION_META) as ContractAction[])
    .filter(action => hasPermission(CONTRACT_ACTION_META[action].permission));

  const modalTitle: Record<Exclude<ActionModal, null>, string> = {
    approve: '审批通过',
    reject: '驳回合同',
    sign: '签署合同',
    effect: '合同生效',
    terminate: '终止合同',
    void: '作废合同',
  };

  const planColumns = [
    { title: '期次', dataIndex: 'period', key: 'period', width: 70 },
    {
      title: '应收日',
      dataIndex: 'dueDate',
      key: 'dueDate',
      width: 120,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    { title: '应收金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right' as const },
    { title: '已收金额', dataIndex: 'receivedAmount', key: 'receivedAmount', width: 120, align: 'right' as const },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value: PaymentPlanView['status']) => {
        // SPEC-012 Task 6：CANCELLED 态——「已取消」灰化标签；amount/receivedAmount 列照常展示。
        if (value === 'CANCELLED') {
          return <Tag color="default" style={{ opacity: 0.75 }}>已取消</Tag>;
        }
        const meta = PAYMENT_PLAN_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
  ];

  const paymentColumns = [
    { title: '收款编号', dataIndex: 'paymentNo', key: 'paymentNo', width: 170 },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'right' as const },
    { title: '方式', dataIndex: 'method', key: 'method', width: 100, render: (value: string | null) => value ?? '-' },
    {
      title: '到账时间',
      dataIndex: 'paidAt',
      key: 'paidAt',
      width: 150,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: PaymentView['status']) => {
        const meta = PAYMENT_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '确认时间',
      dataIndex: 'confirmedAt',
      key: 'confirmedAt',
      width: 150,
      render: (value: string | null) => formatDateTime(value),
    },
  ];

  return (
    <div>
      <LinkedContractCase contractId={id} revision={contract.version} />
      <Space style={{ marginBottom: 16 }} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/contracts')}>返回列表</Button>
          <BusinessTableLinks source="CONTRACTS" recordId={id} />
          {contract.contractType==='FIRST_SIGN' && contract.status==='EFFECTIVE' && hasPermission('sop.instance.start') && <Button onClick={()=>navigate('/sop/instances/new?analysisContract='+id)}>启动分析委托SOP</Button>}
        {visibleActions.map(action => {
          const meta = CONTRACT_ACTION_META[action];
          const disabled = !available.has(action);
          if (action === 'submit') {
            return (
              <Popconfirm
                key={action}
                title="确认提交合同？"
                description={contract.contractType === 'RISK_NOTICE' ? '风险告知书无需审批，提交后直接进入待签署。' : '提交后进入审批流程。'}
                onConfirm={() => void submitContract(id).then(ok => ok && message.success('提交成功'))}
                disabled={disabled}
              >
                <Button type="primary" disabled={disabled}>{meta.text}</Button>
              </Popconfirm>
            );
          }
          return (
            <Button
              key={action}
              type={action === 'approve' || action === 'sign' || action === 'effect' ? 'primary' : 'default'}
              danger={meta.danger}
              disabled={disabled}
              onClick={() => handleActionClick(action)}
            >
              {meta.text}
            </Button>
          );
        })}
      </Space>

      {contract.contractType === 'FORMAL' && contract.status === 'SIGNED' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="生效前置提示"
          description="正式委托合同生效前，客户须已存在签署态风险告知书（RISK_NOTICE），否则服务端将拒绝生效（409 RISK_NOTICE_MISSING）。"
        />
      )}

      <Card title="合同信息" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="合同编号">{contract.contractNo}</Descriptions.Item>
          <Descriptions.Item label="标题">{contract.title}</Descriptions.Item>
          <Descriptions.Item label="类型"><Tag color={typeMeta.color}>{typeMeta.text}</Tag></Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={statusMeta.color}>{statusMeta.text}</Tag></Descriptions.Item>
          <Descriptions.Item label="合同金额">{contract.amount}</Descriptions.Item>
          <Descriptions.Item label="已收金额">{contract.receivedAmount}</Descriptions.Item>
          <Descriptions.Item label="客户ID">{contract.customerId}</Descriptions.Item>
          <Descriptions.Item label="模板">
            {contract.templateCode ? `${contract.templateCode}（v${contract.templateVersion ?? '-'}）` : '未使用模板'}
          </Descriptions.Item>
          <Descriptions.Item label="签署日期">{formatDateTime(contract.signDate)}</Descriptions.Item>
          <Descriptions.Item label="生效日期">{formatDateTime(contract.effectiveDate)}</Descriptions.Item>
          <Descriptions.Item label="开始日期">{contract.startDate ? dayjs(contract.startDate).format('YYYY-MM-DD') : '-'}</Descriptions.Item>
          <Descriptions.Item label="结束日期">{contract.endDate ? dayjs(contract.endDate).format('YYYY-MM-DD') : '-'}</Descriptions.Item>
          {contract.terminateReason && (
            <Descriptions.Item label="终止原因">{contract.terminateReason}</Descriptions.Item>
          )}
          {contract.voidReason && (
            <Descriptions.Item label="作废原因">{contract.voidReason}</Descriptions.Item>
          )}
          {contract.approvalComment && (
            <Descriptions.Item label="审批意见">{contract.approvalComment}</Descriptions.Item>
          )}
          {contract.terms && (
            <Descriptions.Item label="合同条款" span={3}>{contract.terms}</Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Card title="状态时间线" style={{ marginBottom: 16 }}>
        <Timeline
          items={[
            { color: 'green', children: `创建 ${formatDateTime(contract.createdAt)}` },
            {
              color: contract.submittedAt ? 'green' : 'gray',
              children: `提交 ${formatDateTime(contract.submittedAt)}`,
            },
            {
              color: contract.approvedAt ? 'green' : 'gray',
              children: `审批 ${formatDateTime(contract.approvedAt)}${contract.approvalComment ? `（${contract.approvalComment}）` : ''}`,
            },
            {
              color: contract.signDate ? 'green' : 'gray',
              children: `签署 ${formatDateTime(contract.signDate)}`,
            },
            ...(contract.contractType !== 'RISK_NOTICE'
              ? [{
                  color: contract.effectiveDate ? 'green' : 'gray',
                  children: `生效 ${formatDateTime(contract.effectiveDate)}`,
                }]
              : []),
            ...(contract.terminatedAt
              ? [{ color: 'red', children: `终止 ${formatDateTime(contract.terminatedAt)}（${contract.terminateReason ?? ''}）` }]
              : []),
            ...(contract.voidedAt
              ? [{ color: 'red', children: `作废 ${formatDateTime(contract.voidedAt)}（${contract.voidReason ?? ''}）` }]
              : []),
          ]}
        />
      </Card>

      {canReadPayments ? <>
      <Card title="应收计划" style={{ marginBottom: 16 }}>
        <Table<PaymentPlanView>
          columns={planColumns}
          dataSource={plans}
          rowKey="id"
          size="small"
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '暂无应收计划（合同生效后生成）' }}
          pagination={false}
        />
      </Card>

      <Card title="收款记录">
        <Table<PaymentView>
          columns={paymentColumns}
          dataSource={payments}
          rowKey="id"
          size="small"
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '暂无收款记录' }}
          pagination={false}
        />
      </Card>

      </> : <Alert type="info" message="未授权查看应收计划和收款记录" />}

      <Modal
        title={activeModal ? modalTitle[activeModal] : ''}
        open={activeModal !== null}
        onCancel={() => setActiveModal(null)}
        onOk={() => void handleModalOk()}
        confirmLoading={submitting}
        okText={activeModal === 'terminate' || activeModal === 'void' ? '确认' : '确定'}
        okButtonProps={{ danger: activeModal === 'terminate' || activeModal === 'void' || activeModal === 'reject' }}
        destroyOnHidden
      >
        {activeModal === 'effect' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="生效将生成应收计划并联动案件/委托，操作不可撤销。"
          />
        )}
        {(activeModal === 'terminate' || activeModal === 'void') && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={activeModal === 'terminate' ? '终止为高风险操作，原因必填。' : '作废为高风险操作，原因必填。'}
          />
        )}
        {activeModal === 'terminate' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={canReadPayments && unsettledPlanCount > 0 ? `将取消 ${unsettledPlanCount} 个未清付款计划` : canReadPayments ? '无未清付款计划' : '未授权查看付款计划；终止时由服务端检查并取消未清计划'}
          />
        )}
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
          {(activeModal === 'terminate' || activeModal === 'void') && (
            <Form.Item
              name="reason"
              label={activeModal === 'terminate' ? '终止原因' : '作废原因'}
              rules={[{ required: true, whitespace: true, message: '请输入原因' }]}
            >
              <Input.TextArea rows={3} maxLength={500} placeholder="必填" />
            </Form.Item>
          )}
          {activeModal === 'sign' && (
            <Form.Item name="signDate" label="签署时间（缺省取当前时间）">
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          )}
          {activeModal === 'effect' && (
            <Form.Item name="effectiveDate" label="生效时间（缺省取当前时间）">
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default ContractDetailPage;
