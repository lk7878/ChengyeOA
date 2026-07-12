import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Tag, Space, Modal, Form, message,
  Popconfirm, Card, Row, Col, TreeSelect
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  SyncOutlined, CheckCircleOutlined, LogoutOutlined
} from '@ant-design/icons';
import { employeeApi, organizationApi } from '../../api/organization';
import type { Employee, Organization } from '../../types';
import dayjs from 'dayjs';

const statusMap: Record<string, { text: string; color: string }> = {
  PROBATION: { text: '试用期', color: 'orange' },
  FORMAL: { text: '正式', color: 'green' },
  LEAVED: { text: '已离职', color: 'default' },
};

const typeMap: Record<string, string> = {
  PARTNER: '合伙人',
  SENIOR_LAWYER: '资深律师',
  JUNIOR_LAWYER: '初级律师',
  ASSISTANT: '律师助理',
  SALES: '销售',
  ADMIN: '行政',
  HR: '人事',
  FINANCE: '财务',
  OPERATOR: '运营',
};

const EmployeePage: React.FC = () => {
  const [data, setData] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [orgs, setOrgs] = useState<Organization[]>([]);

  useEffect(() => { fetchData(); fetchOrgs(); }, [pagination.current, pagination.pageSize]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = { page: pagination.current, pageSize: pagination.pageSize };
      if (searchKeyword) params.keyword = searchKeyword;
      const res: any = await employeeApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
      }
    } finally { setLoading(false); }
  };

  const fetchOrgs = async () => {
    try {
      const res: any = await organizationApi.list();
      if (res.code === 200) setOrgs(res.data);
    } catch (e) {}
  };

  const handleDelete = async (id: string) => {
    try { await employeeApi.delete(id); message.success('删除成功'); fetchData(); } catch (e) {}
  };

  const handleFormalize = async (id: string) => {
    try { await employeeApi.formalize(id); message.success('转正成功'); fetchData(); } catch (e) {}
  };

  const handleLeave = async (id: string) => {
    try { await employeeApi.leave(id, dayjs().format('YYYY-MM-DD')); message.success('离职处理成功'); fetchData(); } catch (e) {}
  };

  const columns = [
    { title: '工号', dataIndex: 'employeeNo', key: 'employeeNo' },
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => typeMap[t] || t },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.text}</Tag>,
    },
    { title: '部门', dataIndex: 'organization', key: 'organization', render: (o: any) => o?.name || '-' },
    { title: '岗位', dataIndex: 'position', key: 'position', render: (p: any) => p?.name || '-' },
    { title: '入职日期', dataIndex: 'entryDate', key: 'entryDate', render: (d: string) => dayjs(d).format('YYYY-MM-DD') },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: any, record: Employee) => (
        <Space size="small">
          {record.status === 'PROBATION' && (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => handleFormalize(record.id)}>转正</Button>
          )}
          {record.status === 'FORMAL' && (
            <Popconfirm title="确认离职？" onConfirm={() => handleLeave(record.id)}>
              <Button type="link" size="small" icon={<LogoutOutlined />}>离职</Button>
            </Popconfirm>
          )}
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue(record); setModalVisible(true); }}>编辑</Button>
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
              <Input placeholder="搜索姓名/工号" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} onPressEnter={fetchData} prefix={<SearchOutlined />} style={{ width: 200 }} />
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchData}>搜索</Button>
              <Button icon={<SyncOutlined />} onClick={() => { setSearchKeyword(''); fetchData(); }}>重置</Button>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalVisible(true); }}>新建员工</Button>
          </Col>
        </Row>
      </Card>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
        pagination={{ ...pagination, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => setPagination({ ...pagination, current: p, pageSize: ps || 10 }) }} />

      <Modal title="员工信息" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()} width={700}>
        <Form form={form} layout="vertical" onFinish={async (v) => {
          if (v.id) { await employeeApi.update(v.id, v); message.success('更新成功'); }
          else { await employeeApi.create(v); message.success('创建成功'); }
          setModalVisible(false); fetchData();
        }}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="employeeNo" label="工号" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="phone" label="电话" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="email" label="邮箱"><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="type" label="类型" rules={[{ required: true }]}>
              <select style={{ width: '100%', height: 32, borderRadius: 6, border: '1px solid #d9d9d9' }}>
                {Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Form.Item></Col>
            <Col span={12}><Form.Item name="entryDate" label="入职日期" rules={[{ required: true }]}><Input type="date" /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="orgId" label="部门" rules={[{ required: true }]}>
              <TreeSelect treeData={orgs.map(o => ({ title: o.name, value: o.id }))} placeholder="选择部门" style={{ width: '100%' }} />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="positionId" label="岗位"><Input placeholder="岗位ID" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

export default EmployeePage;
