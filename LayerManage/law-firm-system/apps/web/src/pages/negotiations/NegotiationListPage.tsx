import Table from '@/components/ResizableTable';
// SPEC-010 Task 11: 谈案管理页（CRM-07）。Files 清单未含 negotiation-store：
// 页面以局部状态直接消费 negotiationApi（自裁决，形态与 store 列表页一致：筛选/分页/空态/错误态）。
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  message,
} from 'antd';
import Modal from '@/components/DraggableModal';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuthStore } from '@/stores/authStore';
import { customerApi } from '@/api/customer';
import { masterDataApi } from '@/api/organization';
import {
  negotiationApi,
  NEGOTIATION_STATUSES,
  type CloseNegotiationInput,
  type NegotiationStatus,
  type NegotiationView,
} from '@/api/negotiation';
import type { CustomerView } from '@/api/types';
import { NEGOTIATION_STATUS_META } from '../contracts/meta';

interface EmployeeOption {
  id: string;
  name: string;
  employeeNo: string;
}

interface CreateFormValues {
  customerId: string;
  negotiatorEmployeeId: string;
  quotedAmount?: number;
  customerConcerns?: string;
  competitorInfo?: string;
  remark?: string;
}

interface CloseFormValues {
  outcome: 'SIGNED' | 'UNSIGNED';
  unsignedReason?: string;
}

const NegotiationListPage: React.FC = () => {
  const canCreate = useAuthStore(state => state.hasPermission('negotiation.create'));
  const canUpdate = useAuthStore(state => state.hasPermission('negotiation.update'));

  const [negotiations, setNegotiations] = useState<NegotiationView[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState(10);
  const [status, setStatus] = useState<NegotiationStatus | undefined>(undefined);
  const [appliedStatus, setAppliedStatus] = useState<NegotiationStatus | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<NegotiationView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createForm] = Form.useForm<CreateFormValues>();
  const [closeForm] = Form.useForm<CloseFormValues>();
  const closeOutcome = Form.useWatch('outcome', closeForm);

  const fetchNegotiations = useCallback(async (page: number, pageSize: number, statusFilter?: NegotiationStatus) => {
    setLoading(true);
    setListError(null);
    try {
      const res = await negotiationApi.list({
        page,
        pageSize,
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      setNegotiations(res.data.list);
      setListTotal(res.data.total);
      setListPage(res.data.page);
      setListPageSize(res.data.pageSize);
    } catch (error) {
      setListError(error instanceof Error && error.message ? error.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOptions = () => {
    if (customers.length === 0) {
      void customerApi.list({ page: 1, pageSize: 100 })
        .then(res => setCustomers(res.data.list))
        .catch(() => undefined);
    }
    if (employees.length === 0) {
      void masterDataApi.employees.list({ pageSize: 100 })
        .then(res => setEmployees(res.data.list.map(item => ({ id: item.id, name: item.name, employeeNo: item.employeeNo }))))
        .catch(() => undefined);
    }
  };

  useEffect(() => {
    // 首屏加载推迟到微任务：避免 effect 体内同步 setState（react-hooks/set-state-in-effect 纪律）。
    void Promise.resolve().then(() => {
      void fetchNegotiations(1, 10, undefined);
      loadOptions();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customerName = (id: string): string => {
    const hit = customers.find(item => item.id === id);
    return hit ? hit.name : id;
  };

  const employeeName = (id: string): string => {
    const hit = employees.find(item => item.id === id);
    return hit ? hit.name : id;
  };

  const handleSearch = () => {
    setAppliedStatus(status);
    void fetchNegotiations(1, listPageSize, status);
  };

  const handleReset = () => {
    setStatus(undefined);
    setAppliedStatus(undefined);
    void fetchNegotiations(1, listPageSize, undefined);
  };

  const handleCreate = async (values: CreateFormValues) => {
    setSubmitting(true);
    try {
      await negotiationApi.create({
        customerId: values.customerId,
        negotiatorEmployeeId: values.negotiatorEmployeeId,
        ...(values.quotedAmount !== undefined && values.quotedAmount !== null
          ? { quotedAmount: values.quotedAmount.toFixed(2) }
          : {}),
        ...(values.customerConcerns?.trim() ? { customerConcerns: values.customerConcerns.trim() } : {}),
        ...(values.competitorInfo?.trim() ? { competitorInfo: values.competitorInfo.trim() } : {}),
        ...(values.remark?.trim() ? { remark: values.remark.trim() } : {}),
      });
      message.success('谈案创建成功');
      setCreateOpen(false);
      createForm.resetFields();
      void fetchNegotiations(1, listPageSize, appliedStatus);
    } catch {
      // 拦截器已全局提示。
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async (values: CloseFormValues) => {
    if (!closeTarget) return;
    setSubmitting(true);
    try {
      const input: CloseNegotiationInput = {
        outcome: values.outcome,
        ...(values.outcome === 'UNSIGNED' ? { unsignedReason: values.unsignedReason!.trim() } : {}),
      };
      await negotiationApi.close(closeTarget.id, input);
      message.success(values.outcome === 'SIGNED' ? '谈案已完结（签约）' : '谈案已完结（未签约）');
      setCloseTarget(null);
      void fetchNegotiations(listPage, listPageSize, appliedStatus);
    } catch {
      // 拦截器已全局提示。
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: '谈案编号', dataIndex: 'negotiationNo', key: 'negotiationNo', width: 160 },
    {
      title: '客户',
      dataIndex: 'customerId',
      key: 'customerId',
      width: 120,
      render: (value: string) => customerName(value),
    },
    {
      title: '谈案律师',
      dataIndex: 'negotiatorEmployeeId',
      key: 'negotiatorEmployeeId',
      width: 110,
      render: (value: string) => employeeName(value),
    },
    // 金额为 toFixed(2) 字符串投影（非 L3 不脱敏），直接渲染。
    {
      title: '报价金额',
      dataIndex: 'quotedAmount',
      key: 'quotedAmount',
      width: 110,
      align: 'right' as const,
      render: (value: string | null) => value ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: NegotiationStatus) => {
        const meta = NEGOTIATION_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '未签原因',
      dataIndex: 'unsignedReason',
      key: 'unsignedReason',
      render: (value: string | null) => value ?? '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    ...(canUpdate
      ? [{
          title: '操作',
          key: 'action',
          width: 90,
          render: (_: unknown, record: NegotiationView) => (
            record.status === 'NEGOTIATING'
              ? (
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    closeForm.resetFields();
                    setCloseTarget(record);
                  }}
                >
                  完结
                </Button>
              )
              : null
          ),
        }]
      : []),
  ];

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
                options={NEGOTIATION_STATUSES.map(value => ({ value, label: NEGOTIATION_STATUS_META[value].text }))}
              />
              <Button type="primary" onClick={handleSearch}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          {canCreate && (
            <Col>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { loadOptions(); setCreateOpen(true); }}>新建谈案</Button>
            </Col>
          )}
        </Row>
      </Card>

      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="谈案列表加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<NegotiationView>
        columns={columns}
        dataSource={negotiations}
        rowKey="id"
        loading={loading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无谈案' }}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: listTotal,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchNegotiations(page, pageSize, appliedStatus),
        }}
      />

      <Modal
        title="新建谈案"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={submitting}
        width={560}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
            <Select
              aria-label="客户"
              showSearch
              optionFilterProp="label"
              options={customers.map(item => ({ value: item.id, label: `${item.name}（${item.customerNo}）` }))}
            />
          </Form.Item>
          <Form.Item
            name="negotiatorEmployeeId"
            label="谈案律师"
            rules={[{ required: true, message: '请选择谈案律师' }]}
          >
            <Select
              aria-label="谈案律师"
              showSearch
              optionFilterProp="label"
              options={employees.map(item => ({ value: item.id, label: `${item.name}（${item.employeeNo}）` }))}
            />
          </Form.Item>
          <Form.Item name="quotedAmount" label="报价金额">
            <InputNumber aria-label="报价金额" min={0} precision={2} style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="customerConcerns" label="客户顾虑">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item name="competitorInfo" label="竞对情况">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="完结谈案"
        open={closeTarget !== null}
        onCancel={() => setCloseTarget(null)}
        onOk={() => closeForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={closeForm} layout="vertical" onFinish={handleClose} initialValues={{ outcome: 'SIGNED' }}>
          <Form.Item name="outcome" label="完结结果" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: 'SIGNED', label: '已签约' },
                { value: 'UNSIGNED', label: '未签约' },
              ]}
            />
          </Form.Item>
          {closeOutcome === 'UNSIGNED' && (
            <Form.Item
              name="unsignedReason"
              label="未签原因"
              rules={[{ required: true, whitespace: true, message: '请输入未签原因' }]}
            >
              <Input.TextArea rows={3} maxLength={500} placeholder="必填" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default NegotiationListPage;
