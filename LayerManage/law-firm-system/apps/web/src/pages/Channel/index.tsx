import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Tag, Space, Modal, Form, message,
  Popconfirm, Card, Row, Col
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  SyncOutlined
} from '@ant-design/icons';
import { channelApi } from '@/api/organization';
import type { Channel } from '@/types';

const typeMap: Record<string, string> = {
  SEARCH: '搜索引擎',
  SHORT_VIDEO: '短视频',
  LIVE: '直播',
  INFO_FLOW: '信息流',
  WECHAT: '微信',
  REFERRAL: '转介绍',
  NATURAL: '自然流量',
  OFFLINE: '线下',
  OTHER: '其他',
};

const ChannelPage: React.FC = () => {
  const [data, setData] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await channelApi.list();
      if (res.code === 200) {
        // 后端返回的是分页数据
        const list = res.data.list || res.data;
        setData(list);
      }
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try { await channelApi.delete(id); message.success('删除成功'); fetchData(); } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const columns = [
    { title: '渠道名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => typeMap[t] || t },
    { title: '账号信息', dataIndex: 'accountInfo', key: 'accountInfo', render: (v: string) => v || '-' },
    { title: '投放成本', dataIndex: 'cost', key: 'cost', render: (v: number) => `¥${v?.toLocaleString()}` },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={s === 'ENABLED' ? 'green' : 'red'}>{s === 'ENABLED' ? '启用' : '禁用'}</Tag> },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Channel) => (
        <Space size="small">
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
            <Button icon={<SyncOutlined />} onClick={fetchData}>刷新</Button>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalVisible(true); }}>新建渠道</Button>
          </Col>
        </Row>
      </Card>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} pagination={false} />

      <Modal title="渠道信息" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} onFinish={async (v) => {
          if (v.id) { await channelApi.update(v.id, v); message.success('更新成功'); }
          else { await channelApi.create(v); message.success('创建成功'); }
          setModalVisible(false); fetchData();
        }}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <select style={{ width: '100%', height: 32, borderRadius: 6, border: '1px solid #d9d9d9' }}>
              {Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Form.Item>
          <Form.Item name="accountInfo" label="账号信息"><Input /></Form.Item>
          <Form.Item name="cost" label="投放成本" initialValue={0}><Input type="number" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ChannelPage;
