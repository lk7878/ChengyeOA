import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Timeline,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckOutlined,
  MessageOutlined,
  RedoOutlined,
  SwapOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router';
import dayjs, { type Dayjs } from 'dayjs';
import { useLeadStore } from '@/stores/lead-store';
import { masterDataApi } from '@/api/organization';
import {
  APPOINTMENT_CHANNELS,
  LEAD_FOLLOW_TYPES,
  LEAD_STATUSES,
  CUSTOMER_TYPES,
  type AppointmentChannel,
  type AppointmentView,
  type ConvertLeadInput,
  type LeadFollowType,
  type LeadStatus,
} from '@/api/types';
import {
  APPOINTMENT_CHANNEL_META,
  APPOINTMENT_STATUS_META,
  CUSTOMER_TYPE_META,
  FOLLOW_TYPE_META,
  LEAD_STATUS_META,
  POOL_STATUS_META,
  SOURCE_TYPE_META,
  intentionStars,
} from './meta';

interface EmployeeOption {
  id: string;
  name: string;
  employeeNo: string;
}

const LeadDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const {
    detail,
    fetchLeadDetail, resetDetail,
    addFollow, transitionLead, assignLead, recycleLead, convertLead,
    createAppointment, visitAppointment, rescheduleAppointment,
  } = useLeadStore();
  const { lead, follows, appointments, loading, error } = detail;

  const [followOpen, setFollowOpen] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<AppointmentView | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [followForm] = Form.useForm();
  const [transitionForm] = Form.useForm();
  const [assignForm] = Form.useForm();
  const [recycleForm] = Form.useForm();
  const [convertForm] = Form.useForm();
  const [appointmentForm] = Form.useForm();
  const [rescheduleForm] = Form.useForm();

  useEffect(() => {
    if (id) void fetchLeadDetail(id);
    return () => resetDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadEmployees = async () => {
    if (employees.length > 0) return;
    try {
      const res = await masterDataApi.employees.list({ pageSize: 100 });
      setEmployees(res.data.list.map(item => ({ id: item.id, name: item.name, employeeNo: item.employeeNo })));
    } catch { /* 拦截器已提示；员工下拉保持空。 */ }
  };

  const runSubmit = async (action: () => Promise<boolean>, close: () => void, successText: string) => {
    setSubmitting(true);
    try {
      const ok = await action();
      if (ok) {
        message.success(successText);
        close();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openConvert = () => {
    if (!lead) return;
    // 脱敏掩码不得回填为明文；掩码值留空由录入人补齐。
    const unmasked = (value: string | null) => (value && !value.includes('*') ? value : undefined);
    convertForm.setFieldsValue({
      customer: {
        name: lead.name,
        phone: unmasked(lead.phone),
        wechat: unmasked(lead.wechat),
        customerType: 'INDIVIDUAL',
      },
      contact: {
        name: lead.name,
        phone: unmasked(lead.phone),
        wechat: unmasked(lead.wechat),
        isPrimary: true,
      },
    });
    setConvertOpen(true);
  };

  const handleConvert = async (values: ConvertLeadInput) => {
    setSubmitting(true);
    try {
      const customer = await convertLead(id, values);
      if (customer) {
        message.success('转客户成功');
        setConvertOpen(false);
        navigate(`/customers/${customer.id}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !lead) {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: 320 }}><Spin size="large" /></div>;
  }

  if (error && !lead) {
    return (
      <Alert
        role="alert"
        type="error"
        showIcon
        message="线索详情加载失败"
        description={error}
        action={<Button onClick={() => void fetchLeadDetail(id)}>重试</Button>}
      />
    );
  }

  if (!lead) return null;

  const statusMeta = LEAD_STATUS_META[lead.status] ?? { text: lead.status, color: 'default' };
  const poolMeta = POOL_STATUS_META[lead.poolStatus] ?? { text: lead.poolStatus, color: 'default' };
  const isActionable = lead.status !== 'CONVERTED' && lead.status !== 'LOST';

  return (
    <div>
      <Card
        title={
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
            <span>{lead.name}</span>
            <Tag color={statusMeta.color}>{statusMeta.text}</Tag>
            <Tag color={poolMeta.color}>{poolMeta.text}</Tag>
            <span style={{ color: '#999', fontSize: 13 }}>{lead.leadNo}</span>
          </Space>
        }
        extra={
          <Space wrap>
            <Button icon={<MessageOutlined />} onClick={() => setFollowOpen(true)}>添加跟进</Button>
            {isActionable && (
              <>
                <Button icon={<SwapOutlined />} onClick={() => setTransitionOpen(true)}>状态流转</Button>
                <Button icon={<UserAddOutlined />} onClick={() => { void loadEmployees(); setAssignOpen(true); }}>
                  {lead.assignedTo ? '改派' : '分配'}
                </Button>
                {lead.poolStatus === 'PRIVATE' && (
                  <Button icon={<RedoOutlined />} onClick={() => setRecycleOpen(true)}>回收</Button>
                )}
                <Button icon={<CalendarOutlined />} onClick={() => { void loadEmployees(); setAppointmentOpen(true); }}>
                  发起邀约
                </Button>
                <Button type="primary" icon={<CheckOutlined />} onClick={openConvert}>转客户</Button>
              </>
            )}
          </Space>
        }
        style={{ marginBottom: 16 }}
      />

      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          {/* L3 字段原样渲染服务端掩码，不做还原。 */}
          <Descriptions.Item label="电话">{lead.phone ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="微信">{lead.wechat ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="意向等级">{intentionStars(lead.intentionLevel)}</Descriptions.Item>
          <Descriptions.Item label="来源类型">
            {SOURCE_TYPE_META[lead.sourceType as keyof typeof SOURCE_TYPE_META] ?? lead.sourceType}
          </Descriptions.Item>
          <Descriptions.Item label="来源详情">{lead.sourceDetail ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="负责人">{lead.assignedTo ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="分配时间">
            {lead.assignedAt ? dayjs(lead.assignedAt).format('YYYY-MM-DD HH:mm') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="首响时长">
            {lead.firstResponseSeconds !== null ? `${lead.firstResponseSeconds} 秒` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="标签">{lead.tags ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{dayjs(lead.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={`跟进时间线（${follows.length}）`}>
            {follows.length === 0 ? (
              <span style={{ color: '#999' }}>暂无跟进记录</span>
            ) : (
              <Timeline
                items={follows.map(follow => ({
                  key: follow.id,
                  children: (
                    <div>
                      <Space size="small" wrap>
                        <Tag>{FOLLOW_TYPE_META[follow.type as LeadFollowType] ?? follow.type}</Tag>
                        <span style={{ color: '#999', fontSize: 12 }}>
                          {dayjs(follow.createdAt).format('YYYY-MM-DD HH:mm')}
                        </span>
                      </Space>
                      <div style={{ marginTop: 4 }}>{follow.content}</div>
                      {follow.nextPlan && (
                        <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                          下次计划：{follow.nextPlan}
                          {follow.nextTime ? `（${dayjs(follow.nextTime).format('MM-DD HH:mm')}）` : ''}
                        </div>
                      )}
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={`邀约到访（${appointments.length}）`}>
            <List
              dataSource={appointments}
              locale={{ emptyText: '暂无邀约记录' }}
              renderItem={item => {
                const meta = APPOINTMENT_STATUS_META[item.status] ?? { text: item.status, color: 'default' };
                const active = item.status === 'PENDING' || item.status === 'CONFIRMED';
                return (
                  <List.Item
                    actions={active ? [
                      <Popconfirm
                        key="visit"
                        title="确认客户已到访？"
                        okText="确定"
                        cancelText="取消"
                        onConfirm={() => void visitAppointment(item.id).then(ok => ok && message.success('已确认到访'))}
                      >
                        <Button type="link" size="small">确认到访</Button>
                      </Popconfirm>,
                      <Button key="reschedule" type="link" size="small" onClick={() => setRescheduleTarget(item)}>
                        改期
                      </Button>,
                    ] : undefined}
                  >
                    <List.Item.Meta
                      title={
                        <Space size="small" wrap>
                          <span>{dayjs(item.scheduledAt).format('YYYY-MM-DD HH:mm')}</span>
                          <Tag>{APPOINTMENT_CHANNEL_META[item.channel as AppointmentChannel] ?? item.channel}</Tag>
                          <Tag color={meta.color}>{meta.text}</Tag>
                        </Space>
                      }
                      description={
                        <span>
                          {item.appointmentNo}
                          {item.remark ? ` · ${item.remark}` : ''}
                        </span>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* 添加跟进 */}
      <Modal
        title="添加跟进记录"
        open={followOpen}
        onCancel={() => setFollowOpen(false)}
        onOk={() => followForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form
          form={followForm}
          layout="vertical"
          onFinish={values => void runSubmit(
            () => addFollow(id, {
              type: values.type as LeadFollowType,
              content: values.content as string,
              nextPlan: values.nextPlan as string | undefined,
              nextTime: values.nextTime ? (values.nextTime as Dayjs).toISOString() : undefined,
            }),
            () => { setFollowOpen(false); followForm.resetFields(); },
            '跟进记录已添加',
          )}
        >
          <Form.Item name="type" label="跟进方式" initialValue="PHONE" rules={[{ required: true }]}>
            <Select options={LEAD_FOLLOW_TYPES.map(value => ({ value, label: FOLLOW_TYPE_META[value] }))} />
          </Form.Item>
          <Form.Item name="content" label="跟进内容" rules={[{ required: true, message: '请输入跟进内容' }]}>
            <Input.TextArea rows={4} maxLength={1000} />
          </Form.Item>
          <Form.Item name="nextPlan" label="下次计划">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="nextTime" label="下次跟进时间">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 状态流转 */}
      <Modal
        title="状态流转"
        open={transitionOpen}
        onCancel={() => setTransitionOpen(false)}
        onOk={() => transitionForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form
          form={transitionForm}
          layout="vertical"
          onFinish={values => void runSubmit(
            () => transitionLead(id, {
              targetStatus: values.targetStatus as LeadStatus,
              reason: values.reason as string,
            }),
            () => { setTransitionOpen(false); transitionForm.resetFields(); },
            '状态已流转',
          )}
        >
          <Form.Item name="targetStatus" label="目标状态" rules={[{ required: true, message: '请选择目标状态' }]}>
            <Select
              options={LEAD_STATUSES
                .filter(value => value !== lead.status)
                .map(value => ({ value, label: LEAD_STATUS_META[value].text }))}
            />
          </Form.Item>
          <Form.Item name="reason" label="流转原因" rules={[{ required: true, message: '请输入流转原因' }]}>
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 分配/改派 */}
      <Modal
        title={lead.assignedTo ? '改派负责人' : '分配负责人'}
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        onOk={() => assignForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form
          form={assignForm}
          layout="vertical"
          onFinish={values => void runSubmit(
            () => assignLead(id, {
              toEmployeeId: values.toEmployeeId as string,
              reason: values.reason as string | undefined,
            }),
            () => { setAssignOpen(false); assignForm.resetFields(); },
            '分配成功',
          )}
        >
          <Form.Item name="toEmployeeId" label="负责人" rules={[{ required: true, message: '请选择负责人' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择负责人"
              options={employees.map(employee => ({
                value: employee.id,
                label: `${employee.name}（${employee.employeeNo}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="reason" label="分配说明">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 回收 */}
      <Modal
        title="回收线索"
        open={recycleOpen}
        onCancel={() => setRecycleOpen(false)}
        onOk={() => recycleForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form
          form={recycleForm}
          layout="vertical"
          onFinish={values => void runSubmit(
            () => recycleLead(id, values.reason as string | undefined),
            () => { setRecycleOpen(false); recycleForm.resetFields(); },
            '已回收至回收池',
          )}
        >
          <Form.Item name="reason" label="回收原因">
            <Input.TextArea rows={3} maxLength={500} placeholder="选填" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 转客户 */}
      <Modal
        title="线索转客户"
        open={convertOpen}
        onCancel={() => setConvertOpen(false)}
        onOk={() => convertForm.submit()}
        confirmLoading={submitting}
        width={640}
        destroyOnHidden
      >
        <Form form={convertForm} layout="vertical" onFinish={values => void handleConvert(values as ConvertLeadInput)}>
          <Card size="small" title="客户信息" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item name={['customer', 'name']} label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                  <Input maxLength={50} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={['customer', 'phone']} label="电话" rules={[{ required: true, message: '请输入电话' }]}>
                  <Input maxLength={20} placeholder="脱敏值需补录明文" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={['customer', 'wechat']} label="微信">
                  <Input maxLength={50} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={['customer', 'customerType']} label="客户类型" initialValue="INDIVIDUAL">
                  <Select options={CUSTOMER_TYPES.map(value => ({ value, label: CUSTOMER_TYPE_META[value] }))} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={['customer', 'email']} label="邮箱">
                  <Input maxLength={100} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={['customer', 'address']} label="地址">
                  <Input maxLength={200} />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name={['customer', 'remark']} label="备注">
                  <Input.TextArea rows={2} maxLength={500} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Card size="small" title="首要联系人">
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item name={['contact', 'name']} label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                  <Input maxLength={50} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={['contact', 'phone']} label="电话" rules={[{ required: true, message: '请输入电话' }]}>
                  <Input maxLength={20} placeholder="脱敏值需补录明文" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={['contact', 'wechat']} label="微信">
                  <Input maxLength={50} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={['contact', 'relation']} label="关系">
                  <Input maxLength={50} placeholder="如：本人/配偶/助理" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={['contact', 'isPrimary']} label="首要联系人" valuePropName="checked" initialValue>
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        </Form>
      </Modal>

      {/* 发起邀约 */}
      <Modal
        title="发起邀约"
        open={appointmentOpen}
        onCancel={() => setAppointmentOpen(false)}
        onOk={() => appointmentForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form
          form={appointmentForm}
          layout="vertical"
          onFinish={values => void runSubmit(
            () => createAppointment({
              leadId: id,
              scheduledAt: (values.scheduledAt as Dayjs).toISOString(),
              channel: values.channel as AppointmentChannel,
              negotiatorEmployeeId: values.negotiatorEmployeeId as string | undefined,
              remark: values.remark as string | undefined,
            }),
            () => { setAppointmentOpen(false); appointmentForm.resetFields(); },
            '邀约已创建',
          )}
        >
          <Form.Item name="scheduledAt" label="邀约时间" rules={[{ required: true, message: '请选择邀约时间' }]}>
            <DatePicker showTime style={{ width: '100%' }} placeholder="选择邀约时间" />
          </Form.Item>
          <Form.Item name="channel" label="邀约方式" initialValue="ONSITE" rules={[{ required: true }]}>
            <Select options={APPOINTMENT_CHANNELS.map(value => ({ value, label: APPOINTMENT_CHANNEL_META[value] }))} />
          </Form.Item>
          <Form.Item name="negotiatorEmployeeId" label="谈案人">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选填"
              options={employees.map(employee => ({
                value: employee.id,
                label: `${employee.name}（${employee.employeeNo}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 改期 */}
      <Modal
        title="邀约改期"
        open={rescheduleTarget !== null}
        onCancel={() => setRescheduleTarget(null)}
        onOk={() => rescheduleForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form
          form={rescheduleForm}
          layout="vertical"
          onFinish={values => void runSubmit(
            () => rescheduleAppointment(rescheduleTarget!.id, (values.scheduledAt as Dayjs).toISOString()),
            () => { setRescheduleTarget(null); rescheduleForm.resetFields(); },
            '已改期',
          )}
        >
          <Form.Item name="scheduledAt" label="新的邀约时间" rules={[{ required: true, message: '请选择新的邀约时间' }]}>
            <DatePicker showTime style={{ width: '100%' }} placeholder="选择新的邀约时间" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default LeadDetailPage;
