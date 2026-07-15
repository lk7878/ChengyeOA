import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Tag, Space, Modal, Form, message,
  Popconfirm, Card, Row, Col
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SyncOutlined,
  SafetyOutlined
} from '@ant-design/icons';
import { roleApi, permissionApi } from '@/api/user';
import type { Role, Permission } from '@/types';

const RolePage: React.FC = () => {
  const [data, setData] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [permModal, setPermModal] = useState(false);
  const [currentRole, setCurrentRole] = useState<Role | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [form] = Form.useForm();

  useEffect(() => { fetchData(); fetchPermissions(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await roleApi.list();
      if (res.code === 200) {
        // 后端返回的是分页数据
        const list = res.data.list || res.data;
        setData(list);
      }
    } finally { setLoading(false); }
  };

  async function fetchPermissions() {
    try {
      const res = await permissionApi.tree();
      if (res.code === 200) setPermissions(res.data);
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const handleDelete = async (id: string) => {
    try { await roleApi.delete(id); message.success('删除成功'); fetchData(); } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const handleAssignPerms = (role: Role) => {
    setCurrentRole(role);
    const currentPermIds = role.permissions?.map(rp => rp.permissionId) || [];
    setSelectedPerms(currentPermIds);
    setPermModal(true);
  };

  const handlePermSubmit = async () => {
    if (!currentRole) return;
    try {
      await roleApi.assignPermissions(currentRole.id, selectedPerms);
      message.success('权限分配成功');
      setPermModal(false);
      fetchData();
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const renderPermTree = (perms: Permission[], level = 0) => {
    return perms.map(perm => (
      <div key={perm.id} style={{ marginLeft: level * 20, padding: '4px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={selectedPerms.includes(perm.id)}
            onChange={(e) => {
              if (e.target.checked) setSelectedPerms([...selectedPerms, perm.id]);
              else setSelectedPerms(selectedPerms.filter(id => id !== perm.id));
            }}
          />
          <span>{perm.name}</span>
          <Tag color={perm.type === 'MENU' ? 'blue' : perm.type === 'BUTTON' ? 'green' : 'orange'}>{perm.type}</Tag>
          <code style={{ fontSize: 12, color: '#999' }}>{perm.code}</code>
        </label>
        {perm.children && renderPermTree(perm.children, level + 1)}
      </div>
    ));
  };

  const columns = [
    { title: '角色名称', dataIndex: 'name', key: 'name' },
    { title: '角色代码', dataIndex: 'code', key: 'code' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => <Tag color={t === 'SYSTEM' ? 'red' : 'blue'}>{t === 'SYSTEM' ? '系统' : '自定义'}</Tag> },
    { title: '描述', dataIndex: 'description', key: 'description', render: (d: string) => d || '-' },
    { title: '权限数', dataIndex: 'permissions', key: 'permCount', render: (permissions: unknown[]) => permissions?.length || 0 },
    {
      title: '操作',
      key: 'action',
      width: 250,
      render: (_: unknown, record: Role) => (
        <Space size="small">
          <Button type="link" size="small" icon={<SafetyOutlined />} onClick={() => handleAssignPerms(record)}>分配权限</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditingRole(record); form.setFieldsValue(record); setModalVisible(true); }}>编辑</Button>
          {record.type !== 'SYSTEM' && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
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
            <Button icon={<SyncOutlined />} onClick={fetchData}>刷新</Button>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingRole(null); form.resetFields(); setModalVisible(true); }}>新建角色</Button>
          </Col>
        </Row>
      </Card>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} pagination={false} />

      {/* 新建/编辑 */}
      <Modal title="角色信息" open={modalVisible} onCancel={() => { setEditingRole(null); setModalVisible(false); }} onOk={() => form.submit()}>
        <Form form={form} onFinish={async (v) => {
          if (v.id) { await roleApi.update(v.id, v); message.success('更新成功'); }
          else { await roleApi.create(v); message.success('创建成功'); }
          setEditingRole(null); setModalVisible(false); fetchData();
        }}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="name" label="角色名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item
            name="code"
            label="角色代码"
            normalize={(value: string) => value.toUpperCase()}
            rules={[
              { required: true },
              { pattern: /^[A-Z][A-Z0-9_]{2,63}$/, message: '请输入 3-64 位大写字母、数字或下划线代码' },
            ]}
          >
            <Input disabled={editingRole !== null} maxLength={64} />
          </Form.Item>
          <Form.Item name="type" initialValue="BUSINESS" hidden><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      {/* 分配权限 */}
      <Modal title={`分配权限 - ${currentRole?.name}`} open={permModal} onCancel={() => setPermModal(false)} onOk={handlePermSubmit} width={600}>
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          {renderPermTree(permissions)}
        </div>
      </Modal>
    </div>
  );
};

export default RolePage;
