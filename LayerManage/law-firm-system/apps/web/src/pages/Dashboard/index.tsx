import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Spin, Tag } from 'antd';
import { Link } from 'react-router';
import { dashboardApi } from '@/api/business';
import { requestErrorMessage } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { canOpen, findEntry } from '@/features/navigation/catalog';
import type { DashboardMetrics, DashboardAlerts } from '@/types';
export default function DashboardPage() {
  const authorization = useAuthStore((s) => s.authorization);
  const [data, setData] = useState<{ metrics: DashboardMetrics; alerts: DashboardAlerts }>();
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const sequence = useRef(0),
    alive = useRef(true);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const [metrics, alerts] = await Promise.all([dashboardApi.metrics(), dashboardApi.alerts()]);
      if (alive.current && sequence.current === seq) {
        setData({ metrics: metrics.data, alerts: alerts.data });
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
  }, []);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => {
      if (alive.current) void refresh();
    });
    const timer = window.setInterval(() => void refresh(), 5000),
      focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  const allowed = (path: string) => {
    const entry = findEntry(path);
    return !!entry && canOpen(entry, authorization);
  };
  const m = data?.metrics,
    a = data?.alerts;
  const cards = [
    { title: '线索数量', value: m?.overview.leadCount, path: '/leads' },
    { title: '客户数量', value: m?.overview.customerCount, path: '/customers' },
    { title: '合同数量', value: m?.overview.contractCount, path: '/contracts' },
    { title: '案件数量', value: m?.overview.caseCount, path: '/cases' },
    { title: '累计确认收款', value: m?.overview.totalRevenue, path: '/payments', money: true },
    { title: '正式员工', value: m?.overview.employeeCount, path: '/org/employees' },
  ];
  const metrics = (value: number | string | null | undefined, money = false) =>
    value == null ? '不可用' : (money ? '¥ ' : '') + String(value);
  return (
    <div className="unified-area-page">
      <Space wrap style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1>经营概览</h1>
          <p>指标仅汇总当前有权查看的记录，可进入工作表继续处理。</p>
        </div>
        <Button onClick={() => void refresh()}>刷新指标</Button>
      </Space>
      {error && <Alert type="error" title={error} />}
      {loading && <Spin aria-label="正在加载经营指标" />}
      {data && (
        <>
          <Row gutter={[16, 16]}>
            {cards.map((card) => (
              <Col key={card.title} xs={24} sm={12} lg={8}>
                <Card title={card.title}>
                  <strong style={{ fontSize: 24, overflowWrap: 'anywhere' }}>
                    {metrics(card.value, card.money)}
                  </strong>
                  {card.value != null && allowed(card.path) && (
                    <p>
                      <Link to={card.path}>查看{card.title === '正式员工' ? '员工' : '工作表'}</Link>
                    </p>
                  )}
                </Card>
              </Col>
            ))}
          </Row>
          <Card title="本月新增" style={{ marginTop: 20 }}>
            <Row gutter={[16, 16]}>
              {[
                ['新增线索', metrics(m?.monthly.newLeads)],
                ['新增合同', metrics(m?.monthly.newContracts)],
                ['确认收款', metrics(m?.monthly.monthRevenue, true)],
              ].map(([label, value]) => (
                <Col key={label} xs={24} md={8}>
                  <span>{label}</span>
                  <p>
                    <strong>{value}</strong>
                  </p>
                </Col>
              ))}
            </Row>
          </Card>
          <Row gutter={[16, 16]} style={{ marginTop: 4 }}>
            <Col xs={24} md={12}>
              <Card title="待处理事项">
                <p>逾期案件任务：{metrics(a?.overdueTasks)}</p>
                <p>未分配线索：{metrics(a?.unassignedLeads)}</p>
                <Space wrap>
                  {a?.overdueTasks != null && allowed('/cases') && <Link to="/cases">进入案件工作表</Link>}
                  {a?.unassignedLeads != null && allowed('/leads/pool') && (
                    <Link to="/leads/pool">查看公海池</Link>
                  )}
                </Space>
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card title="紧急案件">
                {a?.urgentCases == null ? (
                  <p>不可用</p>
                ) : !a.urgentCases.length ? (
                  <p>暂无可见的紧急案件</p>
                ) : (
                  a.urgentCases.map((row) => (
                    <p key={row.id}>
                      <Tag color="red">紧急</Tag>
                      <Link to={'/cases/' + row.id}>
                        {row.caseNo} · {row.title}
                      </Link>
                    </p>
                  ))
                )}
              </Card>
            </Col>
          </Row>
          <Card title="逾期收款计划（最早到期的前10项）" style={{ marginTop: 20 }}>
            {a?.overduePayments == null ? (
              <p>不可用</p>
            ) : !a.overduePayments.length ? (
              <p>暂无可见的逾期收款计划</p>
            ) : (
              a.overduePayments.map((row) => (
                <p key={row.id}>
                  <Link to={'/contracts/' + row.contractId}>
                    {row.contractNo} · {row.contractTitle}
                  </Link>{' '}
                  · {row.planNo} · 计划金额 {metrics(row.amount, true)} · 到期{' '}
                  {new Date(row.dueDate).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                </p>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}
