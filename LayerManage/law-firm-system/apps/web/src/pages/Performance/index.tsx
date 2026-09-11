import Table from '@/components/ResizableTable';
// SPEC-037 Task 3: 绩效列表/详情/录入/确认页（替代遗留原型——其 type/status 枚举漂移
// （ANNUAL/PROJECT/DRAFT vs 后端 YEARLY/PENDING|CONFIRMED）、嵌套 pagination 形态、无权限门控、
// keyword 搜索（后端无该过滤）、无后端 update 的假编辑）。
// 沿 Case 页形态：AntD 6 + useAuthStore 权限门控 + PagedResult 读取（res.data.list/total）。

import PayrollPanel from './PayrollPanel';
import { Tabs } from 'antd';
import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  message,
} from 'antd';
import { CheckCircleOutlined, EyeOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { performanceApi, employeeApi } from '@/api/organization';
import { useAuthStore } from '@/stores/authStore';
import type { Performance, PerformanceBusinessMetrics, Employee } from '@/types';

const TYPE_META: Record<string, string> = {
  MONTHLY: '月度绩效',
  QUARTERLY: '季度绩效',
  YEARLY: '年度绩效',
};

const STATUS_META: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待考核', color: 'orange' },
  SELF_REVIEWED: { text: '已自评', color: 'blue' },
  MANAGER_REVIEWED: { text: '已主管评', color: 'purple' },
  CONFIRMED: { text: '已确认', color: 'green' },
};

const PERFORMANCE_TYPES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

interface CreateFormValues {
  employeeId: string;
  period: string;
  type: string;
  kpiData?: string;
  score?: number;
  bonus?: number;
  remark?: string;
}

const PerformancePage: React.FC = () => {
  const canCreate = useAuthStore(state => state.hasPermission('performance.create'));
  const canUpdate = useAuthStore(state => state.hasPermission('performance.update'));
  const canConfirm = useAuthStore(state => state.hasPermission('performance.confirm'));

  const [data, setData] = useState<Performance[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createForm] = Form.useForm<CreateFormValues>();

  const [detail, setDetail] = useState<Performance | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  // SPEC-043：考核流程——目标设定/自评（performance.update）、主管评（performance.confirm）。
  const [reviewModal, setReviewModal] = useState<null | 'goal' | 'self' | 'manager'>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewForm] = Form.useForm<{ goal?: string; score?: number; comment?: string }>();

  const fetchList = async (nextPage = page, nextSize = pageSize) => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = { page: nextPage, pageSize: nextSize };
      if (typeFilter) params.type = typeFilter;
      const res = await performanceApi.list(params);
      setData(res.data.list);
      setTotal(res.data.total);
      setPage(res.data.page);
      setPageSize(res.data.pageSize);
    } catch {
      // 共享拦截器已提示错误。
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 首屏加载推迟到微任务：避免 effect 体内同步 setState（react-hooks/set-state-in-effect 纪律）。
    void Promise.resolve().then(() => {
      void fetchList(1, pageSize);
      employeeApi.list({ pageSize: 100 })
        .then(res => setEmployees(res.data.list ?? []))
        .catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReset = () => { setTypeFilter(undefined); void fetchList(1, pageSize); };

  const openDetail = async (record: Performance) => {
    setDetail(null);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await performanceApi.detail(record.id);
      setDetail(res.data);
    } catch {
      // 共享拦截器已提示错误。
    } finally {
      setDetailLoading(false);
    }
    void fetchMetrics(record.id);
  };

  // SPEC-044：业务指标（该员工考核周期案件办结数/回款额）——纯读聚合。
  const [metrics, setMetrics] = useState<PerformanceBusinessMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  const fetchMetrics = async (performanceId: string) => {
    setMetricsLoading(true);
    try {
      const res = await performanceApi.metrics(performanceId);
      setMetrics(res.data);
    } catch {
      // 共享拦截器已提示错误。
    } finally {
      setMetricsLoading(false);
    }
  };

  const openCreate = () => {
    createForm.resetFields();
    setCreateOpen(true);
  };

  const handleCreate = async (values: CreateFormValues) => {
    setCreateSubmitting(true);
    try {
      await performanceApi.create({
        employeeId: values.employeeId,
        period: values.period.trim(),
        type: values.type,
        ...(values.kpiData?.trim() ? { kpiData: values.kpiData.trim() } : {}),
        ...(values.score !== undefined ? { score: values.score.toFixed(2) } : {}),
        ...(values.bonus !== undefined ? { bonus: values.bonus.toFixed(2) } : {}),
        ...(values.remark?.trim() ? { remark: values.remark.trim() } : {}),
      });
      message.success('绩效已录入');
      setCreateOpen(false);
      void fetchList(1, pageSize);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleConfirm = async (record: Performance) => {
    try {
      await performanceApi.confirm(record.id);
      message.success('绩效已确认');
      void fetchList();
    } catch {
      // 共享拦截器已提示错误。
    }
  };

  // SPEC-043：考核流程——目标/自评/主管评提交。
  const openReviewModal = (mode: 'goal' | 'self' | 'manager') => {
    reviewForm.resetFields();
    setReviewModal(mode);
  };

  const handleReviewSubmit = async (values: { goal?: string; score?: number; comment?: string }) => {
    if (!detail || !reviewModal) return;
    setReviewSubmitting(true);
    try {
      if (reviewModal === 'goal') {
        await performanceApi.setGoal(detail.id, { goal: (values.goal ?? '').trim() });
        message.success('目标已设定');
      } else if (reviewModal === 'self') {
        await performanceApi.selfReview(detail.id, {
          selfScore: values.score!,
          ...(values.comment?.trim() ? { selfComment: values.comment.trim() } : {}),
        });
        message.success('自评已提交');
      } else {
        await performanceApi.managerReview(detail.id, {
          managerScore: values.score!,
          ...(values.comment?.trim() ? { managerComment: values.comment.trim() } : {}),
        });
        message.success('主管评已提交');
      }
      setReviewModal(null);
      await openDetail(detail);
      void fetchList();
    } catch {
      // 共享拦截器已提示错误。
    } finally {
      setReviewSubmitting(false);
    }
  };

  const employeeName = (id: string): string => {
    const hit = employees.find(item => item.id === id);
    return hit ? hit.name : id;
  };

  const columns = [
    { title: '员工', key: 'employee', width: 110, render: (_: unknown, record: Performance) => employeeName(record.employeeId) },
    { title: '考核周期', dataIndex: 'period', key: 'period', width: 110 },
    { title: '类型', dataIndex: 'type', key: 'type', width: 100, render: (value: string) => TYPE_META[value] ?? value },
    { title: '评分', dataIndex: 'score', key: 'score', width: 100, render: (value: string | null) => (value != null ? <Tag color="blue">{value} 分</Tag> : '-') },
    { title: '奖金', dataIndex: 'bonus', key: 'bonus', width: 110, render: (value: string | null) => (value != null ? `¥${value}` : '-') },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (value: string) => <Tag color={STATUS_META[value]?.color}>{STATUS_META[value]?.text ?? value}</Tag> },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: unknown, record: Performance) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => void openDetail(record)}>详情</Button>
          {canConfirm && record.status !== 'CONFIRMED' && (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => void handleConfirm(record)}>确认</Button>
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
            <Space wrap>
              <Select
                aria-label="绩效类型筛选"
                placeholder="类型筛选"
                value={typeFilter}
                onChange={value => setTypeFilter(value)}
                style={{ width: 130 }}
                allowClear
                virtual={false}
                options={PERFORMANCE_TYPES.map(value => ({ value, label: TYPE_META[value] }))}
              />
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          {canCreate && (
            <Col>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>录入绩效</Button>
            </Col>
          )}
        </Row>
      </Card>

      <Table<Performance>
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无绩效记录' }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: totalCount => `共 ${totalCount} 条`,
          onChange: (nextPage, nextSize) => void fetchList(nextPage, nextSize),
        }}
      />

      {/* 录入绩效 */}
      <Modal
        title="录入绩效"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createSubmitting}
        okText="确定"
        width={520}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="employeeId" label="员工" rules={[{ required: true, message: '请选择员工' }]}>
            <Select
              aria-label="绩效员工"
              showSearch
              optionFilterProp="label"
              placeholder="选择员工"
              virtual={false}
              options={employees.map(item => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item name="period" label="考核周期" rules={[{ required: true, message: '请输入考核周期' }]}>
            <Input aria-label="考核周期" placeholder="如：2026-04" maxLength={7} />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]} initialValue="MONTHLY">
            <Select
              aria-label="绩效类型"
              virtual={false}
              options={PERFORMANCE_TYPES.map(value => ({ value, label: TYPE_META[value] }))}
            />
          </Form.Item>
          <Form.Item name="kpiData" label="KPI 数据（JSON）">
            <Input.TextArea rows={3} maxLength={2000} placeholder='如：{"cases":5,"amount":120000}' />
          </Form.Item>
          <Form.Item name="score" label="评分">
            <InputNumber aria-label="绩效评分" min={0} max={100} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="bonus" label="奖金">
            <InputNumber aria-label="绩效奖金" min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 绩效详情 */}
      <Drawer
        title={detail ? `${employeeName(detail.employeeId)} ${detail.period}` : '绩效详情'}
        width={560}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        {detailLoading && <div style={{ textAlign: 'center', color: '#999' }}>加载中...</div>}
        {!detailLoading && detail && (
          <div>
            <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
              <Row gutter={[16, 8]}>
                <Col span={12}><strong>员工：</strong>{employeeName(detail.employeeId)}</Col>
                <Col span={12}><strong>考核周期：</strong>{detail.period}</Col>
                <Col span={12}><strong>类型：</strong>{TYPE_META[detail.type] ?? detail.type}</Col>
                <Col span={12}><strong>状态：</strong><Tag color={STATUS_META[detail.status]?.color}>{STATUS_META[detail.status]?.text ?? detail.status}</Tag></Col>
                <Col span={12}><strong>评分：</strong>{detail.score != null ? `${detail.score} 分` : '-'}</Col>
                <Col span={12}><strong>奖金：</strong>{detail.bonus != null ? `¥${detail.bonus}` : '-'}</Col>
                <Col span={12}><strong>创建时间：</strong>{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Col>
              </Row>
              {detail.kpiData && (
                <p style={{ marginTop: 8 }}><strong>KPI 数据：</strong><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{detail.kpiData}</pre></p>
              )}
              {detail.remark && (
                <p><strong>备注：</strong>{detail.remark}</p>
              )}
            </Card>

            <Card size="small" title="考核流程" style={{ marginBottom: 16 }}>
              <Row gutter={[16, 8]}>
                <Col span={12}><strong>目标：</strong>{detail.goal ?? '-'}</Col>
                <Col span={12}><strong>自评：</strong>{detail.selfScore != null ? `${detail.selfScore} 分` : '-'}{detail.selfComment ? `（${detail.selfComment}）` : ''}</Col>
                <Col span={12}><strong>主管评：</strong>{detail.managerScore != null ? `${detail.managerScore} 分` : '-'}{detail.managerComment ? `（${detail.managerComment}）` : ''}</Col>
                {detail.reviewedAt && (
                  <Col span={12}><strong>主管评时间：</strong>{dayjs(detail.reviewedAt).format('YYYY-MM-DD HH:mm')}</Col>
                )}
              </Row>
              <div style={{ textAlign: 'right', marginTop: 12 }}>
                {detail.status === 'PENDING' && canUpdate && (
                  <Space>
                    <Button onClick={() => openReviewModal('goal')}>设定目标</Button>
                    <Button type="primary" onClick={() => openReviewModal('self')}>自评</Button>
                  </Space>
                )}
                {detail.status === 'SELF_REVIEWED' && canConfirm && (
                  <Button type="primary" onClick={() => openReviewModal('manager')}>主管评</Button>
                )}
                {detail.status === 'MANAGER_REVIEWED' && canConfirm && (
                  <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void handleConfirm(detail)}>确认</Button>
                )}
              </div>
            </Card>

            <Card size="small" title="业务指标（考核周期）" style={{ marginBottom: 16 }}>
              {metricsLoading ? (
                <p style={{ color: '#999' }}>加载中...</p>
              ) : metrics ? (
                <Row gutter={[16, 8]}>
                  <Col span={8}><strong>案件办结数：</strong>{metrics.closedCases} 件</Col>
                  <Col span={8}><strong>回款额：</strong>¥{metrics.confirmedRevenue}</Col>
                  <Col span={8}><strong>自动计分：</strong><Tag color="blue">{metrics.autoScore} 分</Tag></Col>
                </Row>
              ) : (
                <p style={{ color: '#999' }}>暂无业务指标</p>
              )}
            </Card>
          </div>
        )}
      </Drawer>

      {/* 考核流程 Modal（SPEC-043） */}
      <Modal
        title={reviewModal === 'goal' ? '设定目标' : reviewModal === 'self' ? '自评' : '主管评'}
        open={reviewModal !== null}
        onCancel={() => setReviewModal(null)}
        onOk={() => reviewForm.submit()}
        confirmLoading={reviewSubmitting}
        okText="确定"
        width={460}
        destroyOnHidden
      >
        <Form form={reviewForm} layout="vertical" onFinish={handleReviewSubmit}>
          {reviewModal === 'goal' ? (
            <Form.Item name="goal" label="绩效目标" rules={[{ required: true, message: '请输入绩效目标' }]}>
              <Input.TextArea aria-label="绩效目标" rows={3} maxLength={2000} placeholder="如：完成 5 个案源转化" />
            </Form.Item>
          ) : (
            <>
              <Form.Item name="score" label="评分（0-100）" rules={[{ required: true, message: '请输入评分' }]}>
                <InputNumber aria-label="考核评分" min={0} max={100} precision={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="comment" label="评语">
                <Input.TextArea aria-label="评语" rows={2} maxLength={2000} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default function PerformanceWorkspace() { return <Tabs destroyOnHidden items={[{ key: 'performance', label: '绩效考核', children: <PerformancePage /> }, { key: 'payroll', label: '工资表', children: <PayrollPanel /> }]} />; }
