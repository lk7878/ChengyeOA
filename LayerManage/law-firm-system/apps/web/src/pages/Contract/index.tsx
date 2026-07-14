import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Select, Tag, Space, Modal, Form, message,
  Popconfirm, Card, Row, Col
} from 'antd';
import {
  PlusOutlined, SearchOutlined, DeleteOutlined,
  SyncOutlined, CheckCircleOutlined, CloseCircleOutlined,
  FileDoneOutlined, SendOutlined
} from '@ant-design/icons';
import { contractApi } from '@/api/business';
import type { Contract } from '@/types';
import dayjs from 'dayjs';

const { Option } = Select;


const statusMap: Record<string, { text: string; color: string }> = {
  DRAFT: { text: '草稿', color: 'default' },
  PENDING: { text: '待审批', color: 'orange' },
  APPROVED: { text: '已审批', color: 'blue' },
  SIGNED: { text: '已签署', color: 'green' },
  EXECUTING: { text: '执行中', color: 'cyan' },
  COMPLETED: { text: '已完成', color: 'purple' },
  TERMINATED: { text: '已终止', color: 'red' },
  CANCELLED: { text: '已取消', color: 'default' },
};

const typeMap: Record<string, string> = {
  CONSULTING: '咨询合同',
  RETAINER: '常年法律顾问',
  LITIGATION: '诉讼代理',
  ARBITRATION: '仲裁代理',
  MEDIATION: '调解',
  OTHER: '其他',
};

const ContractPage: React.FC = () => {
  const [data, setData] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => { fetchData(); }, [pagination.current, pagination.pageSize]);

  async function fetchData() {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean | undefined> = { page: pagination.current, pageSize: pagination.pageSize };
      if (searchKeyword) params.keyword = searchKeyword;
      if (searchStatus) params.status = searchStatus;
      const res = await contractApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
      }
    } finally { setLoading(false); }
  };

  const handleAction = async (id: string, action: string, extra?: { reason: string }) => {
    try {
      switch (action) {
        case 'submit': await contractApi.submit(id); break;
        case 'approve': await contractApi.approve(id); break;
        case 'sign': await contractApi.sign(id, dayjs().format('YYYY-MM-DD')); break;
        case 'terminate': await contractApi.terminate(id, extra!.reason); break;
        case 'delete': await contractApi.delete(id); break;
      }
      message.success('操作成功');
      fetchData();
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const columns = [
    { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo' },
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => typeMap[t] || t },
    { title: '客户', dataIndex: 'customer', key: 'customer', render: (c: Contract['customer']) => c?.name || '-' },
    { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: number) => `¥${v?.toLocaleString()}` },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.text}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 300,
      render: (_: unknown, record: Contract) => (
        <Space size="small">
          {record.status === 'DRAFT' && (
            <Button type="link" size="small" icon={<SendOutlined />} onClick={() => handleAction(record.id, 'submit')}>
              提交
            </Button>
          )}
          {record.status === 'PENDING' && (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => handleAction(record.id, 'approve')}>
              审批
            </Button>
          )}
          {record.status === 'APPROVED' && (
            <Button type="link" size="small" icon={<FileDoneOutlined />} onClick={() => handleAction(record.id, 'sign')}>
              签署
            </Button>
          )}
          {(record.status === 'SIGNED' || record.status === 'EXECUTING') && (
            <Popconfirm
              title="终止合同"
              description="请输入终止原因"
              onConfirm={() => handleAction(record.id, 'terminate', { reason: '双方协商一致' })}
            >
              <Button type="link" danger size="small" icon={<CloseCircleOutlined />}>
                终止
              </Button>
            </Popconfirm>
          )}
          <Popconfirm title="确定删除？" onConfirm={() => handleAction(record.id, 'delete')}>
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
              <Input placeholder="搜索编号/标题" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} onPressEnter={fetchData} prefix={<SearchOutlined />} style={{ width: 200 }} />
              <Select placeholder="状态" value={searchStatus || undefined} onChange={setSearchStatus} style={{ width: 150 }} allowClear>
                {Object.entries(statusMap).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}
              </Select>
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchData}>搜索</Button>
              <Button icon={<SyncOutlined />} onClick={() => { setSearchKeyword(''); setSearchStatus(''); fetchData(); }}>重置</Button>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalVisible(true); }}>新建合同</Button>
          </Col>
        </Row>
      </Card>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
        pagination={{ ...pagination, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => setPagination({ ...pagination, current: p, pageSize: ps || 10 }) }} />

      <Modal title="新建合同" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()} width={700}>
        <Form form={form} layout="vertical" onFinish={async (v) => { await contractApi.create(v); message.success('创建成功'); setModalVisible(false); fetchData(); }}>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="contractNo" label="合同编号" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="type" label="类型" rules={[{ required: true }]}>
              <Select>{Object.entries(typeMap).map(([k, v]) => <Option key={k} value={k}>{v}</Option>)}</Select>
            </Form.Item></Col>
            <Col span={12}><Form.Item name="customerId" label="客户ID" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="amount" label="金额" rules={[{ required: true }]}><Input type="number" /></Form.Item></Col>
            <Col span={12}><Form.Item name="startDate" label="开始日期"><Input type="date" /></Form.Item></Col>
          </Row>
          <Form.Item name="terms" label="条款"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ContractPage;
