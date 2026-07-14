import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Select, Tag, Space, Modal, Form, message,
  Popconfirm, Card, Row, Col
} from 'antd';
import {
  PlusOutlined, SearchOutlined, DeleteOutlined,
  SyncOutlined, CheckCircleOutlined, RollbackOutlined
} from '@ant-design/icons';
import { paymentApi } from '@/api/business';
import type { Payment } from '@/types';
import dayjs from 'dayjs';

const { Option } = Select;

const statusMap: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待收款', color: 'orange' },
  RECEIVED: { text: '已收款', color: 'green' },
  OVERDUE: { text: '逾期', color: 'red' },
  REFUNDED: { text: '已退款', color: 'default' },
};

const PaymentPage: React.FC = () => {
  const [data, setData] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [searchStatus, setSearchStatus] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [confirmModal, setConfirmModal] = useState(false);
  const [refundModal, setRefundModal] = useState(false);
  const [currentPayment, setCurrentPayment] = useState<Payment | null>(null);
  const [form] = Form.useForm();
  const [confirmForm] = Form.useForm();
  const [refundForm] = Form.useForm();

  useEffect(() => { fetchData(); }, [pagination.current, pagination.pageSize]);

  async function fetchData() {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean | undefined> = { page: pagination.current, pageSize: pagination.pageSize };
      if (searchStatus) params.status = searchStatus;
      const res = await paymentApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
      }
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try { await paymentApi.delete(id); message.success('删除成功'); fetchData(); } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const columns = [
    { title: '客户', dataIndex: 'customer', key: 'customer', render: (c: Payment['customer']) => c?.name || '-' },
    { title: '合同', dataIndex: 'contract', key: 'contract', render: (c: Payment['contract']) => c?.title || '-' },
    { title: '应收金额', dataIndex: 'amount', key: 'amount', render: (v: number) => `¥${v?.toLocaleString()}` },
    { title: '已收金额', dataIndex: 'receivedAmount', key: 'receivedAmount', render: (v: number) => `¥${v?.toLocaleString()}` },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.text}</Tag>,
    },
    { title: '应收日期', dataIndex: 'dueDate', key: 'dueDate', render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    { title: '实收日期', dataIndex: 'receivedDate', key: 'receivedDate', render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Payment) => (
        <Space size="small">
          {record.status === 'PENDING' && (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => { setCurrentPayment(record); confirmForm.resetFields(); setConfirmModal(true); }}>
              确认收款
            </Button>
          )}
          {record.status === 'RECEIVED' && (
            <Button type="link" size="small" icon={<RollbackOutlined />} onClick={() => { setCurrentPayment(record); refundForm.resetFields(); setRefundModal(true); }}>
              退款
            </Button>
          )}
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <Space>
              <Select placeholder="状态筛选" value={searchStatus || undefined} onChange={setSearchStatus} style={{ width: 150 }} allowClear>
                {Object.entries(statusMap).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}
              </Select>
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchData}>搜索</Button>
              <Button icon={<SyncOutlined />} onClick={() => { setSearchStatus(''); fetchData(); }}>重置</Button>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalVisible(true); }}>新建收款</Button>
          </Col>
        </Row>
      </Card>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
        pagination={{ ...pagination, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => setPagination({ ...pagination, current: p, pageSize: ps || 10 }) }} />

      {/* 新建 */}
      <Modal title="新建收款" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} onFinish={async (v) => { await paymentApi.create(v); message.success('创建成功'); setModalVisible(false); fetchData(); }}>
          <Form.Item name="customerId" label="客户ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="contractId" label="合同ID"><Input /></Form.Item>
          <Form.Item name="amount" label="应收金额" rules={[{ required: true }]}><Input type="number" /></Form.Item>
          <Form.Item name="dueDate" label="应收日期"><Input type="date" /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      {/* 确认收款 */}
      <Modal title="确认收款" open={confirmModal} onCancel={() => setConfirmModal(false)} onOk={() => confirmForm.submit()}>
        <Form form={confirmForm} onFinish={async (v) => { await paymentApi.confirm(currentPayment!.id, v); message.success('确认成功'); setConfirmModal(false); fetchData(); }}>
          <Form.Item name="receivedAmount" label="实收金额" rules={[{ required: true }]}><Input type="number" /></Form.Item>
          <Form.Item name="receivedDate" label="收款日期" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name="paymentMethod" label="收款方式"><Input placeholder="如：银行转账/支付宝" /></Form.Item>
        </Form>
      </Modal>

      {/* 退款 */}
      <Modal title="退款" open={refundModal} onCancel={() => setRefundModal(false)} onOk={() => refundForm.submit()}>
        <Form form={refundForm} onFinish={async (v) => { await paymentApi.refund(currentPayment!.id, v); message.success('退款成功'); setRefundModal(false); fetchData(); }}>
          <Form.Item name="refundAmount" label="退款金额" rules={[{ required: true }]}><Input type="number" /></Form.Item>
          <Form.Item name="reason" label="退款原因" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PaymentPage;
