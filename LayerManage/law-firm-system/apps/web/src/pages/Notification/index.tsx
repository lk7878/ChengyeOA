import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Space, Tabs, Tag, message } from 'antd';
import { Link } from 'react-router';
import Table from '@/components/ResizableTable';
import { notificationApi } from '@/api/organization';
import { requestErrorMessage } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { notificationTarget } from './notification-target';
import type { Notification } from '@/types';

export default function NotificationPage() {
  const authorization = useAuthStore((s) => s.authorization),
    userId = useAuthStore((s) => s.userInfo?.id);
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [tab, setTab] = useState('all');
  const [data, setData] = useState<{
      userId: string | undefined;
      rows: Notification[];
      total: number;
      unread: number;
    }>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [mutating, setMutating] = useState(false);
  const alive = useRef(true),
    sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const [rows, count] = await Promise.all([
        notificationApi.list({
          page,
          pageSize,
          ...(tab === 'all' ? {} : { isRead: tab === 'read' ? 'true' : 'false' }),
        }),
        notificationApi.unreadCount(),
      ]);
      if (alive.current && sequence.current === seq) {
        setData({
          userId,
          rows: rows.data.list,
          total: rows.data.pagination.total,
          unread: count.data.count,
        });
        setError('');
      }
    } catch (e) {
      if (alive.current && sequence.current === seq) {
        setData(undefined);
        setError(requestErrorMessage(e));
      }
    } finally {
      if (alive.current && sequence.current === seq) setLoading(false);
    }
  }, [page, pageSize, tab, userId]);
  useEffect(() => {
    alive.current = true;
    const counter = sequence;
    void Promise.resolve().then(() => {
      if (alive.current) void refresh();
    });
    const timer = window.setInterval(() => void refresh(), 5000),
      focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      alive.current = false;
      counter.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  const visible = data?.userId === userId ? data : undefined;
  const read = async (id?: string) => {
    if (mutating) return;
    setMutating(true);
    try {
      if (id) await notificationApi.read(id);
      else await notificationApi.readAll();
      if (alive.current) {
        message.success('已标记为已读');
        await refresh();
      }
    } catch (e) {
      if (alive.current) setError(requestErrorMessage(e));
    } finally {
      if (alive.current) setMutating(false);
    }
  };
  return (
    <div className="unified-area-page">
      <div className="unified-area-heading">
        <h1>通知</h1>
        <Space wrap>
          <Button onClick={() => void refresh()}>刷新通知</Button>
          <Button onClick={() => void read()} disabled={mutating || !visible?.unread}>
            全部标为已读
          </Button>
        </Space>
      </div>
      {error && (
        <Alert type="error" title={error} action={<Button onClick={() => void refresh()}>重试</Button>} />
      )}
      <Tabs
        activeKey={tab}
        onChange={(value) => {
          setTab(value);
          setPage(1);
        }}
        items={[
          { key: 'all', label: '全部通知' },
          {
            key: 'unread',
            label: (
              <Space>
                未读通知
                <Badge count={visible?.unread || 0} />
              </Space>
            ),
          },
          { key: 'read', label: '已读通知' },
        ]}
      />
      <Table<Notification>
        rowKey="id"
        dataSource={visible?.rows || []}
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{
          current: page,
          pageSize,
          total: visible?.total || 0,
          showSizeChanger: true,
          onChange: (p, size) => {
            setPage(p);
            setPageSize(size);
          },
        }}
        columns={[
          { title: '通知', dataIndex: 'title', width: 220 },
          { title: '内容', dataIndex: 'content', width: 300 },
          {
            title: '状态',
            dataIndex: 'isRead',
            width: 90,
            render: (read: boolean) => <Tag color={read ? 'default' : 'blue'}>{read ? '已读' : '未读'}</Tag>,
          },
          {
            title: '时间',
            dataIndex: 'createdAt',
            width: 170,
            render: (date: string) => new Date(date).toLocaleString('zh-CN'),
          },
          {
            title: '操作',
            width: 200,
            render: (_: unknown, row: Notification) => {
              const to = notificationTarget(row, authorization);
              return (
                <Space wrap>
                  {to && <Link to={to}>打开关联记录</Link>}
                  {!row.isRead && (
                    <Button type="link" disabled={mutating} onClick={() => void read(row.id)}>
                      标为已读
                    </Button>
                  )}
                </Space>
              );
            },
          },
        ]}
      />
    </div>
  );
}
