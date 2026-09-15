import { BusinessTableLinks } from '@/features/crm/BusinessWorkspacePage';
import { crmNameRules, phoneRules } from '@/features/crm/form-rules';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  message,
} from 'antd';
import Modal from '@/components/DraggableModal';
import { ArrowLeftOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useLocation, useNavigate, useParams } from 'react-router';
import dayjs from 'dayjs';
import { useCustomerStore } from '@/stores/customer-store';
import { useAuthStore } from '@/stores/authStore';
import { customerApi } from '@/api/customer';
import {
  CUSTOMER_TYPES,
  CUSTOMER_STATUSES,
  type ContactInput,
  type ContactView,
  type CreateReferralLeadInput,
  type CustomerType,
  type LeadView,
  type UpdateCustomerInput,
} from '@/api/types';
import { CUSTOMER_STATUS_META, CUSTOMER_TYPE_META, LEAD_STATUS_META } from '../leads/meta';
import CustomerDeleteButton from './CustomerDeleteButton';

const CustomerDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const canUpdate = useAuthStore(state => state.hasPermission('customer.update'));
  const canDelete = useAuthStore(state => state.hasPermission('customer.delete'));
  const {
    detail,
    fetchCustomerDetail, resetDetail, updateCustomer, addContact, updateContact, removeContact,
  } = useCustomerStore();
  const { customer, contacts, loading, error } = detail;

  const [editOpen, setEditOpen] = useState(false);
  const [editVersion, setEditVersion] = useState<number>();
  const [contactModal, setContactModal] = useState<{ mode: 'create' } | { mode: 'edit'; contact: ContactView } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editForm] = Form.useForm<UpdateCustomerInput>();
  const [contactForm] = Form.useForm<ContactInput>();

  // SPEC-039：转介绍登记 + 客户转介绍列表（lead.create/lead.read 门控）。
  const canCreateReferral = useAuthStore(state => state.hasPermission('lead.create'));
  const canReadReferrals = useAuthStore(state => state.hasPermission('lead.read'));
  const [referrals, setReferrals] = useState<LeadView[]>([]);
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralSubmitting, setReferralSubmitting] = useState(false);
  const [referralForm] = Form.useForm<CreateReferralLeadInput>();

  const fetchReferrals = async () => {
    if (!canReadReferrals || !id) return;
    setReferralLoading(true);
    try {
      const res = await customerApi.listReferrals(id, { page: 1, pageSize: 50 });
      setReferrals(res.data.list);
    } catch {
      // 共享拦截器已提示错误。
    } finally {
      setReferralLoading(false);
    }
  };

  useEffect(() => {
    // 转介绍列表拉取推迟到微任务：避免 effect 体内同步 setState（react-hooks/set-state-in-effect 纪律）。
    if (id) void Promise.resolve().then(() => void fetchReferrals());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const openReferral = () => {
    referralForm.resetFields();
    setReferralOpen(true);
  };

  const handleReferral = async (values: CreateReferralLeadInput) => {
    setReferralSubmitting(true);
    try {
      await customerApi.createReferral(id, values);
      message.success('转介绍线索已登记');
      setReferralOpen(false);
      void fetchReferrals();
    } catch {
      // 共享拦截器已提示错误。
    } finally {
      setReferralSubmitting(false);
    }
  };

  useEffect(() => {
    if (id) void fetchCustomerDetail(id);
    return () => resetDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const openEdit = useCallback(() => {
    if (!customer || !canUpdate) return;
    editForm.resetFields();
    editForm.setFieldsValue({
      name: customer.name,
      // 脱敏掩码不回填（提交掩码会污染数据）；保持原值则不传字段。
      phone: undefined,
      wechat: undefined,
      email: customer.email ?? undefined,
      address: customer.address ?? undefined,
      customerType: customer.customerType as CustomerType,
      status: customer.status,
      tags: customer.tags ?? undefined,
      remark: customer.remark ?? undefined,
    });
    setEditVersion(customer.version);
    setEditOpen(true);
  }, [customer, canUpdate, editForm]);

  useEffect(() => {
    if (!location.state?.editCustomer || !canUpdate || loading || customer?.id !== id) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      openEdit();
      navigate(location.pathname, { replace: true, state: null });
    });
    return () => { cancelled = true; };
  }, [location.state, location.pathname, canUpdate, loading, customer?.id, id, openEdit, navigate]);

  const handleEdit = async (values: UpdateCustomerInput) => {
    setSubmitting(true);
    try {
      // 普通可选字段可清空；脱敏字段留空则保持原值。
      const payload: UpdateCustomerInput = { version: editVersion };
      for (const [key, value] of Object.entries(values)) {
        if ((key === 'phone' || key === 'wechat') && (value === undefined || String(value).trim() === '')) continue;
        if (value !== undefined) {
          (payload as Record<string, unknown>)[key] = value;
        }
      }
      const ok = await updateCustomer(id, payload);
      if (ok) {
        message.success('已保存');
        setEditOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openCreateContact = () => {
    contactForm.resetFields();
    setContactModal({ mode: 'create' });
  };

  const openEditContact = (contact: ContactView) => {
    contactForm.setFieldsValue({
      name: contact.name,
      // 脱敏掩码不回填（phone/wechat 同规，提交掩码会污染数据）；保持原值则不传字段。
      relation: contact.relation ?? undefined,
      isPrimary: contact.isPrimary,
    });
    setContactModal({ mode: 'edit', contact });
  };

  const handleContactSubmit = async (values: ContactInput) => {
    if (!contactModal) return;
    setSubmitting(true);
    try {
      const payload: ContactInput = {};
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== '') {
          (payload as Record<string, unknown>)[key] = value;
        }
      }
      const ok = contactModal.mode === 'create'
        ? await addContact(id, payload)
        : await updateContact(id, contactModal.contact.id, payload);
      if (ok) {
        message.success(contactModal.mode === 'create' ? '联系人已添加' : '联系人已更新');
        setContactModal(null);
        contactForm.resetFields();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !customer) {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: 320 }}><Spin size="large" /></div>;
  }

  if (error && !customer) {
    return (
      <Alert
        role="alert"
        type="error"
        showIcon
        message="客户详情加载失败"
        description={error}
        action={<Button onClick={() => void fetchCustomerDetail(id)}>重试</Button>}
      />
    );
  }

  if (!customer) return null;

  const statusMeta = CUSTOMER_STATUS_META[customer.status] ?? { text: customer.status, color: 'default' };

  return (
    <div>
      <Card
        title={(
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
          <BusinessTableLinks source="CUSTOMERS" recordId={id} />
            <span>{customer.name}</span>
            <Tag color={statusMeta.color}>{statusMeta.text}</Tag>
            <span style={{ color: '#999', fontSize: 13 }}>{customer.customerNo}</span>
          </Space>
        )}
        extra={<Space>
          {canUpdate && <Button icon={<EditOutlined />} onClick={openEdit}>编辑档案</Button>}
          {canDelete && <CustomerDeleteButton customer={customer} onDeleted={() => navigate('/customers', { replace: true })} />}
        </Space>}
        style={{ marginBottom: 16 }}
      />

      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          {/* L3 字段原样渲染服务端掩码，不做还原。 */}
          <Descriptions.Item label="电话">{customer.phone ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="微信">{customer.wechat ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="类型">
            {CUSTOMER_TYPE_META[customer.customerType as CustomerType] ?? customer.customerType}
          </Descriptions.Item>
          <Descriptions.Item label="邮箱">{customer.email ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="地址">{customer.address ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="标签">{customer.tags ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="来源线索">{customer.sourceLeadId ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{dayjs(customer.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
          <Descriptions.Item label="备注">{customer.remark ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="经营分析" style={{ marginBottom: 16 }} data-testid="customer-analytics">
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="合同数">{customer.contractCount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="复购数">
            {customer.repurchaseCount ?? 0}
            {(customer.repurchaseCount ?? 0) > 0 ? <Tag color="blue" style={{ marginLeft: 8 }}>复购客户</Tag> : null}
          </Descriptions.Item>
          <Descriptions.Item label="转介绍数">{customer.referralCount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="首单时间">
            {customer.firstContractAt ? dayjs(customer.firstContractAt).format('YYYY-MM-DD') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="最近单时间">
            {customer.latestContractAt ? dayjs(customer.latestContractAt).format('YYYY-MM-DD') : '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title={`转介绍（${referrals.length}）`}
        style={{ marginBottom: 16 }}
        extra={canCreateReferral
          ? <Button type="primary" icon={<PlusOutlined />} onClick={openReferral}>登记转介绍</Button>
          : null}
      >
        <List
          size="small"
          loading={referralLoading}
          dataSource={referrals}
          locale={{ emptyText: '暂无转介绍线索' }}
          renderItem={referral => (
            <List.Item>
              <div style={{ width: '100%' }}>
                <Space wrap>
                  <Tag>{referral.leadNo}</Tag>
                  <strong>{referral.name}</strong>
                  <span style={{ color: '#999' }}>{referral.phone}</span>
                  <Tag color="purple">转介绍</Tag>
                  <Tag color={LEAD_STATUS_META[referral.status]?.color}>{LEAD_STATUS_META[referral.status]?.text ?? referral.status}</Tag>
                  <span style={{ color: '#999', fontSize: 12 }}>意向 {'★'.repeat(referral.intentionLevel) || '-'}</span>
                </Space>
                <p style={{ color: '#999', fontSize: 12, margin: 0 }}>
                  登记于 {dayjs(referral.createdAt).format('YYYY-MM-DD HH:mm')}
                </p>
              </div>
            </List.Item>
          )}
        />
      </Card>

      <Card
        title={`联系人（${contacts.length}）`}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreateContact}>新增联系人</Button>}
      >
        <List
          dataSource={contacts}
          locale={{ emptyText: '暂无联系人记录' }}
          renderItem={contact => (
            <List.Item
              actions={[
                <Button key="edit" type="link" size="small" onClick={() => openEditContact(contact)}>编辑</Button>,
                <Popconfirm
                  key="delete"
                  title="确认删除该联系人？"
                  okText="确定"
                  cancelText="取消"
                  onConfirm={() => void removeContact(id, contact.id).then(ok => ok && message.success('已删除'))}
                >
                  <Button type="link" size="small" danger>删除</Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={(
                  <Space size="small" wrap>
                    <span>{contact.name}</span>
                    {contact.isPrimary && <Tag color="gold">首要</Tag>}
                    {contact.relation && <Tag>{contact.relation}</Tag>}
                  </Space>
                )}
                description={`电话：${contact.phone ?? '-'} · 微信：${contact.wechat ?? '-'}`}
              />
            </List.Item>
          )}
        />
      </Card>

      {/* 编辑档案 */}
      <Modal
        title="编辑客户档案"
        open={editOpen}
        onCancel={() => { if (!submitting) setEditOpen(false); }}
        cancelButtonProps={{ disabled: submitting }}
        mask={{ closable: false }}
        onOk={() => editForm.submit()}
        confirmLoading={submitting}
        width={560}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit} disabled={submitting}>
          <Form.Item name="name" label="姓名" rules={crmNameRules}>
            <Input maxLength={50} />
          </Form.Item>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="电话/微信为敏感字段，编辑页不回填；如需修改请重新录入明文。"
          />
          <Form.Item name="phone" label="电话（留空则不修改）" rules={phoneRules(false)}>
            <Input maxLength={20} placeholder="留空则不修改" />
          </Form.Item>
          <Form.Item name="wechat" label="微信（留空则不修改）">
            <Input maxLength={50} placeholder="留空则不修改" />
          </Form.Item>
          <Form.Item name="customerType" label="客户类型">
            <Select options={CUSTOMER_TYPES.map(value => ({ value, label: CUSTOMER_TYPE_META[value] }))} />
          </Form.Item>
          <Form.Item name="status" label="客户状态">
            <Select options={CUSTOMER_STATUSES.map(value => ({ value, label: CUSTOMER_STATUS_META[value].text }))} />
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

      {/* 联系人 新增/编辑 */}
      <Modal
        title={contactModal?.mode === 'edit' ? '编辑联系人' : '新增联系人'}
        open={contactModal !== null}
        onCancel={() => setContactModal(null)}
        onOk={() => contactForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={contactForm} layout="vertical" onFinish={handleContactSubmit}>
          <Form.Item name="name" label="姓名" rules={crmNameRules}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item
            name="phone"
            label={contactModal?.mode === 'edit' ? '电话（留空则不修改）' : '电话'}
            rules={contactModal?.mode === 'edit' ? [] : [{ required: true, message: '请输入电话' }]}
          >
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="wechat" label="微信（留空则不修改）">
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="relation" label="关系">
            <Input maxLength={50} placeholder="如：本人/配偶/助理" />
          </Form.Item>
          <Form.Item name="isPrimary" label="首要联系人" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* 登记转介绍（SPEC-039） */}
      <Modal
        title="登记转介绍"
        open={referralOpen}
        onCancel={() => setReferralOpen(false)}
        onOk={() => referralForm.submit()}
        confirmLoading={referralSubmitting}
        okText="确定"
        width={460}
        destroyOnHidden
      >
        <Form form={referralForm} layout="vertical" onFinish={handleReferral}>
          <Form.Item name="name" label="转介绍人姓名" rules={crmNameRules}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="phone" label="电话" rules={phoneRules()}>
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="wechat" label="微信">
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="intentionLevel" label="意向度（1-5 星）" initialValue={3}>
            <InputNumber min={1} max={5} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CustomerDetailPage;
