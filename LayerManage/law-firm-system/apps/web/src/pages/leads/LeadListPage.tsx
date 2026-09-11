import Table from '@/components/ResizableTable';
import { crmNameRules, phoneRules } from '@/features/crm/form-rules';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
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
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { useLeadStore, type LeadListFilters } from '@/stores/lead-store';
import {
  LEAD_STATUSES,
  POOL_STATUSES,
  LEAD_SOURCE_TYPES,
  type CreateLeadInput,
  type LeadStatus,
  type LeadView,
  type PoolStatus,
} from '@/api/types';
import { LEAD_STATUS_META, POOL_STATUS_META, SOURCE_TYPE_META, intentionStars } from './meta';

const LeadListPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    leads, listTotal, listPage, listPageSize, listLoading, listError,
    fetchLeads, applyFilters, createLead,
  } = useLeadStore();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<LeadStatus | undefined>(undefined);
  const [poolStatus, setPoolStatus] = useState<PoolStatus | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<CreateLeadInput>();

  useEffect(() => {
    void fetchLeads(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => {
    const filters: LeadListFilters = {};
    if (keyword.trim()) filters.keyword = keyword.trim();
    if (status) filters.status = status;
    if (poolStatus) filters.poolStatus = poolStatus;
    void applyFilters(filters);
  };

  const handleReset = () => {
    setKeyword('');
    setStatus(undefined);
    setPoolStatus(undefined);
    void applyFilters({});
  };

  const handleCreate = async (values: CreateLeadInput) => {
    setSubmitting(true);
    try {
      const result = await createLead(values);
      if (!result) return;
      if (result.duplicates.length > 0) {
        Modal.warning({
          title: '已创建，但存在疑似重复线索',
          content: `系统检测到 ${result.duplicates.length} 条疑似重复（${
            [...new Set(result.duplicates.map(signal => signal.type))].join('、')
          }），请跟进时留意核对。`,
        });
      } else {
        message.success('创建成功');
      }
      setCreateOpen(false);
      form.resetFields();
      void fetchLeads(1);
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: '线索编号', dataIndex: 'leadNo', key: 'leadNo', width: 140 },
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: LeadView) => (
        <Button type="link" size="small" onClick={() => navigate(`/leads/${record.id}`)}>{name}</Button>
      ),
    },
    // L3 字段：服务端预脱敏，原样渲染，不做任何还原尝试。
    { title: '电话', dataIndex: 'phone', key: 'phone', render: (value: string | null) => value ?? '-' },
    { title: '微信', dataIndex: 'wechat', key: 'wechat', render: (value: string | null) => value ?? '-' },
    {
      title: '意向',
      dataIndex: 'intentionLevel',
      key: 'intentionLevel',
      width: 110,
      render: (level: number) => <span aria-label={`意向等级 ${level}`}>{intentionStars(level)}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: LeadStatus) => {
        const meta = LEAD_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '归属',
      dataIndex: 'poolStatus',
      key: 'poolStatus',
      width: 90,
      render: (value: PoolStatus) => {
        const meta = POOL_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '来源',
      dataIndex: 'sourceType',
      key: 'sourceType',
      width: 100,
      render: (value: string) => SOURCE_TYPE_META[value as keyof typeof SOURCE_TYPE_META] ?? value,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: LeadView) => (
        <Button type="link" size="small" onClick={() => navigate(`/leads/${record.id}`)}>详情</Button>
      ),
    },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]} align="middle">
          <Col flex="auto">
            <Space wrap>
              <Input
                placeholder="搜索姓名/电话/编号"
                value={keyword}
                onChange={event => setKeyword(event.target.value)}
                onPressEnter={handleSearch}
                prefix={<SearchOutlined />}
                style={{ width: 200 }}
                allowClear
              />
              <Select
                aria-label="状态筛选"
                placeholder="状态筛选"
                value={status}
                onChange={value => setStatus(value)}
                style={{ width: 130 }}
                allowClear
                options={LEAD_STATUSES.map(value => ({ value, label: LEAD_STATUS_META[value].text }))}
              />
              <Select
                aria-label="归属筛选"
                placeholder="归属筛选"
                value={poolStatus}
                onChange={value => setPoolStatus(value)}
                style={{ width: 120 }}
                allowClear
                options={POOL_STATUSES.map(value => ({ value, label: POOL_STATUS_META[value].text }))}
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建线索</Button>
          </Col>
        </Row>
      </Card>

      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="线索列表加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<LeadView>
        columns={columns}
        dataSource={leads}
        rowKey="id"
        loading={listLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无线索' }}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: listTotal,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchLeads(page, pageSize),
        }}
      />

      <Modal
        title="新建线索"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="姓名" rules={crmNameRules}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="phone" label="电话" rules={phoneRules()}>
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="wechat" label="微信">
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="intentionLevel" label="意向等级" initialValue={3}>
            <InputNumber min={1} max={5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="sourceType" label="来源类型" initialValue="MANUAL">
            <Select options={LEAD_SOURCE_TYPES.map(value => ({ value, label: SOURCE_TYPE_META[value] }))} />
          </Form.Item>
          <Form.Item name="sourceDetail" label="来源详情">
            <Input placeholder="如：百度推广-关键词XX" maxLength={200} />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input placeholder="多个标签用逗号分隔" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default LeadListPage;
