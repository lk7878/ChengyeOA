import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Select, Tag, Space, Modal, Form, message,
  Drawer, Popconfirm, Card, Row, Col, Timeline, List
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EyeOutlined,
  DeleteOutlined, SyncOutlined, CheckCircleOutlined,
  MessageOutlined, CheckSquareOutlined
} from '@ant-design/icons';
import { caseApi } from '@/api/business';
import type { Case, CaseTask, Communication } from '@/types';
import dayjs from 'dayjs';

const { Option } = Select;

const statusMap: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待受理', color: 'blue' },
  ACCEPTED: { text: '已受理', color: 'cyan' },
  PROCESSING: { text: '办理中', color: 'orange' },
  CLOSED: { text: '已结案', color: 'green' },
  ARCHIVED: { text: '已归档', color: 'default' },
};

const priorityMap: Record<string, { text: string; color: string }> = {
  LOW: { text: '低', color: 'default' },
  NORMAL: { text: '普通', color: 'blue' },
  HIGH: { text: '高', color: 'orange' },
  URGENT: { text: '紧急', color: 'red' },
};

const CasePage: React.FC = () => {
  const [data, setData] = useState<Case[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentCase, setCurrentCase] = useState<Case | null>(null);
  const [taskModal, setTaskModal] = useState(false);
  const [taskForm] = Form.useForm();
  const [commModal, setCommModal] = useState(false);
  const [commForm] = Form.useForm();
  const [closeModal, setCloseModal] = useState(false);
  const [closeForm] = Form.useForm();

  useEffect(() => { fetchData(); }, [pagination.current, pagination.pageSize]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = { page: pagination.current, pageSize: pagination.pageSize };
      if (searchKeyword) params.keyword = searchKeyword;
      const res: any = await caseApi.list(params);
      if (res.code === 200) {
        setData(res.data.list);
        setPagination({ ...pagination, total: res.data.pagination.total });
      }
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try { await caseApi.delete(id); message.success('删除成功'); fetchData(); } catch (e) {}
  };

  const columns = [
    { title: '案件编号', dataIndex: 'caseNo', key: 'caseNo' },
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: '客户', dataIndex: 'customer', key: 'customer', render: (c: any) => c?.name || '-' },
    { title: '主办律师', dataIndex: 'lawyer', key: 'lawyer', render: (l: any) => l?.name || '-' },
    { title: '案由', dataIndex: 'caseType', key: 'caseType' },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      render: (p: string) => <Tag color={priorityMap[p]?.color}>{priorityMap[p]?.text}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.text}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: any, record: Case) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setCurrentCase(record); setDetailVisible(true); }}>详情</Button>
          <Button type="link" size="small" icon={<CheckSquareOutlined />} onClick={() => { setCurrentCase(record); taskForm.resetFields(); setTaskModal(true); }}>任务</Button>
          <Button type="link" size="small" icon={<MessageOutlined />} onClick={() => { setCurrentCase(record); commForm.resetFields(); setCommModal(true); }}>沟通</Button>
          {record.status !== 'CLOSED' && record.status !== 'ARCHIVED' && (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => { setCurrentCase(record); closeForm.resetFields(); setCloseModal(true); }}>结案</Button>
          )}
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
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
              <Input placeholder="搜索编号/标题/案由" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} onPressEnter={fetchData} prefix={<SearchOutlined />} style={{ width: 250 }} />
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchData}>搜索</Button>
              <Button icon={<SyncOutlined />} onClick={() => { setSearchKeyword(''); fetchData(); }}>重置</Button>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalVisible(true); }}>新建案件</Button>
          </Col>
        </Row>
      </Card>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
        pagination={{ ...pagination, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => setPagination({ ...pagination, current: p, pageSize: ps || 10 }) }} />

      {/* 新建 */}
      <Modal title="新建案件" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()} width={700}>
        <Form form={form} layout="vertical" onFinish={async (v) => { await caseApi.create(v); message.success('创建成功'); setModalVisible(false); fetchData(); }}>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="caseNo" label="案件编号" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="customerId" label="客户ID" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="lawyerId" label="主办律师ID" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="caseType" label="案由" rules={[{ required: true }]}><Input placeholder="如：离婚纠纷" /></Form.Item></Col>
            <Col span={12}><Form.Item name="priority" label="优先级" initialValue="NORMAL">
              <Select>{Object.entries(priorityMap).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}</Select>
            </Form.Item></Col>
          </Row>
          <Form.Item name="description" label="案情描述"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>

      {/* 详情 */}
      <Drawer title="案件详情" width={700} open={detailVisible} onClose={() => setDetailVisible(false)}>
        {currentCase && (
          <div>
            <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={8}><strong>编号：</strong>{currentCase.caseNo}</Col>
                <Col span={16}><strong>标题：</strong>{currentCase.title}</Col>
                <Col span={8}><strong>客户：</strong>{currentCase.customer?.name || '-'}</Col>
                <Col span={8}><strong>律师：</strong>{currentCase.lawyer?.name || '-'}</Col>
                <Col span={8}><strong>案由：</strong>{currentCase.caseType}</Col>
                <Col span={8}><strong>优先级：</strong><Tag color={priorityMap[currentCase.priority]?.color}>{priorityMap[currentCase.priority]?.text}</Tag></Col>
                <Col span={8}><strong>状态：</strong><Tag color={statusMap[currentCase.status]?.color}>{statusMap[currentCase.status]?.text}</Tag></Col>
                <Col span={8}><strong>费用：</strong>¥{currentCase.fee}</Col>
              </Row>
            </Card>

            <Card size="small" title="任务进度" style={{ marginBottom: 16 }}>
              {currentCase.tasks && currentCase.tasks.length > 0 ? (
                <Timeline>
                  {currentCase.tasks.map((task: CaseTask) => (
                    <Timeline.Item key={task.id} color={task.status === 'COMPLETED' ? 'green' : task.status === 'OVERDUE' ? 'red' : 'blue'}>
                      <p><strong>{task.name}</strong> <Tag>{task.nodeType}</Tag></p>
                      <p style={{ color: '#999', fontSize: 12 }}>截止：{task.dueDate ? dayjs(task.dueDate).format('YYYY-MM-DD') : '无'}</p>
                    </Timeline.Item>
                  ))}
                </Timeline>
              ) : <p style={{ color: '#999' }}>暂无任务</p>}
            </Card>

            <Card size="small" title="沟通记录">
              {currentCase.communications && currentCase.communications.length > 0 ? (
                <List size="small" dataSource={currentCase.communications} renderItem={(comm: Communication) => (
                  <List.Item>
                    <div>
                      <Tag>{comm.type}</Tag> {comm.isKey && <Tag color="red">关键</Tag>}
                      <p>{comm.content}</p>
                      <p style={{ color: '#999', fontSize: 12 }}>{dayjs(comm.createdAt).format('YYYY-MM-DD HH:mm')}</p>
                    </div>
                  </List.Item>
                )} />
              ) : <p style={{ color: '#999' }}>暂无沟通记录</p>}
            </Card>
          </div>
        )}
      </Drawer>

      {/* 添加任务 */}
      <Modal title="添加任务" open={taskModal} onCancel={() => setTaskModal(false)} onOk={() => taskForm.submit()}>
        <Form form={taskForm} onFinish={async (v) => { await caseApi.createTask(currentCase!.id, v); message.success('添加成功'); setTaskModal(false); fetchData(); }}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="nodeType" label="节点类型" rules={[{ required: true }]}>
            <Select>
              <Option value="立案准备">立案准备</Option>
              <Option value="材料收集">材料收集</Option>
              <Option value="立案提交">立案提交</Option>
              <Option value="开庭">开庭</Option>
              <Option value="文书提交">文书提交</Option>
              <Option value="裁判反馈">裁判反馈</Option>
              <Option value="执行">执行</Option>
              <Option value="结案">结案</Option>
            </Select>
          </Form.Item>
          <Form.Item name="dueDate" label="截止日期"><Input type="date" /></Form.Item>
        </Form>
      </Modal>

      {/* 添加沟通 */}
      <Modal title="添加沟通记录" open={commModal} onCancel={() => setCommModal(false)} onOk={() => commForm.submit()}>
        <Form form={commForm} onFinish={async (v) => { await caseApi.createCommunication(currentCase!.id, v); message.success('添加成功'); setCommModal(false); fetchData(); }}>
          <Form.Item name="type" label="沟通方式" rules={[{ required: true }]} initialValue="PHONE">
            <Select>
              <Option value="PHONE">电话</Option>
              <Option value="MEETING">会议</Option>
              <Option value="WECHAT">微信</Option>
              <Option value="EMAIL">邮件</Option>
              <Option value="OTHER">其他</Option>
            </Select>
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="isKey" label="关键沟通" valuePropName="checked"><input type="checkbox" /></Form.Item>
        </Form>
      </Modal>

      {/* 结案 */}
      <Modal title="结案" open={closeModal} onCancel={() => setCloseModal(false)} onOk={() => closeForm.submit()}>
        <Form form={closeForm} onFinish={async (v) => { await caseApi.close(currentCase!.id, v); message.success('结案成功'); setCloseModal(false); fetchData(); }}>
          <Form.Item name="result" label="案件结果"><Input.TextArea rows={2} placeholder="如：胜诉/调解成功/撤诉" /></Form.Item>
          <Form.Item name="satisfaction" label="满意度"><Input type="number" min={1} max={5} placeholder="1-5分" /></Form.Item>
          <Form.Item name="isReferrable" label="可转介绍" valuePropName="checked"><input type="checkbox" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CasePage;
