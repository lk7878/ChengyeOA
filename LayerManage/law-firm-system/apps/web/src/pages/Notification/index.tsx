import React, { useState, useEffect } from 'react';
import {
  Table, Button, Tag, Space,
  Card, Row, Col, Badge, Tabs, message
} from 'antd';
import {
  SyncOutlined, CheckOutlined, BellOutlined,
  InfoCircleOutlined, WarningOutlined, CheckCircleOutlined
} from '@ant-design/icons';
import { notificationApi } from '@/api/organization';
import type { Notification } from '@/types';
import dayjs from 'dayjs';

const typeMap: Record<string, { text: string; color: string; icon: React.ElementType }> = {
  SYSTEM: { text: '系统', color: 'blue', icon: InfoCircleOutlined },
  APPROVAL: { text: '审批', color: 'orange', icon: WarningOutlined },
  TASK: { text: '任务', color: 'purple', icon: CheckCircleOutlined },
  MESSAGE: { text: '消息', color: 'green', icon: BellOutlined },
};

const NotificationPage: React.FC = () => {
  const [data, setData] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [activeTab, setActiveTab] = useState('all');
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => { fetchData(); fetchUnreadCount(); }, [pagination.current, pagination.pageSize, activeTab]);

  async function fetchData() {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean | undefined> = { page: pagination.current, pageSize: pagination.pageSize };
      if (activeTab === 'unread') params.isRead = 'false';
      if (activeTab === 'read') params.isRead = 'true';
      const res = await notificationApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
      }
    } finally { setLoading(false); }
  };

  async function fetchUnreadCount() {
    try {
      const res = await notificationApi.unreadCount();
      if (res.code === 200) setUnreadCount(res.data.count);
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const handleRead = async (id: string) => {
    try {
      await notificationApi.read(id);
      message.success('标记为已读');
      fetchData();
      fetchUnreadCount();
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const handleReadAll = async () => {
    try {
      await notificationApi.readAll();
      message.success('全部标记为已读');
      fetchData();
      fetchUnreadCount();
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (t: string) => {
        const config = typeMap[t] || { text: t, color: 'default', icon: BellOutlined };
        const Icon = config.icon;
        return <Tag color={config.color} icon={<Icon />}>{config.text}</Tag>;
      },
    },
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '内容', dataIndex: 'content', key: 'content', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'isRead',
      key: 'isRead',
      width: 100,
      render: (isRead: boolean) => (
        <Badge status={isRead ? 'default' : 'processing'} text={isRead ? '已读' : '未读'} />
      ),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (d: string) => dayjs(d).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: Notification) => (
        <Space size="small">
          {!record.isRead && (
            <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleRead(record.id)}>标为已读</Button>
          )}
        </Space>
      ),
    },
  ];

  const tabItems = [
    { key: 'all', label: '全部通知' },
    { key: 'unread', label: (<span>未读通知 <Badge count={unreadCount} size="small" /></span>) },
    { key: 'read', label: '已读通知' },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle" justify="space-between">
          <Col>
            <Button icon={<SyncOutlined />} onClick={fetchData}>刷新</Button>
          </Col>
          <Col>
            <Button type="primary" icon={<CheckOutlined />} onClick={handleReadAll}>全部标为已读</Button>
          </Col>
        </Row>
      </Card>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{
          ...pagination,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => setPagination({ ...pagination, current: p, pageSize: ps || 10 })
        }}
      />
    </div>
  );
};

export default NotificationPage;
