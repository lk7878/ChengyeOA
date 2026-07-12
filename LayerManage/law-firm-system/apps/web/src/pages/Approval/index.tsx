import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Tag, Space, Modal, Form, message,
  Card, Row, Col, Select, Badge
} from 'antd';
import {
  PlusOutlined, SyncOutlined,
  CheckCircleOutlined, CloseCircleOutlined, EyeOutlined
} from '@ant-design/icons';
import { approvalApi } from '@/api/organization';
import type { Approval } from '@/types';
import dayjs from 'dayjs';

const statusMap: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待审批', color: 'orange' },
  APPROVED: { text: '已通过', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'red' },
};

const typeMap: Record<string, string> = {
  CONTRACT: '合同审批',
  EXPENSE: '费用报销',
  LEAVE: '请假申请',
  OVERTIME: '加班申请',
  OTHER: '其他',
};

const ApprovalPage: React.FC = () => {
  const [data, setData] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [modalVisible, setModalVisible] = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [currentApproval, setCurrentApproval] = useState<Approval | null>(null);
  const [processModal, setProcessModal] = useState(false);
  const [processAction, setProcessAction] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [processRemark, setProcessRemark] = useState('');
  const [form] = Form.useForm();

  useEffect(() => { fetchData(); }, [pagination.current, pagination.pageSize, statusFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = { page: pagination.current, pageSize: pagination.pageSize };
      if (statusFilter) params.status = statusFilter;
      if (searchKeyword) params.keyword = searchKeyword;
      const res: any = await approvalApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
      }
    } finally { setLoading(false); }
  };

  const handleDelete = async (_id: string) => {
    message.success('审批记录不支持删除');
  };
  void handleDelete;

  const handleProcess = async () => {
    if (!currentApproval) return;
    try {
      await approvalApi.process(currentApproval.id, { status: processAction, remark: processRemark });
      message.success(processAction === 'APPROVED' ? '审批通过' : '已拒绝');
      setProcessModal(false);
      setCurrentApproval(null);
      setProcessRemark('');
      fetchData();
    } catch (e) {}
  };

  const openProcessModal = (record: Approval, action: 'APPROVED' | 'REJECTED') => {
    setCurrentApproval(record);
    setProcessAction(action);
    setProcessModal(true);
  };

  const openDetail = (record: Approval) => {
    setCurrentApproval(record);
    setDetailModal(true);
  };

  const columns = [
    { title: '审批标题', dataIndex: 'title', key: 'title' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => typeMap[t] || t },
    { title: '申请人ID', dataIndex: 'applicantId', key: 'applicantId' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const config = statusMap[s] || { text: s, color: 'default' };
        return <Badge status={config.color as any} text={config.text} />;
      },
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: any, record: Approval) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>详情</Button>
          {record.status === 'PENDING' && (
            <>
              <Button type="link" size="small" icon={<CheckCircleOutlined />} style={{ color: '#52c41a' }} onClick={() => openProcessModal(record, 'APPROVED')}>通过</Button>
              <Button type="link" size="small" icon={<CloseCircleOutlined />} danger onClick={() => openProcessModal(record, 'REJECTED')}>拒绝</Button>
            </>
          )}
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
              <Input placeholder="搜索标题" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} onPressEnter={fetchData} style={{ width: 200 }} />
              <Select placeholder="状态筛选" allowClear style={{ width: 120 }} value={statusFilter} onChange={(v) => setStatusFilter(v)}>
                <Select.Option value="PENDING">待审批</Select.Option>
                <Select.Option value="APPROVED">已通过</Select.Option>
                <Select.Option value="REJECTED">已拒绝</Select.Option>
              </Select>
              <Button type="primary" icon={<SyncOutlined />} onClick={fetchData}>搜索</Button>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalVisible(true); }}>新建审批</Button>
          </Col>
        </Row>
      </Card>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
        pagination={{ ...pagination, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => setPagination({ ...pagination, current: p, pageSize: ps || 10 }) }} />

      {/* 新建审批 */}
      <Modal title="新建审批" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} onFinish={async (v) => {
          await approvalApi.create(v);
          message.success('创建成功');
          setModalVisible(false);
          fetchData();
        }}>
          <Form.Item name="type" label="审批类型" rules={[{ required: true }]}>
            <Select placeholder="请选择">
              <Select.Option value="CONTRACT">合同审批</Select.Option>
              <Select.Option value="EXPENSE">费用报销</Select.Option>
              <Select.Option value="LEAVE">请假申请</Select.Option>
              <Select.Option value="OVERTIME">加班申请</Select.Option>
              <Select.Option value="OTHER">其他</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="content" label="内容"><Input.TextArea rows={4} /></Form.Item>
        </Form>
      </Modal>

      {/* 审批详情 */}
      <Modal title="审批详情" open={detailModal} onCancel={() => setDetailModal(false)} footer={null}>
        {currentApproval && (
          <div>
            <p><strong>标题：</strong>{currentApproval.title}</p>
            <p><strong>类型：</strong>{typeMap[currentApproval.type] || currentApproval.type}</p>
            <p><strong>申请人ID：</strong>{currentApproval.applicantId}</p>
            <p><strong>状态：</strong><Tag color={statusMap[currentApproval.status]?.color}>{statusMap[currentApproval.status]?.text}</Tag></p>
            <p><strong>内容：</strong>{currentApproval.content || '-'}</p>
            <p><strong>审批人ID：</strong>{currentApproval.approverId || '-'}</p>
            <p><strong>审批时间：</strong>{currentApproval.approvedAt ? dayjs(currentApproval.approvedAt).format('YYYY-MM-DD HH:mm') : '-'}</p>
            <p><strong>备注：</strong>{currentApproval.remark || '-'}</p>
            <p><strong>申请时间：</strong>{dayjs(currentApproval.createdAt).format('YYYY-MM-DD HH:mm')}</p>
          </div>
        )}
      </Modal>

      {/* 处理审批 */}
      <Modal
        title={processAction === 'APPROVED' ? '审批通过' : '拒绝审批'}
        open={processModal}
        onCancel={() => setProcessModal(false)}
        onOk={handleProcess}
        okText="确认"
        cancelText="取消"
        okButtonProps={{ danger: processAction === 'REJECTED' }}
      >
        <p>审批：{currentApproval?.title}</p>
        <Input.TextArea
          placeholder="请输入备注（可选）"
          rows={3}
          value={processRemark}
          onChange={(e) => setProcessRemark(e.target.value)}
        />
      </Modal>
    </div>
  );
};

export default ApprovalPage;
