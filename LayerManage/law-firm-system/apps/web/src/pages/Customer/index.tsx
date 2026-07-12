import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Select, Tag, Space, Modal, Form, message,
  Drawer, Popconfirm, Card, Row, Col, Tabs, List
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EyeOutlined, EditOutlined,
  DeleteOutlined, SyncOutlined
} from '@ant-design/icons';
import { customerApi } from '@/api/business';
import type { Customer, Contract, Case, Payment } from '@/types';
import dayjs from 'dayjs';

const { Option } = Select;
const { TabPane } = Tabs;

const statusMap: Record<string, { text: string; color: string }> = {
  POTENTIAL: { text: '潜在客户', color: 'blue' },
  INTENT: { text: '意向客户', color: 'orange' },
  SIGNED: { text: '已签约', color: 'green' },
  INACTIVE: { text: '流失', color: 'default' },
};

const CustomerPage: React.FC = () => {
  const [data, setData] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'create' | 'edit'>('create');
  const [currentCustomer, setCurrentCustomer] = useState<Customer | null>(null);
  const [form] = Form.useForm();
  const [detailVisible, setDetailVisible] = useState(false);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    fetchData();
  }, [pagination.current, pagination.pageSize]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = {
        page: pagination.current,
        pageSize: pagination.pageSize,
      };
      if (searchKeyword) params.keyword = searchKeyword;
      if (searchStatus) params.status = searchStatus;

      const res: any = await customerApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (customer: Customer) => {
    setCurrentCustomer(customer);
    try {
      const [contractsRes, casesRes, paymentsRes]: any = await Promise.all([
        customerApi.contracts(customer.id),
        customerApi.cases(customer.id),
        customerApi.payments(customer.id),
      ]);
      if (contractsRes.code === 200) setContracts(contractsRes.data);
      if (casesRes.code === 200) setCases(casesRes.data);
      if (paymentsRes.code === 200) setPayments(paymentsRes.data);
    } catch (e) {}
  };

  const handleSearch = () => {
    setPagination({ ...pagination, current: 1 });
    fetchData();
  };

  const handleReset = () => {
    setSearchKeyword('');
    setSearchStatus('');
    setPagination({ ...pagination, current: 1 });
    fetchData();
  };

  const handleCreate = () => {
    setModalType('create');
    setCurrentCustomer(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (record: Customer) => {
    setModalType('edit');
    setCurrentCustomer(record);
    form.setFieldsValue({
      ...record,
      tags: record.tags ? JSON.parse(record.tags).join(',') : '',
    });
    setModalVisible(true);
  };

  const handleSubmit = async (values: any) => {
    try {
      const data = {
        ...values,
        tags: values.tags ? JSON.stringify(values.tags.split(',').map((t: string) => t.trim())) : undefined,
      };
      if (modalType === 'create') {
        await customerApi.create(data);
        message.success('创建成功');
      } else {
        await customerApi.update(currentCustomer!.id, data);
        message.success('更新成功');
      }
      setModalVisible(false);
      fetchData();
    } catch (e) {}
  };

  const handleDelete = async (id: string) => {
    try {
      await customerApi.delete(id);
      message.success('删除成功');
      fetchData();
    } catch (e) {}
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    { title: '微信', dataIndex: 'wechat', key: 'wechat', render: (v: string) => v || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const config = statusMap[status] || { text: status, color: 'default' };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      render: (tags: string) => {
        if (!tags) return '-';
        try {
          const arr = JSON.parse(tags);
          return arr.map((tag: string) => <Tag key={tag}>{tag}</Tag>);
        } catch {
          return tags;
        }
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Customer) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { fetchDetail(record); setDetailVisible(true); }}>
            详情
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <Space>
              <Input
                placeholder="搜索姓名/电话"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onPressEnter={handleSearch}
                prefix={<SearchOutlined />}
                style={{ width: 200 }}
              />
              <Select
                placeholder="状态筛选"
                value={searchStatus || undefined}
                onChange={setSearchStatus}
                style={{ width: 150 }}
                allowClear
              >
                {Object.entries(statusMap).map(([key, config]) => (
                  <Option key={key} value={key}>{config.text}</Option>
                ))}
              </Select>
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
                搜索
              </Button>
              <Button icon={<SyncOutlined />} onClick={handleReset}>
                重置
              </Button>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新建客户
            </Button>
          </Col>
        </Row>
      </Card>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{
          ...pagination,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => setPagination({ ...pagination, current: page, pageSize: pageSize || 10 }),
        }}
      />

      {/* 新建/编辑弹窗 */}
      <Modal
        title={modalType === 'create' ? '新建客户' : '编辑客户'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="电话" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="wechat" label="微信">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="POTENTIAL">
            <Select>
              {Object.entries(statusMap).map(([key, config]) => (
                <Option key={key} value={key}>{config.text}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input placeholder="多个标签用逗号分隔" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情抽屉 */}
      <Drawer
        title="客户详情"
        width={700}
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
      >
        {currentCustomer && (
          <div>
            <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={8}><strong>姓名：</strong>{currentCustomer.name}</Col>
                <Col span={8}><strong>电话：</strong>{currentCustomer.phone}</Col>
                <Col span={8}><strong>微信：</strong>{currentCustomer.wechat || '-'}</Col>
                <Col span={8}><strong>邮箱：</strong>{currentCustomer.email || '-'}</Col>
                <Col span={8}><strong>状态：</strong><Tag color={statusMap[currentCustomer.status]?.color}>{statusMap[currentCustomer.status]?.text}</Tag></Col>
                <Col span={8}><strong>创建时间：</strong>{dayjs(currentCustomer.createdAt).format('YYYY-MM-DD')}</Col>
              </Row>
            </Card>

            <Tabs defaultActiveKey="contracts">
              <TabPane tab={`合同 (${contracts.length})`} key="contracts">
                <List
                  size="small"
                  dataSource={contracts}
                  renderItem={(item) => (
                    <List.Item>
                      <div>
                        <div><strong>{item.contractNo}</strong> {item.title}</div>
                        <div style={{ color: '#999', fontSize: 12 }}>金额：¥{item.amount} | 状态：<Tag>{item.status}</Tag></div>
                      </div>
                    </List.Item>
                  )}
                  locale={{ emptyText: '暂无合同' }}
                />
              </TabPane>
              <TabPane tab={`案件 (${cases.length})`} key="cases">
                <List
                  size="small"
                  dataSource={cases}
                  renderItem={(item) => (
                    <List.Item>
                      <div>
                        <div><strong>{item.caseNo}</strong> {item.title}</div>
                        <div style={{ color: '#999', fontSize: 12 }}>类型：{item.caseType} | 状态：<Tag>{item.status}</Tag></div>
                      </div>
                    </List.Item>
                  )}
                  locale={{ emptyText: '暂无案件' }}
                />
              </TabPane>
              <TabPane tab={`收款 (${payments.length})`} key="payments">
                <List
                  size="small"
                  dataSource={payments}
                  renderItem={(item) => (
                    <List.Item>
                      <div>
                        <div>¥{item.amount}</div>
                        <div style={{ color: '#999', fontSize: 12 }}>状态：<Tag>{item.status}</Tag> | 应收日期：{item.dueDate ? dayjs(item.dueDate).format('YYYY-MM-DD') : '-'}</div>
                      </div>
                    </List.Item>
                  )}
                  locale={{ emptyText: '暂无收款记录' }}
                />
              </TabPane>
            </Tabs>
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default CustomerPage;
