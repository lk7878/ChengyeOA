import Table from '@/components/ResizableTable';
// SPEC-011 Task 11: 成本列表页（FIN-04）。沿 PaymentListPage 形态（AntD 6 + store 模式）。
// 列表（类别/金额/发生日期/锚点展示）+ 类别筛选 + 分页；
// 新建/编辑弹窗：类别 Select 驱动锚点控件（CHANNEL→渠道下拉必填；
// EVIDENCE/CASE_HANDLING→案件下拉必填；LABOR/OFFICE→无锚点控件）；编辑走
// PATCH { amount, occurredAt, note, version }（乐观锁）；删除二次确认（cost.delete 权限）。
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  message,
} from 'antd';
import Modal from '@/components/DraggableModal';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useCostStore, type CostListFilters } from '@/stores/cost-store';
import { useAuthStore } from '@/stores/authStore';
import { channelApi } from '@/api/organization';
import { caseApi } from '@/api/business';
import type { Channel } from '@/types';
import type { Case } from '@/types';
import { COST_CATEGORIES, type CostCategory, type CostView } from '@/api/cost';

const COST_CATEGORY_META: Record<CostCategory, { text: string; color: string }> = {
  CHANNEL: { text: '渠道成本', color: 'blue' },
  EVIDENCE: { text: '取证成本', color: 'geekblue' },
  CASE_HANDLING: { text: '办案成本', color: 'purple' },
  LABOR: { text: '人力成本', color: 'cyan' },
  REIMBURSEMENT: { text: '报销成本', color: 'cyan' },
  OFFICE: { text: '办公成本', color: 'default' },
};

/** 类别→锚点类型：CHANNEL 锚渠道；EVIDENCE/CASE_HANDLING 锚案件；LABOR/OFFICE 无锚点。 */
function anchorKind(category: CostCategory): 'channel' | 'case' | 'none' {
  if (category === 'CHANNEL') return 'channel';
  if (category === 'EVIDENCE' || category === 'CASE_HANDLING') return 'case';
  return 'none';
}

interface CostFormValues {
  category: CostCategory;
  amount: number;
  occurredAt?: Dayjs;
  note?: string;
  channelId?: string;
  caseId?: string;
}

const CostListPage: React.FC = () => {
  const {
    costs, listTotal, listPage, listPageSize, listLoading, listError,
    fetchCosts, applyFilters, createCost, updateCost, removeCost,
  } = useCostStore();
  const canCreate = useAuthStore(state => state.hasPermission('cost.create'));
  const canUpdate = useAuthStore(state => state.hasPermission('cost.update'));
  const canDelete = useAuthStore(state => state.hasPermission('cost.delete'));
  const [category, setCategory] = useState<CostCategory | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CostView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [form] = Form.useForm<CostFormValues>();
  const watchedCategory = Form.useWatch('category', form);

  useEffect(() => {
    void fetchCosts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 锚点展示映射：渠道名/案件编号（列表列渲染用），懒加载一次。
  useEffect(() => {
    channelApi.list()
      .then(res => setChannels(res.data.list ?? (Array.isArray(res.data) ? res.data : [])))
      .catch(() => undefined);
    caseApi.list({ page: 1, pageSize: 100 })
      .then(res => setCases(res.data.list ?? []))
      .catch(() => undefined);
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: CostView) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      category: record.category,
      amount: Number(record.amount),
      occurredAt: record.occurredAt ? dayjs(record.occurredAt) : undefined,
      note: record.note ?? undefined,
      channelId: record.channelId ?? undefined,
      caseId: record.caseId ?? undefined,
    });
    setModalOpen(true);
  };

  const handleSearch = () => {
    const filters: CostListFilters = {};
    if (category) filters.category = category;
    void applyFilters(filters);
  };

  const handleReset = () => {
    setCategory(undefined);
    void applyFilters({});
  };

  const handleSubmit = async (values: CostFormValues) => {
    setSubmitting(true);
    try {
      const kind = anchorKind(values.category);
      if (kind === 'channel' && !values.channelId) return;
      if (kind === 'case' && !values.caseId) return;
      const occurredAt = values.occurredAt ? values.occurredAt.toISOString() : new Date().toISOString();
      const note = values.note?.trim() || undefined;
      if (editing) {
        const updated = await updateCost(editing.id, {
          amount: values.amount.toFixed(2),
          occurredAt,
          note,
          version: editing.version,
        });
        if (!updated) return;
        message.success('成本已更新');
      } else {
        const created = await createCost({
          category: values.category,
          amount: values.amount.toFixed(2),
          occurredAt,
          note,
          ...(kind === 'channel' ? { channelId: values.channelId } : {}),
          ...(kind === 'case' ? { caseId: values.caseId } : {}),
        });
        if (!created) return;
        message.success('成本已登记');
      }
      setModalOpen(false);
      void fetchCosts(1);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record: CostView) => {
    const ok = await removeCost(record.id);
    if (ok) message.success('成本已删除');
  };

  const channelMap = new Map(channels.map(item => [item.id, item.name]));
  const caseMap = new Map(cases.map(item => [item.id, item.caseNo]));

  const renderAnchor = (record: CostView) => {
    const kind = anchorKind(record.category);
    if (kind === 'channel') {
      return record.channelId ? channelMap.get(record.channelId) ?? record.channelId : '-';
    }
    if (kind === 'case') {
      return record.caseId ? caseMap.get(record.caseId) ?? record.caseId : '-';
    }
    return '-';
  };

  const columns = [
    { title: '来源审批', key: 'sourceApproval', width: 130, render: (_: unknown, row: CostView) => row.sourceApprovalId ? <a href="/approval-ledger?target=COST">报销审批</a> : '手工登记' },
    {
      title: '类别',
      dataIndex: 'category',
      key: 'category',
      width: 110,
      render: (value: CostCategory) => {
        const meta = COST_CATEGORY_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'right' as const },
    {
      title: '发生日期',
      dataIndex: 'occurredAt',
      key: 'occurredAt',
      width: 120,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    { title: '锚点', key: 'anchor', width: 160, render: (_: unknown, record: CostView) => renderAnchor(record) },
    { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true, render: (value: string | null) => value ?? '-' },
    ...((canUpdate || canDelete)
      ? [{
          title: '操作',
          key: 'action',
          width: 150,
          render: (_: unknown, record: CostView) => (
            <Space size={0}>
              {canUpdate && <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>}
              {canDelete && (
                <Popconfirm
                  title="确认删除该成本记录？"
                  description="删除为软删，记录不可恢复。"
                  okText="确认"
                  cancelText="取消"
                  onConfirm={() => void handleDelete(record)}
                >
                  <Button type="link" size="small" danger>删除</Button>
                </Popconfirm>
              )}
            </Space>
          ),
        }]
      : []),
  ];

  const kind = watchedCategory ? anchorKind(watchedCategory) : 'none';

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]} align="middle">
          <Col flex="auto">
            <Space wrap>
              <Select
                aria-label="类别筛选"
                placeholder="类别筛选"
                value={category}
                onChange={value => setCategory(value)}
                style={{ width: 130 }}
                allowClear
                options={COST_CATEGORIES.map(value => ({ value, label: COST_CATEGORY_META[value].text }))}
              />
              <Button type="primary" onClick={handleSearch}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          {canCreate && (
            <Col>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>登记成本</Button>
            </Col>
          )}
        </Row>
      </Card>

      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="成本列表加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<CostView>
        columns={columns}
        dataSource={costs}
        rowKey="id"
        loading={listLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无成本记录' }}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: listTotal,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchCosts(page, pageSize),
        }}
      />

      <Modal
        title={editing ? '编辑成本' : '登记成本'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        okText="确定"
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="category" label="类别" rules={[{ required: true, message: '请选择类别' }]}>
            <Select
              aria-label="成本类别"
              placeholder="选择类别后将显示对应锚点"
              disabled={editing !== null}
              options={COST_CATEGORIES.map(value => ({ value, label: COST_CATEGORY_META[value].text }))}
            />
          </Form.Item>
          {kind === 'channel' && (
            <Form.Item name="channelId" label="渠道" rules={[{ required: true, message: '请选择渠道' }]}>
              <Select
                aria-label="锚点渠道"
                showSearch
                optionFilterProp="label"
                placeholder="渠道成本须锚定渠道"
                disabled={editing !== null}
                options={channels.map(item => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
          )}
          {kind === 'case' && (
            <Form.Item name="caseId" label="案件" rules={[{ required: true, message: '请选择案件' }]}>
              <Select
                aria-label="锚点案件"
                showSearch
                optionFilterProp="label"
                placeholder="取证/办案成本须锚定案件"
                disabled={editing !== null}
                options={cases.map(item => ({ value: item.id, label: `${item.caseNo} ${item.title}` }))}
              />
            </Form.Item>
          )}
          <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber aria-label="成本金额" min={0.01} precision={2} style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="occurredAt" label="发生日期（缺省取当前时间）">
            <DatePicker aria-label="发生日期" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CostListPage;
