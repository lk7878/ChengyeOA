import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Spin, Alert, List, Tag } from 'antd';
import {
  UserOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  DollarOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { dashboardApi } from '@/api/business';
import type { DashboardMetrics, DashboardAlerts } from '@/types';

const Dashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [alerts, setAlerts] = useState<DashboardAlerts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [metricsRes, alertsRes]: any = await Promise.all([
        dashboardApi.metrics(),
        dashboardApi.alerts(),
      ]);
      if (metricsRes.code === 200) setMetrics(metricsRes.data);
      if (alertsRes.code === 200) setAlerts(alertsRes.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: '线索总数',
      value: metrics?.overview.leadCount || 0,
      icon: <FileSearchOutlined style={{ color: '#1890ff', fontSize: 24 }} />,
      color: '#e6f7ff',
    },
    {
      title: '客户总数',
      value: metrics?.overview.customerCount || 0,
      icon: <UserOutlined style={{ color: '#52c41a', fontSize: 24 }} />,
      color: '#f6ffed',
    },
    {
      title: '合同总数',
      value: metrics?.overview.contractCount || 0,
      icon: <FileTextOutlined style={{ color: '#faad14', fontSize: 24 }} />,
      color: '#fffbe6',
    },
    {
      title: '案件总数',
      value: metrics?.overview.caseCount || 0,
      icon: <FileTextOutlined style={{ color: '#eb2f96', fontSize: 24 }} />,
      color: '#fff0f6',
    },
    {
      title: '累计收款',
      value: metrics?.overview.totalRevenue || 0,
      prefix: '¥',
      icon: <DollarOutlined style={{ color: '#13c2c2', fontSize: 24 }} />,
      color: '#e6fffb',
    },
    {
      title: '正式员工',
      value: metrics?.overview.employeeCount || 0,
      icon: <TeamOutlined style={{ color: '#722ed1', fontSize: 24 }} />,
      color: '#f9f0ff',
    },
  ];

  return (
    <Spin spinning={loading}>
      <div>
        {/* 核心指标 */}
        <Row gutter={[16, 16]}>
          {statCards.map((card, index) => (
            <Col xs={24} sm={12} lg={8} xl={4} key={index}>
              <Card
                bodyStyle={{ padding: 20 }}
                style={{ background: card.color, borderRadius: 8 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#666', fontSize: 14, marginBottom: 8 }}>{card.title}</div>
                    <Statistic
                      value={card.value}
                      prefix={card.prefix}
                      valueStyle={{ fontSize: 28, fontWeight: 'bold' }}
                    />
                  </div>
                  {card.icon}
                </div>
              </Card>
            </Col>
          ))}
        </Row>

        {/* 本月新增 */}
        {metrics?.monthly && (
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={24}>
              <Card title="本月新增">
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic title="新增线索" value={metrics.monthly.newLeads} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="新签合同" value={metrics.monthly.newContracts} />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="本月收款"
                      value={metrics.monthly.monthRevenue}
                      prefix="¥"
                    />
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>
        )}

        {/* 预警信息 */}
        {alerts && (
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={12}>
              <Card title="预警概览" extra={<WarningOutlined style={{ color: '#ff4d4f' }} />}>
                <Row gutter={[16, 16]}>
                  <Col span={12}>
                    <Alert
                      message="逾期任务"
                      description={`${alerts.overdueTasks} 个`}
                      type="warning"
                      showIcon
                    />
                  </Col>
                  <Col span={12}>
                    <Alert
                      message="逾期收款"
                      description={`${alerts.overduePayments?.length || 0} 笔`}
                      type="error"
                      showIcon
                    />
                  </Col>
                  <Col span={12}>
                    <Alert
                      message="未分配线索"
                      description={`${alerts.unassignedLeads} 个`}
                      type="info"
                      showIcon
                    />
                  </Col>
                  <Col span={12}>
                    <Alert
                      message="紧急案件"
                      description={`${alerts.urgentCases?.length || 0} 个`}
                      type="warning"
                      showIcon
                    />
                  </Col>
                </Row>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="紧急案件列表">
                <List
                  size="small"
                  dataSource={alerts.urgentCases || []}
                  renderItem={(item: any) => (
                    <List.Item>
                      <Tag color="red">紧急</Tag>
                      {item.title} - {item.customer?.name}
                    </List.Item>
                  )}
                  locale={{ emptyText: '暂无紧急案件' }}
                />
              </Card>
            </Col>
          </Row>
        )}
      </div>
    </Spin>
  );
};

export default Dashboard;
