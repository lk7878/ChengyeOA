import React, { useState, useEffect } from 'react';
import {
  Button, Input, Tag, Space, Modal, Form, message,
  Popconfirm, Card, Row, Col, Tree
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SyncOutlined
} from '@ant-design/icons';
import { organizationApi } from '@/api/organization';
import type { Organization } from '@/types';

const typeMap: Record<string, string> = {
  FIRM: '律所总部',
  BRANCH: '分所',
  DEPARTMENT: '部门',
};

const OrganizationPage: React.FC = () => {
  const [data, setData] = useState<Organization[]>([]);
  const [, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await organizationApi.tree();
      if (res.code === 200) setData(res.data);
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try { await organizationApi.delete(id); message.success('删除成功'); fetchData(); } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const treeData = data.map((org) => ({
    title: (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <span><Tag color="blue">{typeMap[org.type]}</Tag> {org.name}</span>
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue(org); setModalVisible(true); }}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(org.id)}>
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      </div>
    ),
    key: org.id,
    children: org.children?.map((child) => ({
      title: (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span><Tag color="green">{typeMap[child.type]}</Tag> {child.name}</span>
          <Space>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue(child); setModalVisible(true); }}>编辑</Button>
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(child.id)}>
              <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </Space>
        </div>
      ),
      key: child.id,
    })),
  }));

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <Button icon={<SyncOutlined />} onClick={fetchData}>刷新</Button>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalVisible(true); }}>新建组织</Button>
          </Col>
        </Row>
      </Card>

      <Card>
        <Tree treeData={treeData} defaultExpandAll blockNode />
      </Card>

      <Modal title="组织信息" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} onFinish={async (v) => {
          if (v.id) { await organizationApi.update(v.id, v); message.success('更新成功'); }
          else { await organizationApi.create(v); message.success('创建成功'); }
          setModalVisible(false); fetchData();
        }}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <select style={{ width: '100%', height: 32, borderRadius: 6, border: '1px solid #d9d9d9' }}>
              {Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Form.Item>
          <Form.Item name="parentId" label="上级组织">
            <select style={{ width: '100%', height: 32, borderRadius: 6, border: '1px solid #d9d9d9' }}>
              <option value="">无</option>
              {data.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Form.Item>
          <Form.Item name="sort" label="排序" initialValue={0}><Input type="number" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default OrganizationPage;
