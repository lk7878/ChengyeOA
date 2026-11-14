import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Calendar, Card, Empty, Grid, List, Popconfirm, Space, Spin, Tag, message } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import { useNavigate } from 'react-router';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/zh-cn';
import zhCN from 'antd/es/calendar/locale/zh_CN';
import { appointmentApi } from '@/api/appointment';
import type { AppointmentChannel, AppointmentStatus, AppointmentView } from '@/api/types';
import { APPOINTMENT_CHANNEL_META, APPOINTMENT_STATUS_META } from './meta';

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败';
}

const VisitCalendarPage: React.FC = () => {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [panelDate, setPanelDate] = useState<Dayjs>(dayjs());
  const [resetKey, setResetKey] = useState(0);
  const [appointments, setAppointments] = useState<AppointmentView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Dayjs | null>(null);

  const fetchRange = useCallback(async (anchor: Dayjs) => {
    setLoading(true);
    setError(null);
    try {
      const firstDay = anchor.startOf('month').locale('zh-cn').startOf('week');
      const from = firstDay.toISOString();
      const to = firstDay.add(42, 'day').toISOString();
      const res = await appointmentApi.range({ from, to, page: 1, pageSize: 100 });
      setAppointments(res.data.list);
    } catch (err) {
      setError(errorMessage(err));
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 首屏拉取延后到挂载完成后（fetchRange 同步置 loading，react-hooks/set-state-in-effect 禁止 effect 同步窗口内 setState）。
    const timer = window.setTimeout(() => void fetchRange(panelDate), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<string, AppointmentView[]>();
    for (const item of appointments) {
      const key = dayjs(item.scheduledAt).format('YYYY-MM-DD');
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [appointments]);

  const selectedItems = selectedDate ? byDay.get(selectedDate.format('YYYY-MM-DD')) ?? [] : [];

  const handlePanelChange = (date: Dayjs) => {
    setPanelDate(date);
    void fetchRange(date);
  };

  const handleVisit = async (item: AppointmentView) => {
    try {
      await appointmentApi.visit(item.id);
      message.success('已确认到访');
      void fetchRange(panelDate);
    } catch { /* 拦截器已提示。 */ }
  };

  const renderItemMeta = (item: AppointmentView) => {
    const meta = APPOINTMENT_STATUS_META[item.status as AppointmentStatus] ?? { text: item.status, color: 'default' };
    return (
      <Space size="small" wrap>
        <span>{dayjs(item.scheduledAt).format('HH:mm')}</span>
        <Tag>{APPOINTMENT_CHANNEL_META[item.channel as AppointmentChannel] ?? item.channel}</Tag>
        <Tag color={meta.color}>{meta.text}</Tag>
      </Space>
    );
  };

  const appointmentActions = (item: AppointmentView) => {
    const active = item.status === 'PENDING' || item.status === 'CONFIRMED';
    return [
      <Button key="lead" type="link" size="small" onClick={() => navigate(`/leads/${item.leadId}`)}>
        线索详情
      </Button>,
      ...(active ? [
        <Popconfirm
          key="visit"
          title="确认客户已到访？"
          okText="确定"
          cancelText="取消"
          onConfirm={() => void handleVisit(item)}
        >
          <Button type="link" size="small">确认到访</Button>
        </Popconfirm>,
      ] : []),
    ];
  };

  return (
    <div>
      <Card
        title="到访日历"
        extra={(
          <Space><Button onClick={()=>navigate('/calendar')}>协同日历 / 新建日程</Button>
          <Button onClick={() => {
            const now = dayjs();
            setPanelDate(now);
            setResetKey(key => key + 1);
            void fetchRange(now);
          }}>
            回到本月
          </Button>
          </Space>
        )}
        style={{ marginBottom: 16 }}
      >
        {error && (
          <Alert
            role="alert"
            type="error"
            showIcon
            message="邀约日历加载失败"
            description={error}
            style={{ marginBottom: 16 }}
          />
        )}
        <Spin spinning={loading}>
          {isMobile ? (
            <List
              dataSource={[...appointments].sort((a, b) => dayjs(a.scheduledAt).valueOf() - dayjs(b.scheduledAt).valueOf())}
              locale={{ emptyText: <Empty description="本时段暂无邀约" /> }}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              renderItem={item => (
                <List.Item actions={appointmentActions(item)}>
                  <List.Item.Meta
                    title={(
                      <Space size="small" wrap>
                        <span>{dayjs(item.scheduledAt).format('MM-DD HH:mm')}</span>
                        {renderItemMeta(item)}
                      </Space>
                    )}
                    description={item.appointmentNo + (item.remark ? ` · ${item.remark}` : '')}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Calendar
              key={resetKey}
              locale={zhCN}
              defaultValue={panelDate.locale('zh-cn')}
              onPanelChange={handlePanelChange}
              onSelect={(date, { source }) => {
                if (source === 'date') setSelectedDate(date);
              }}
              cellRender={(date, info) => {
                if (info.type !== 'date') return info.originNode;
                const items = byDay.get(date.format('YYYY-MM-DD')) ?? [];
                return (
                  <div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {items.slice(0, 3).map(item => (
                        <Badge
                          key={item.id}
                          status={item.status === 'VISITED' ? 'success' : item.status === 'CANCELLED' || item.status === 'NOSHOW' ? 'default' : 'processing'}
                          text={
                            <span style={{ fontSize: 12 }}>
                              {dayjs(item.scheduledAt).format('HH:mm')} {item.appointmentNo}
                            </span>
                          }
                        />
                      ))}
                      {items.length > 3 && <span style={{ fontSize: 12, color: '#999' }}>+{items.length - 3} 更多</span>}
                    </div>
                  </div>
                );
              }}
            />
          )}
        </Spin>
      </Card>

      <Drawer
        title={selectedDate ? `${selectedDate.format('YYYY-MM-DD')} 邀约（${selectedItems.length}）` : ''}
        open={selectedDate !== null}
        onClose={() => setSelectedDate(null)}
        width={isMobile ? '100%' : 420}
      >
        <List
          dataSource={selectedItems}
          locale={{ emptyText: '当日暂无邀约' }}
          renderItem={item => (
            <List.Item actions={appointmentActions(item)}>
              <List.Item.Meta
                title={renderItemMeta(item)}
                description={item.appointmentNo + (item.remark ? ` · ${item.remark}` : '')}
              />
            </List.Item>
          )}
        />
      </Drawer>
    </div>
  );
};

export default VisitCalendarPage;
