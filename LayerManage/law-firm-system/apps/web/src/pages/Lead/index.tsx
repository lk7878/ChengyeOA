import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Select, Tag, Space, Modal, Form, message,
  Drawer, Popconfirm, DatePicker, InputNumber, Card, Row, Col
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EyeOutlined, EditOutlined,
  DeleteOutlined, UserAddOutlined, MessageOutlined, SyncOutlined,
  RedoOutlined, ArrowRightOutlined
} from '@ant-design/icons';
import { leadApi } from '@/api/business';
import { employeeApi } from '@/api/organization';
import type { Lead, Employee } from '@/types';
import dayjs, { type Dayjs } from 'dayjs';

const { Option } = Select;

type LeadFormValues = Partial<Lead> & { tags?: string };
type LeadAssignmentValues = { employeeId: string };
type LeadFollowValues = {
  type: string;
  content: string;
  nextPlan?: string;
  nextTime?: Dayjs;
};

const statusMap: Record<string, { text: string; color: string }> = {
  NEW: { text: '新线索', color: 'blue' },
  CONTACTED: { text: '已联系', color: 'cyan' },
  SCREENED: { text: '已筛选', color: 'geekblue' },
  INVITED: { text: '已邀约', color: 'purple' },
  VISITED: { text: '已到访', color: 'magenta' },
  NEGOTIATING: { text: '洽谈中', color: 'orange' },
  QUOTED: { text: '已报价', color: 'gold' },
  SIGNED: { text: '已签约', color: 'green' },
  LOST: { text: '已流失', color: 'default' },
};

const LeadPage: React.FC = () => {
  const [data, setData] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'create' | 'edit'>('create');
  const [currentLead, setCurrentLead] = useState<Lead | null>(null);
  const [form] = Form.useForm();
  const [detailVisible, setDetailVisible] = useState(false);
  const [followVisible, setFollowVisible] = useState(false);
  const [followForm] = Form.useForm();
  const [assignVisible, setAssignVisible] = useState(false);
  const [assignForm] = Form.useForm();

  useEffect(() => {
    fetchData();
    fetchEmployees();
  }, [pagination.current, pagination.pageSize]);

  async function fetchData() {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean | undefined> = {
        page: pagination.current,
        pageSize: pagination.pageSize,
      };
      if (searchKeyword) params.keyword = searchKeyword;
      if (searchStatus) params.status = searchStatus;

      const res = await leadApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
      }
    } finally {
      setLoading(false);
    }
  };

  async function fetchEmployees() {
    try {
      const res = await employeeApi.list({ pageSize: 100 });
      if (res.code === 200) setEmployees(res.data.list);
    } catch { /* Request errors are handled by the shared interceptor. */ }
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
    setCurrentLead(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (record: Lead) => {
    setModalType('edit');
    setCurrentLead(record);
    form.setFieldsValue({
      ...record,
      tags: record.tags ? JSON.parse(record.tags).join(',') : '',
    });
    setModalVisible(true);
  };

  const handleSubmit = async (values: LeadFormValues) => {
    try {
      const data = {
        ...values,
        tags: values.tags ? JSON.stringify(values.tags.split(',').map((t: string) => t.trim())) : undefined,
      };
      if (modalType === 'create') {
        await leadApi.create(data);
        message.success('创建成功');
      } else {
        await leadApi.update(currentLead!.id, data);
        message.success('更新成功');
      }
      setModalVisible(false);
      fetchData();
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const handleDelete = async (id: string) => {
    try {
      await leadApi.delete(id);
      message.success('删除成功');
      fetchData();
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const handleAssign = (record: Lead) => {
    setCurrentLead(record);
    assignForm.resetFields();
    setAssignVisible(true);
  };

  const handleAssignSubmit = async (values: LeadAssignmentValues) => {
    try {
      await leadApi.assign(currentLead!.id, values.employeeId);
      message.success('分配成功');
      setAssignVisible(false);
      fetchData();
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const handleFollow = (record: Lead) => {
    setCurrentLead(record);
    followForm.resetFields();
    setFollowVisible(true);
  };

  const handleFollowSubmit = async (values: LeadFollowValues) => {
    try {
      await leadApi.follow(currentLead!.id, {
        ...values,
        nextTime: values.nextTime ? values.nextTime.format() : undefined,
      });
      message.success('跟进记录添加成功');
      setFollowVisible(false);
      fetchData();
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const handleConvert = async (record: Lead) => {
    Modal.confirm({
      title: '确认转客户',
      content: `确定将线索 "${record.name}" 转为客户吗？`,
      onOk: async () => {
        try {
          await leadApi.convert(record.id);
          message.success('转客户成功');
          fetchData();
        } catch { /* Request errors are handled by the shared interceptor. */ }
      },
    });
  };

  const handleRecycle = async (record: Lead) => {
    try {
      await leadApi.recycle(record.id);
      message.success('回收成功');
      fetchData();
    } catch { /* Request errors are handled by the shared interceptor. */ }
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    {
      title: '意向等级',
      dataIndex: 'intentionLevel',
      key: 'intentionLevel',
      render: (level: number) => (
        <Tag color={level >= 4 ? 'red' : level >= 3 ? 'orange' : 'default'}>
          {'★'.repeat(level)}{'☆'.repeat(5 - level)}
        </Tag>
      ),
    },
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
      title: '负责人',
      dataIndex: 'assignee',
      key: 'assignee',
      render: (assignee: Employee) => assignee?.name || '-',
    },
    {
      title: '渠道',
      dataIndex: 'channel',
      key: 'channel',
      render: (channel: Lead['channel']) => channel?.name || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: unknown, record: Lead) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setCurrentLead(record); setDetailVisible(true); }}>
            查看
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Button type="link" size="small" icon={<MessageOutlined />} onClick={() => handleFollow(record)}>
            跟进
          </Button>
          {!record.assignedTo && (
            <Button type="link" size="small" icon={<UserAddOutlined />} onClick={() => handleAssign(record)}>
              分配
            </Button>
          )}
          {record.status !== 'SIGNED' && (
            <Button type="link" size="small" icon={<ArrowRightOutlined />} onClick={() => handleConvert(record)}>
              转客户
            </Button>
          )}
          {record.assignedTo && (
            <Button type="link" size="small" icon={<RedoOutlined />} onClick={() => handleRecycle(record)}>
              回收
            </Button>
          )}
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
              新建线索
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
        title={modalType === 'create' ? '新建线索' : '编辑线索'}
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
          <Form.Item name="intentionLevel" label="意向等级" initialValue={3}>
            <InputNumber min={1} max={5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="sourceDetail" label="来源详情">
            <Input placeholder="如：百度推广-关键词XX" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input placeholder="多个标签用逗号分隔" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 分配弹窗 */}
      <Modal
        title="分配负责人"
        open={assignVisible}
        onCancel={() => setAssignVisible(false)}
        onOk={() => assignForm.submit()}
      >
        <Form form={assignForm} onFinish={handleAssignSubmit}>
          <Form.Item name="employeeId" label="负责人" rules={[{ required: true }]}>
            <Select placeholder="选择负责人">
              {employees.map((emp) => (
                <Option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeNo})</Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 跟进弹窗 */}
      <Modal
        title="添加跟进记录"
        open={followVisible}
        onCancel={() => setFollowVisible(false)}
        onOk={() => followForm.submit()}
        width={600}
      >
        <Form form={followForm} layout="vertical" onFinish={handleFollowSubmit}>
          <Form.Item name="type" label="跟进方式" rules={[{ required: true }]} initialValue="PHONE">
            <Select>
              <Option value="PHONE">电话</Option>
              <Option value="WECHAT">微信</Option>
              <Option value="VISIT">到访</Option>
              <Option value="ONLINE">线上</Option>
              <Option value="OTHER">其他</Option>
            </Select>
          </Form.Item>
          <Form.Item name="content" label="跟进内容" rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="nextPlan" label="下次计划">
            <Input />
          </Form.Item>
          <Form.Item name="nextTime" label="下次跟进时间">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情抽屉 */}
      <Drawer
        title="线索详情"
        width={600}
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
      >
        {currentLead && (
          <div>
            <p><strong>姓名：</strong>{currentLead.name}</p>
            <p><strong>电话：</strong>{currentLead.phone}</p>
            <p><strong>微信：</strong>{currentLead.wechat || '-'}</p>
            <p><strong>意向等级：</strong>{'★'.repeat(currentLead.intentionLevel)}</p>
            <p><strong>状态：</strong>{statusMap[currentLead.status]?.text || currentLead.status}</p>
            <p><strong>负责人：</strong>{currentLead.assignee?.name || '-'}</p>
            <p><strong>来源：</strong>{currentLead.sourceDetail || '-'}</p>
            <p><strong>标签：</strong>{currentLead.tags ? JSON.parse(currentLead.tags).join(', ') : '-'}</p>
            <p><strong>创建时间：</strong>{dayjs(currentLead.createdAt).format('YYYY-MM-DD HH:mm')}</p>

            {currentLead.followRecords && currentLead.followRecords.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h4>跟进记录</h4>
                {currentLead.followRecords.map((follow) => (
                  <Card key={follow.id} size="small" style={{ marginBottom: 8 }}>
                    <p><Tag>{follow.type}</Tag> {dayjs(follow.createdAt).format('MM-DD HH:mm')}</p>
                    <p>{follow.content}</p>
                    {follow.nextPlan && <p style={{ color: '#999' }}>下次计划：{follow.nextPlan}</p>}
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default LeadPage;
