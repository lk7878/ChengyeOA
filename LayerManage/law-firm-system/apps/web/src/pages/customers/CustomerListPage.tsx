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
import { useCustomerStore, type CustomerListFilters } from '@/stores/customer-store';
import {
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  type CreateCustomerInput,
  type CustomerStatus,
  type CustomerType,
  type CustomerView,
} from '@/api/types';
import { CUSTOMER_STATUS_META, CUSTOMER_TYPE_META } from '../leads/meta';

const CustomerListPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    customers, listTotal, listPage, listPageSize, listLoading, listError,
    fetchCustomers, applyFilters, createCustomer,
  } = useCustomerStore();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<CustomerStatus | undefined>(undefined);
  const [customerType, setCustomerType] = useState<CustomerType | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<CreateCustomerInput>();

  useEffect(() => {
    void fetchCustomers(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => {
    const filters: CustomerListFilters = {};
    if (keyword.trim()) filters.keyword = keyword.trim();
    if (status) filters.status = status;
    if (customerType) filters.customerType = customerType;
    void applyFilters(filters);
  };

  const handleReset = () => {
    setKeyword('');
    setStatus(undefined);
    setCustomerType(undefined);
    void applyFilters({});
  };

  const handleCreate = async (values: CreateCustomerInput) => {
    setSubmitting(true);
    try {
      const customer = await createCustomer(values);
      if (!customer) return;
      message.success('创建成功');
      setCreateOpen(false);
      form.resetFields();
      void fetchCustomers(1);
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: '客户编号', dataIndex: 'customerNo', key: 'customerNo', width: 140 },
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: CustomerView) => (
        <Button type="link" size="small" onClick={() => navigate(`/customers/${record.id}`)}>{name}</Button>
      ),
    },
    // L3 字段：服务端预脱敏，原样渲染。
    { title: '电话', dataIndex: 'phone', key: 'phone', render: (value: string | null) => value ?? '-' },
    { title: '微信', dataIndex: 'wechat', key: 'wechat', render: (value: string | null) => value ?? '-' },
    {
      title: '类型',
      dataIndex: 'customerType',
      key: 'customerType',
      width: 80,
      render: (value: string) => CUSTOMER_TYPE_META[value as CustomerType] ?? value,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value: CustomerStatus) => {
        const meta = CUSTOMER_STATUS_META[value] ?? { text: value, color: 'default' };
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
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: CustomerView) => (
        <Button type="link" size="small" onClick={() => navigate(`/customers/${record.id}`)}>详情</Button>
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
                options={CUSTOMER_STATUSES.map(value => ({ value, label: CUSTOMER_STATUS_META[value].text }))}
              />
              <Select
                aria-label="类型筛选"
                placeholder="类型筛选"
                value={customerType}
                onChange={value => setCustomerType(value)}
                style={{ width: 110 }}
                allowClear
                options={CUSTOMER_TYPES.map(value => ({ value, label: CUSTOMER_TYPE_META[value] }))}
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建客户</Button>
          </Col>
        </Row>
      </Card>

      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="客户列表加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<CustomerView>
        columns={columns}
        dataSource={customers}
        rowKey="id"
        loading={listLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无客户' }}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: listTotal,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchCustomers(page, pageSize),
        }}
      />

      <Modal
        title="新建客户"
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
          <Form.Item name="customerType" label="客户类型" initialValue="INDIVIDUAL">
            <Select options={CUSTOMER_TYPES.map(value => ({ value, label: CUSTOMER_TYPE_META[value] }))} />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input placeholder="多个标签用逗号分隔" maxLength={200} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CustomerListPage;
