import Table from '@/components/ResizableTable';
// SPEC-011 Task 11: 开票申请列表页（FIN-02）。沿 PaymentListPage 形态（AntD 6 + store 模式）。
// 列表：申请号/合同/客户/金额/状态/创建时间 + 状态筛选 + 分页；
// 行操作按状态出按钮（PENDING→审核通过/拒绝——invoice.approve；APPROVED→完成弹窗录发票号——invoice.complete），
// 权限门控沿既有权限按钮形态；新建弹窗（合同选择器沿登记弹窗、金额、事由）。
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
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useInvoiceStore, type InvoiceListFilters } from '@/stores/invoice-store';
import { useAuthStore } from '@/stores/authStore';
import { contractApi, type ContractView } from '@/api/contract';
import {
  INVOICE_STATUSES,
  type InvoiceStatus,
  type InvoiceView,
} from '@/api/invoice';

const INVOICE_STATUS_META: Record<InvoiceStatus, { text: string; color: string }> = {
  PENDING: { text: '待审批', color: 'gold' },
  APPROVED: { text: '已批准', color: 'blue' },
  REJECTED: { text: '已驳回', color: 'red' },
  COMPLETED: { text: '已完成', color: 'green' },
};

interface CreateFormValues {
  contractId: string;
  amount: number;
  reason?: string;
}

type ActionModal = 'approve' | 'reject' | 'complete' | null;

const InvoiceListPage: React.FC<{ caseNo?: string }> = ({ caseNo }) => {
  const {
    invoices, listTotal, listPage, listPageSize, listLoading, listError,
    fetchInvoices, applyFilters, createInvoice, approveInvoice, rejectInvoice, completeInvoice,
  } = useInvoiceStore();
  const canCreate = useAuthStore(state => state.hasPermission('invoice.create'));
  const canApprove = useAuthStore(state => state.hasPermission('invoice.approve'));
  const canComplete = useAuthStore(state => state.hasPermission('invoice.complete'));
  const [status, setStatus] = useState<InvoiceStatus | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receivableContracts, setReceivableContracts] = useState<ContractView[]>([]);
  const [createForm] = Form.useForm<CreateFormValues>();
  const [activeModal, setActiveModal] = useState<ActionModal>(null);
  const [activeRecord, setActiveRecord] = useState<InvoiceView | null>(null);
  const [actionForm] = Form.useForm<{ comment?: string; invoiceNo?: string }>();

  useEffect(() => { void applyFilters({ caseNo }); }, [caseNo, applyFilters]);

  const openCreate = () => {
    createForm.resetFields();
    setCreateOpen(true);
    
    // 开票申请仅接受 SIGNED/EFFECTIVE 合同（后端口径），前端预筛减少 400。
    void contractApi.list({ page: 1, pageSize: 100, caseNo })
      .then(res => setReceivableContracts(res.data.list.filter(
        item => item.status === 'SIGNED' || item.status === 'EFFECTIVE',
      )))
      .catch(() => undefined);
  };

  const handleSearch = () => {
    const filters: InvoiceListFilters = {};
    if (status) filters.status = status;
    void applyFilters({ ...filters, caseNo });
  };

  const handleReset = () => {
    setStatus(undefined);
    void applyFilters({ caseNo });
  };

  const handleCreate = async (values: CreateFormValues) => {
    setSubmitting(true);
    try {
      const created = await createInvoice({
        contractId: values.contractId,
        caseNo,
        amount: values.amount.toFixed(2),
        ...(values.reason?.trim() ? { reason: values.reason.trim() } : {}),
      });
      if (!created) return;
      message.success('开票申请已提交');
      setCreateOpen(false);
      void fetchInvoices(1);
    } finally {
      setSubmitting(false);
    }
  };

  const openAction = (modal: Exclude<ActionModal, null>, record: InvoiceView) => {
    actionForm.resetFields();
    setActiveRecord(record);
    setActiveModal(modal);
  };

  const handleActionOk = async () => {
    if (!activeRecord) return;
    const values = await actionForm.validateFields();
    setSubmitting(true);
    try {
      if (activeModal === 'approve') {
        const ok = await approveInvoice(activeRecord.id, { comment: values.comment?.trim() || undefined });
        if (ok) message.success('开票申请已批准');
      } else if (activeModal === 'reject') {
        const ok = await rejectInvoice(activeRecord.id, { comment: values.comment!.trim() });
        if (ok) message.success('开票申请已驳回');
      } else if (activeModal === 'complete') {
        const ok = await completeInvoice(activeRecord.id, { invoiceNo: values.invoiceNo?.trim() || undefined });
        if (ok) message.success('开票已完成');
      }
      setActiveModal(null);
      setActiveRecord(null);
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: '案件编号 / 名称', key: 'linkedCase', width: 230, render: (_: unknown, row: InvoiceView) => row.linkedCase ? <span><a href={'/cases?caseNo=' + encodeURIComponent(row.linkedCase.caseNo)}>{row.linkedCase.caseNo}</a><br />{row.linkedCase.title}</span> : '待关联案件' },
    { title: '申请编号', dataIndex: 'requestNo', key: 'requestNo', width: 170 },
    { title: '合同', dataIndex: 'contractId', key: 'contractId', width: 140 },
    { title: '客户', dataIndex: 'customerId', key: 'customerId', width: 140 },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'right' as const },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: InvoiceStatus) => {
        const meta = INVOICE_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    ...((canApprove || canComplete)
      ? [{
          title: '操作',
          key: 'action',
          width: 170,
          render: (_: unknown, record: InvoiceView) => {
            if (record.status === 'PENDING' && canApprove) {
              return (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => openAction('approve', record)}>审核通过</Button>
                  <Button type="link" size="small" onClick={() => openAction('reject', record)}>拒绝</Button>
                </Space>
              );
            }
            if (record.status === 'APPROVED' && canComplete) {
              return <Button type="link" size="small" onClick={() => openAction('complete', record)}>完成</Button>;
            }
            return null;
          },
        }]
      : []),
  ];

  const actionModalTitle: Record<Exclude<ActionModal, null>, string> = {
    approve: '审核通过',
    reject: '驳回开票申请',
    complete: '完成开票',
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]} align="middle">
          <Col flex="auto">
            <Space wrap>
              <Select
                aria-label="状态筛选"
                placeholder="状态筛选"
                value={status}
                onChange={value => setStatus(value)}
                style={{ width: 130 }}
                allowClear
                options={INVOICE_STATUSES.map(value => ({ value, label: INVOICE_STATUS_META[value].text }))}
              />
              <Button type="primary" onClick={handleSearch}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          {canCreate && (
            <Col>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建申请</Button>
            </Col>
          )}
        </Row>
      </Card>

      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="开票列表加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<InvoiceView>
        columns={columns}
        dataSource={invoices}
        rowKey="id"
        loading={listLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无开票申请' }}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: listTotal,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchInvoices(page, pageSize),
        }}
      />

      <Modal
        title="新建开票申请"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={submitting}
        okText="确定"
        width={560}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="contractId" label="合同" rules={[{ required: true, message: '请选择合同' }]}>
            <Select
              aria-label="合同"
              showSearch
              optionFilterProp="label"
              placeholder="仅可选择已签署/已生效合同"
              options={receivableContracts.map(item => ({
                value: item.id,
                label: `${item.contractNo} ${item.title}（金额 ${item.amount}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="amount" label="申请金额" rules={[{ required: true, message: '请输入申请金额' }]}>
            <InputNumber aria-label="申请金额" min={0.01} precision={2} style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="reason" label="申请事由">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={activeModal ? actionModalTitle[activeModal] : ''}
        open={activeModal !== null}
        onCancel={() => { setActiveModal(null); setActiveRecord(null); }}
        onOk={() => void handleActionOk()}
        confirmLoading={submitting}
        okText={activeModal === 'reject' ? '确认驳回' : '确定'}
        okButtonProps={{ danger: activeModal === 'reject' }}
        destroyOnHidden
      >
        <Form form={actionForm} layout="vertical">
          {activeModal === 'approve' && (
            <Form.Item name="comment" label="审批意见（可选）">
              <Input.TextArea rows={3} maxLength={500} />
            </Form.Item>
          )}
          {activeModal === 'reject' && (
            <Form.Item
              name="comment"
              label="驳回原因"
              rules={[{ required: true, whitespace: true, message: '请输入驳回原因' }]}
            >
              <Input.TextArea rows={3} maxLength={500} placeholder="必填" />
            </Form.Item>
          )}
          {activeModal === 'complete' && (
            <Form.Item name="invoiceNo" label="发票号（缺省服务端自动编号）">
              <Input maxLength={100} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default InvoiceListPage;
