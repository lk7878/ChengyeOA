import Table from '@/components/ResizableTable';
import React, { useState, useEffect, useEffectEvent } from 'react';
import { Button, Input, Tag, Space, Form, message,
  Select, Card, Row, Col
} from 'antd';
import Modal from '@/components/DraggableModal';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  SyncOutlined, SafetyOutlined, KeyOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { userApi } from '@/api/user';
import type { User } from '@/types';
import dayjs from 'dayjs';
import EmployeeTreeSelect, { type SelectedEmployee } from '@/features/master-data/components/EmployeeTreeSelect';
import { masterDataApi } from '@/features/master-data/api';
import { useAuthStore } from '@/stores/authStore';

const UserPage: React.FC = () => {
  const [data, setData] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const navigate = useNavigate();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<SelectedEmployee | null>(null);
  const [form] = Form.useForm();
  const canResetPassword = useAuthStore(state => state.hasPermission('user.password.reset'));
  const selfUserId = useAuthStore(state => state.authorization?.userId);
  const canAssignRoles = useAuthStore(state => Boolean(state.authorization?.isSystemSuperAdmin || state.hasPermission('user_role.membership.manage')));
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetSaving, setResetSaving] = useState(false);
  const [resetForm] = Form.useForm();
  const isSuperAdmin = useAuthStore(state => Boolean(state.authorization?.isSystemSuperAdmin));
  const canDelete = useAuthStore(state => state.hasPermission('user.status.manage'));
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [recipientUserId, setRecipientUserId] = useState<string>();
  const [recipients, setRecipients] = useState<Array<{ value: string; label: string }>>([]);

  async function searchRecipients(keyword = '') {
    try {
      const response = await userApi.list({ status: 'ENABLED', keyword, pageSize: 100 });
      setRecipients(response.data.list.filter(user => user.employee && user.employee.status !== 'LEAVED').map(user => ({ value: user.id, label: `${user.employee?.name} · ${user.username}` })));
    } catch { /* Shared interceptor reports request errors. */ }
  }

  const { current: currentPage, pageSize } = pagination;
  const onPageChange = useEffectEvent(() => { void fetchData(); });
  useEffect(() => { onPageChange(); }, [currentPage, pageSize]);

  async function fetchData() {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean | undefined> = { page: pagination.current, pageSize: pagination.pageSize };
      if (searchKeyword) params.keyword = searchKeyword;
      const res = await userApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
      }
    } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await userApi.delete(deleteTarget.id, { recipientUserId }); message.success('账号已删除，历史记录保留'); setDeleteTarget(null); await fetchData(); } catch { /* Request errors are handled by the shared interceptor. */ }
    finally { setDeleting(false); }
  };

  const handleAssignRoles = (user: User) => navigate('/security/users?userId='+encodeURIComponent(user.id));

  const handleSubmit = async (v: Record<string, unknown>) => {
    const username = String(v.username ?? '').trim();
    const password = typeof v.password === 'string' ? v.password : undefined;
    const status = v.status === 'DISABLED' ? 'DISABLED' : 'ENABLED';
    if (editingUser) {
      await userApi.update(editingUser.id, { username, status });
      message.success('更新成功');
    } else {
      const created = await userApi.create({ username, password, status });
      if (selectedEmployee) {
        try {
          await masterDataApi.employees.bindAccount(selectedEmployee.id, { userId: created.data.id, employeeVersion: selectedEmployee.version });
          message.success('创建成功，员工已关联');
        } catch {
          message.warning('账号已创建，但员工关联失败，请前往员工详情重新绑定');
        }
      } else {
        message.success('创建成功');
      }
    }
    setModalVisible(false);
    setEditingUser(null);
    setSelectedEmployee(null);
    fetchData();
  };


  const handleResetPassword = async (values: { password: string; confirmation: string }) => {
    if (!resetTarget) return;
    setResetSaving(true);
    try {
      await userApi.resetPassword(resetTarget.id, values);
      message.success('密码已重置，该账号下次登录需修改密码');
      setResetTarget(null);
      resetForm.resetFields();
      fetchData();
    } catch { /* Request errors are handled by the shared interceptor. */ }
    finally { setResetSaving(false); }
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '姓名', dataIndex: 'employee', key: 'employee', render: (e: User['employee']) => e?.name || '-' },
    { title: '部门', dataIndex: 'employee', key: 'org', render: (e: User['employee']) => e?.organization?.name || '-' },
    {
      title: '角色',
      dataIndex: 'userRoles',
      key: 'roles',
      render: (userRoles: User['userRoles']) => userRoles?.map(userRole => <Tag key={userRole.roleId} color="blue">{userRole.role?.name}</Tag>) || '-',
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
      render: (_: unknown, record: User) => (
        <Space size="small">
          <Button type="link" size="small" disabled={!canAssignRoles || record.id === selfUserId} icon={<SafetyOutlined />} onClick={() => handleAssignRoles(record)}>分配角色</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditingUser(record); form.setFieldsValue({ id: record.id, username: record.username, status: record.status }); setModalVisible(true); }}>编辑</Button>
          {canResetPassword && record.id !== selfUserId && <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => { resetForm.resetFields(); setResetTarget(record); }}>重置密码</Button>}
          {(canDelete || isSuperAdmin) && <Button type="link" danger size="small" icon={<DeleteOutlined />} disabled={record.status !== 'DISABLED' || record.id === selfUserId || record.username === 'admin' || (!isSuperAdmin && record.userRoles?.some(grant => grant.role?.type === 'SYSTEM'))} title="请先禁用账号；总所 admin 不可删除，其他管理员由超级管理员删除" onClick={() => { setRecipientUserId(undefined); setDeleteTarget(record); if (isSuperAdmin) void searchRecipients(); }}>删除</Button>}
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
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingUser(null); setSelectedEmployee(null); form.resetFields(); setModalVisible(true); }}>新建用户</Button>
          </Col>
        </Row>
      </Card>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
        pagination={{ ...pagination, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => setPagination({ ...pagination, current: p, pageSize: ps || 10 }) }} />

      {/* 新建/编辑 */}
      <Modal title={`删除账号 · ${deleteTarget?.username ?? ''}`} open={Boolean(deleteTarget)} onCancel={() => setDeleteTarget(null)} onOk={() => void handleDelete()} confirmLoading={deleting} okText="确认删除" okButtonProps={{ danger: true }}>
        <p>账号将从列表移除并退出所有登录会话，历史业务和审计记录保留。有本人拥有的材料时，须先指定接收人完成转交。</p>
        {isSuperAdmin ? <Form layout="vertical"><Form.Item label="资源接收人" extra="有资源时必选，包含未分享的个人文档。无资源可留空。"><Select aria-label="资源接收人" allowClear showSearch filterOption={false} value={recipientUserId} options={recipients} onSearch={keyword => void searchRecipients(keyword)} onChange={setRecipientUserId} /></Form.Item></Form> : <p>如账号拥有材料，请由超级管理员完成资源转交后再删除。</p>}
      </Modal>
      <Modal title="用户信息" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} onFinish={handleSubmit}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input /></Form.Item>
          {!editingUser && (
            <Form.Item name="password" label="密码" rules={[{ required: true }]}><Input.Password />
            </Form.Item>
          )}
          <Form.Item name="status" label="状态" initialValue="ENABLED">
            <select style={{ width: '100%', height: 32, borderRadius: 6, border: '1px solid #d9d9d9' }}>
              <option value="ENABLED">启用</option>
              <option value="DISABLED">禁用</option>
            </select>
          </Form.Item>
          {editingUser ? (
            <Form.Item label="关联员工" extra="关联或更换员工请在「组织与人员」的对应员工详情中操作。">
              <Input value={editingUser.employee ? `${editingUser.employee.employeeNo} · ${editingUser.employee.name}` : '未关联员工'} disabled />
            </Form.Item>
          ) : (
            <Form.Item label="关联员工" extra="创建账号后可关联一名在职员工，按组织-部门-员工逐级选择。">
              <EmployeeTreeSelect value={selectedEmployee?.id} onChange={setSelectedEmployee} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 分配角色 */}


      {/* 重置密码 */}
      <Modal title={`重置密码 · ${resetTarget?.username ?? ''}`} open={Boolean(resetTarget)} onCancel={() => setResetTarget(null)} onOk={() => resetForm.submit()} confirmLoading={resetSaving} destroyOnHidden>
        <Form form={resetForm} layout="vertical" onFinish={values => void handleResetPassword(values)}>
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6, max: 128 }]} extra="至少 6 位，最长 128 位。">
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="confirmation" label="确认新密码" dependencies={['password']} rules={[
            { required: true },
            ({ getFieldValue }) => ({ validator: (_, value) => value === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致')) }),
          ]}><Input.Password autoComplete="new-password" /></Form.Item>
          <p style={{ color: '#888', marginTop: -4 }}>重置后该账号所有会话将失效，下次登录须先修改密码。</p>
        </Form>
      </Modal>
    </div>
  );
};

export default UserPage;
