import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Tag, Space, Modal, Form, message,
  Card, Row, Col, Select, Statistic
} from 'antd';
import {
  PlusOutlined, EditOutlined, SyncOutlined,
  CheckCircleOutlined, BarChartOutlined
} from '@ant-design/icons';
import { performanceApi, employeeApi } from '@/api/organization';
import type { Performance, Employee } from '@/types';

const typeMap: Record<string, string> = {
  MONTHLY: '月度绩效',
  QUARTERLY: '季度绩效',
  ANNUAL: '年度绩效',
  PROJECT: '项目绩效',
};

const statusMap: Record<string, { text: string; color: string }> = {
  DRAFT: { text: '草稿', color: 'default' },
  PENDING: { text: '待确认', color: 'orange' },
  CONFIRMED: { text: '已确认', color: 'green' },
};

const PerformancePage: React.FC = () => {
  const [data, setData] = useState<Performance[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [modalVisible, setModalVisible] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stats, setStats] = useState({ total: 0, confirmed: 0, pending: 0, avgScore: 0 });
  const [form] = Form.useForm();

  useEffect(() => { fetchData(); fetchEmployees(); }, [pagination.current, pagination.pageSize, typeFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = { page: pagination.current, pageSize: pagination.pageSize };
      if (typeFilter) params.type = typeFilter;
      if (searchKeyword) params.keyword = searchKeyword;
      const res: any = await performanceApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
        // 计算统计
        const list = res.data.list;
        const confirmed = list.filter((p: Performance) => p.status === 'CONFIRMED').length;
        const pending = list.filter((p: Performance) => p.status === 'PENDING').length;
        const scores = list.filter((p: Performance) => p.score != null).map((p: Performance) => p.score || 0);
        const avgScore = scores.length > 0 ? (scores.reduce((a: number, b: number) => a + b, 0) / scores.length).toFixed(1) : 0;
        setStats({ total: list.length, confirmed, pending, avgScore: Number(avgScore) });
      }
    } finally { setLoading(false); }
  };

  const fetchEmployees = async () => {
    try {
      const res: any = await employeeApi.list({ pageSize: 100 });
      if (res.code === 200) setEmployees(res.data.list);
    } catch (e) {}
  };

  const handleConfirm = async (id: string) => {
    try {
      await performanceApi.confirm(id);
      message.success('绩效确认成功');
      fetchData();
    } catch (e) {}
  };

  const columns = [
    {
      title: '员工',
      dataIndex: 'employee',
      key: 'employee',
      render: (e: Employee) => e?.name || '-',
    },
    {
      title: '部门',
      dataIndex: 'employee',
      key: 'org',
      render: (e: Employee) => e?.organization?.name || '-',
    },
    { title: '考核周期', dataIndex: 'period', key: 'period' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => typeMap[t] || t },
    {
      title: '评分',
      dataIndex: 'score',
      key: 'score',
      render: (v: number) => v != null ? <Tag color={v >= 90 ? 'green' : v >= 60 ? 'blue' : 'red'}>{v}分</Tag> : '-',
    },
    {
      title: '奖金',
      dataIndex: 'bonus',
      key: 'bonus',
      render: (v: number) => v != null ? `¥${v.toLocaleString()}` : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const config = statusMap[s] || { text: s, color: 'default' };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: Performance) => (
        <Space size="small">
          {record.status !== 'CONFIRMED' && (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => handleConfirm(record.id)}>确认</Button>
          )}
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue(record); setModalVisible(true); }}>编辑</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="绩效总数" value={stats.total} prefix={<BarChartOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已确认" value={stats.confirmed} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="待确认" value={stats.pending} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="平均评分" value={stats.avgScore} suffix="分" valueStyle={{ color: '#1890ff' }} />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <Space>
              <Input placeholder="搜索员工姓名/周期" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} onPressEnter={fetchData} style={{ width: 200 }} />
              <Select placeholder="类型筛选" allowClear style={{ width: 120 }} value={typeFilter} onChange={(v) => setTypeFilter(v)}>
                <Select.Option value="MONTHLY">月度绩效</Select.Option>
                <Select.Option value="QUARTERLY">季度绩效</Select.Option>
                <Select.Option value="ANNUAL">年度绩效</Select.Option>
                <Select.Option value="PROJECT">项目绩效</Select.Option>
              </Select>
              <Button type="primary" icon={<SyncOutlined />} onClick={fetchData}>搜索</Button>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalVisible(true); }}>新建绩效</Button>
          </Col>
        </Row>
      </Card>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
        pagination={{ ...pagination, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => setPagination({ ...pagination, current: p, pageSize: ps || 10 }) }} />

      {/* 新建/编辑 */}
      <Modal title="绩效信息" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} onFinish={async (v) => {
          if (v.id) {
            // 更新需要自定义逻辑，这里简化处理
            message.success('更新功能需后端支持');
          } else {
            await performanceApi.create(v);
            message.success('创建成功');
          }
          setModalVisible(false);
          fetchData();
        }}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="employeeId" label="员工" rules={[{ required: true }]}>
            <Select placeholder="请选择员工">
              {employees.map(emp => (
                <Select.Option key={emp.id} value={emp.id}>{emp.name} - {emp.organization?.name || '无部门'}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="period" label="考核周期" rules={[{ required: true }]}><Input placeholder="如：2026-04" /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]} initialValue="MONTHLY">
            <Select>
              <Select.Option value="MONTHLY">月度绩效</Select.Option>
              <Select.Option value="QUARTERLY">季度绩效</Select.Option>
              <Select.Option value="ANNUAL">年度绩效</Select.Option>
              <Select.Option value="PROJECT">项目绩效</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="kpiData" label="KPI数据"><Input.TextArea rows={3} placeholder="JSON格式KPI数据" /></Form.Item>
          <Form.Item name="score" label="评分"><Input type="number" min={0} max={100} /></Form.Item>
          <Form.Item name="bonus" label="奖金"><Input type="number" min={0} /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PerformancePage;
