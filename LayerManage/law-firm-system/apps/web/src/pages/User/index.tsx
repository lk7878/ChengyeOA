import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Tag, Space, Modal, Form, message,
  Popconfirm, Card, Row, Col
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  SyncOutlined, SafetyOutlined
} from '@ant-design/icons';
import { userApi, roleApi } from '@/api/user';
import type { User, Role } from '@/types';
import dayjs from 'dayjs';

const UserPage: React.FC = () => {
  const [data, setData] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [roleModal, setRoleModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [form] = Form.useForm();

  useEffect(() => { fetchData(); fetchRoles(); }, [pagination.current, pagination.pageSize]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = { page: pagination.current, pageSize: pagination.pageSize };
      if (searchKeyword) params.keyword = searchKeyword;
      const res: any = await userApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
      }
    } finally { setLoading(false); }
  };

  const fetchRoles = async () => {
    try {
      const res: any = await roleApi.list();
      if (res.code === 200) {
        const list = res.data.list || res.data;
        setRoles(list);
      }
    } catch (e) {}
  };

  const handleDelete = async (id: string) => {
    try { await userApi.delete(id); message.success('删除成功'); fetchData(); } catch (e) {}
  };

  const handleAssignRoles = (user: User) => {
    setCurrentUser(user);
    const currentRoleIds = user.userRoles?.map(ur => ur.roleId) || [];
    setSelectedRoles(currentRoleIds);
    setRoleModal(true);
  };

  const handleRoleSubmit = async () => {
    if (!currentUser) return;
    try {
      await userApi.assignRoles(currentUser.id, selectedRoles);
      message.success('角色分配成功');
      setRoleModal(false);
      fetchData();
    } catch (e) {}
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '姓名', dataIndex: 'employee', key: 'employee', render: (e: any) => e?.name || '-' },
    { title: '部门', dataIndex: 'employee', key: 'org', render: (e: any) => e?.organization?.name || '-' },
    {
      title: '角色',
      dataIndex: 'userRoles',
      key: 'roles',
      render: (urs: any[]) => urs?.map(ur => <Tag key={ur.roleId} color="blue">{ur.role?.name}</Tag>) || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={s === 'ENABLED' ? 'green' : 'red'}>{s === 'ENABLED' ? '启用' : '禁用'}</Tag>,
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 250,
      render: (_: any, record: User) => (
        <Space size="small">
          <Button type="link" size="small" icon={<SafetyOutlined />} onClick={() => handleAssignRoles(record)}>分配角色</Button>
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
              <Input placeholder="搜索用户名/姓名" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} onPressEnter={fetchData} prefix={<SearchOutlined />} style={{ width: 200 }} />
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchData}>搜索</Button>
              <Button icon={<SyncOutlined />} onClick={() => { setSearchKeyword(''); fetchData(); }}>重置</Button>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalVisible(true); }}>新建用户</Button>
          </Col>
        </Row>
      </Card>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
        pagination={{ ...pagination, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => setPagination({ ...pagination, current: p, pageSize: ps || 10 }) }} />

      {/* 新建/编辑 */}
      <Modal title="用户信息" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} onFinish={async (v) => {
          if (v.id) { await userApi.update(v.id, v); message.success('更新成功'); }
          else { await userApi.create(v); message.success('创建成功'); }
          setModalVisible(false); fetchData();
        }}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input /></Form.Item>
          {!form.getFieldValue('id') && (
            <Form.Item name="password" label="密码" rules={[{ required: true }]}><Input.Password />
            </Form.Item>
          )}
          <Form.Item name="status" label="状态" initialValue="ENABLED">
            <select style={{ width: '100%', height: 32, borderRadius: 6, border: '1px solid #d9d9d9' }}>
              <option value="ENABLED">启用</option>
              <option value="DISABLED">禁用</option>
            </select>
          </Form.Item>
          <Form.Item name="employeeId" label="关联员工"><Input placeholder="员工ID" /></Form.Item>
        </Form>
      </Modal>

      {/* 分配角色 */}
      <Modal title="分配角色" open={roleModal} onCancel={() => setRoleModal(false)} onOk={handleRoleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {roles.map(role => (
            <label key={role.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, cursor: 'pointer', borderRadius: 4, background: selectedRoles.includes(role.id) ? '#e6f7ff' : 'transparent' }}>
              <input
                type="checkbox"
                checked={selectedRoles.includes(role.id)}
                onChange={(e) => {
                  if (e.target.checked) setSelectedRoles([...selectedRoles, role.id]);
                  else setSelectedRoles(selectedRoles.filter(id => id !== role.id));
                }}
              />
              <span>{role.name}</span>
              <Tag>{role.type === 'SYSTEM' ? '系统' : '自定义'}</Tag>
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
};

export default UserPage;
