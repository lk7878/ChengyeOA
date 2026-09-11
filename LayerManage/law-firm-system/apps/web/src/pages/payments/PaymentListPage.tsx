import Table from '@/components/ResizableTable';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { usePaymentStore, type PaymentListFilters } from '@/stores/payment-store';
import { useAuthStore } from '@/stores/authStore';
import { contractApi, type ContractView } from '@/api/contract';
import {
  PAYMENT_STATUSES,
  type PaymentStatus,
  type PaymentView,
} from '@/api/payment';
import { PAYMENT_STATUS_META } from '../contracts/meta';

interface RegisterFormValues {
  contractId: string;
  amount: number;
  method?: string;
  account?: string;
  paidAt?: Dayjs;
  remark?: string;
}

const PaymentListPage: React.FC<{ caseNo?: string }> = ({ caseNo }) => {
  const {
    payments, listTotal, listPage, listPageSize, listLoading, listError,
    fetchPayments, applyFilters, createPayment, confirmPayment, voidPayment,
  } = usePaymentStore();
  const canCreate = useAuthStore(state => state.hasPermission('payment.create'));
  const canConfirm = useAuthStore(state => state.hasPermission('payment.confirm'));
  const canVoid = useAuthStore(state => state.hasPermission('payment.void'));
  const [status, setStatus] = useState<PaymentStatus | undefined>(undefined);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receivableContracts, setReceivableContracts] = useState<ContractView[]>([]);
  const [voidRecord, setVoidRecord] = useState<PaymentView | null>(null);
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const [form] = Form.useForm<RegisterFormValues>();
  const [voidForm] = Form.useForm<{ reason: string }>();

  useEffect(() => { void applyFilters({ caseNo }); }, [caseNo, applyFilters]);

  const openRegister = () => {
    form.resetFields();
    setRegisterOpen(true);
    
    // 收款登记仅接受 SIGNED/EFFECTIVE 合同（后端口径），前端预筛减少 400。
    void contractApi.list({ page: 1, pageSize: 100, caseNo })
      .then(res => setReceivableContracts(res.data.list.filter(
        item => item.status === 'SIGNED' || item.status === 'EFFECTIVE',
      )))
      .catch(() => undefined);
  };

  const handleSearch = () => {
    const filters: PaymentListFilters = {};
    if (status) filters.status = status;
    void applyFilters({ ...filters, caseNo });
  };

  const handleReset = () => {
    setStatus(undefined);
    void applyFilters({ caseNo });
  };

  const handleRegister = async (values: RegisterFormValues) => {
    setSubmitting(true);
    try {
      const created = await createPayment({
        contractId: values.contractId,
        caseNo,
        amount: values.amount.toFixed(2),
        ...(values.method?.trim() ? { method: values.method.trim() } : {}),
        ...(values.account?.trim() ? { account: values.account.trim() } : {}),
        ...(values.paidAt ? { paidAt: values.paidAt.toISOString() } : {}),
        ...(values.remark?.trim() ? { remark: values.remark.trim() } : {}),
      });
      if (!created) return;
      message.success('收款登记成功');
      setRegisterOpen(false);
      void fetchPayments(1);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (record: PaymentView) => {
    const ok = await confirmPayment(record.id);
    if (ok) message.success('收款已确认');
  };

  const openVoid = (record: PaymentView) => {
    voidForm.resetFields();
    setVoidRecord(record);
  };

  const handleVoid = async (values: { reason: string }) => {
    if (!voidRecord) return;
    setVoidSubmitting(true);
    try {
      const ok = await voidPayment(voidRecord.id, { reason: values.reason.trim() });
      if (ok) {
        message.success('收款已冲销');
        setVoidRecord(null);
      }
    } finally {
      setVoidSubmitting(false);
    }
  };

  const columns = [
    { title: '案件编号 / 名称', key: 'linkedCase', width: 230, render: (_: unknown, row: PaymentView) => row.linkedCase ? <span><a href={'/cases?caseNo=' + encodeURIComponent(row.linkedCase.caseNo)}>{row.linkedCase.caseNo}</a><br />{row.linkedCase.title}</span> : '待关联案件' },
    { title: '收款编号', dataIndex: 'paymentNo', key: 'paymentNo', width: 170 },
    {
      title: '合同',
      dataIndex: 'contractId',
      key: 'contractId',
      width: 140,
      render: (value: string) => value,
    },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'right' as const },
    { title: '方式', dataIndex: 'method', key: 'method', width: 100, render: (value: string | null) => value ?? '-' },
    {
      title: '到账时间',
      dataIndex: 'paidAt',
      key: 'paidAt',
      width: 150,
      render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: PaymentStatus) => {
        const meta = PAYMENT_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '确认时间',
      dataIndex: 'confirmedAt',
      key: 'confirmedAt',
      width: 150,
      render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'),
    },
    ...((canConfirm || canVoid)
      ? [{
          title: '操作',
          key: 'action',
          width: 120,
          render: (_: unknown, record: PaymentView) => {
            if (record.status === 'PENDING' && canConfirm) {
              return (
                <Popconfirm
                  title="确认该笔收款已到账？"
                  description="确认后将冲抵应收计划并累计合同已收金额。"
                  onConfirm={() => void handleConfirm(record)}
                >
                  <Button type="link" size="small">确认</Button>
                </Popconfirm>
              );
            }
            if (record.status === 'CONFIRMED' && canVoid) {
              // 冲销：CONFIRMED→VOIDED + 资金回补，reason 必填（payment.void）。
              return <Button type="link" size="small" danger onClick={() => openVoid(record)}>冲销</Button>;
            }
            return null;
          },
        }]
      : []),
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]} align="middle">
          <Col flex="auto">
            <Space wrap>
              <Select
                aria-label="状态筛选"
                placeholder="状态筛选"
                value={status}
                onChange={value => setStatus(value)}
                style={{ width: 130 }}
                allowClear
                options={PAYMENT_STATUSES.map(value => ({ value, label: PAYMENT_STATUS_META[value].text }))}
              />
              <Button type="primary" onClick={handleSearch}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          {canCreate && (
            <Col>
              <Button type="primary" icon={<PlusOutlined />} onClick={openRegister}>登记收款</Button>
            </Col>
          )}
        </Row>
      </Card>

      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="收款列表加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<PaymentView>
        columns={columns}
        dataSource={payments}
        rowKey="id"
        loading={listLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无收款记录' }}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: listTotal,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchPayments(page, pageSize),
        }}
      />

      <Modal
        title="登记收款"
        open={registerOpen}
        onCancel={() => setRegisterOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleRegister}>
          <Form.Item name="contractId" label="合同" rules={[{ required: true, message: '请选择合同' }]}>
            <Select
              aria-label="合同"
              showSearch
              optionFilterProp="label"
              placeholder="仅可选择已签署/已生效合同"
              options={receivableContracts.map(item => ({
                value: item.id,
                label: `${item.contractNo} ${item.title}（金额 ${item.amount}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="amount" label="收款金额" rules={[{ required: true, message: '请输入收款金额' }]}>
            <InputNumber aria-label="收款金额" min={0.01} precision={2} style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="method" label="收款方式">
            <Input maxLength={50} placeholder="银行转账/现金/微信/支付宝等" />
          </Form.Item>
          <Form.Item name="account" label="收款账户">
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="paidAt" label="到账时间（缺省取当前时间）">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="冲销收款"
        open={voidRecord !== null}
        onCancel={() => setVoidRecord(null)}
        onOk={() => voidForm.submit()}
        confirmLoading={voidSubmitting}
        okText="确认冲销"
        okButtonProps={{ danger: true }}
        width={520}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="冲销为高敏感操作：将把该收款置为已冲销并回补合同已收金额，操作不可撤销。"
        />
        <Form form={voidForm} layout="vertical" onFinish={handleVoid}>
          <Form.Item
            name="reason"
            label="冲销原因"
            rules={[{ required: true, whitespace: true, message: '请输入冲销原因' }]}
          >
            <Input.TextArea rows={3} maxLength={500} placeholder="必填" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PaymentListPage;
