import Modal from '@/components/DraggableModal';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, InputNumber, Select, Space, Spin } from 'antd';
import { Link, useNavigate, useParams } from 'react-router';
import { customerApi } from '@/api/customer';
import { negotiationApi, type NegotiationView, type CreateNegotiationInput } from '@/api/negotiation';
import type { CustomerView } from '@/api/types';
import type { Directory, Workspace } from '@/features/workspaces/types';
import { get, errorMessage } from '@/features/workspaces/api';
import { BusinessTableLinks } from '@/features/crm/BusinessWorkspacePage';
import { useAuthStore } from '@/stores/authStore';
import { NEGOTIATION_STATUS_META } from '../contracts/meta';

export default function NegotiationRecordPage() {
  const { id } = useParams();
  return <NegotiationEditor key={id || 'new'} id={id} />;
}
function NegotiationEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const canUpdate = useAuthStore((s) => s.hasPermission('negotiation.update'));
  const [data, setData] = useState<NegotiationView>();
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [directory, setDirectory] = useState<Directory>();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [closing, setClosing] = useState(false);
  const [form] = Form.useForm(),
    [closeForm] = Form.useForm();
  const outcome = Form.useWatch('outcome', closeForm);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (id)
      void negotiationApi
        .detail(id)
        .then((response) => {
          if (active) {
            setData(response.data);
            form.setFieldsValue(response.data);
            setError('');
          }
        })
        .catch((e) => {
          if (active) {
            setData(undefined);
            setError(errorMessage(e));
          }
        });
    return () => {
      active = false;
    };
  }, [id, revision, form]);
  useEffect(() => {
    let active = true;
    void get<{ workspaces: Workspace[] }>('/workspaces')
      .then((value) => {
        if (active) {
          setWorkspaces(value.workspaces);
          setWorkspaceId((current) => current || value.workspaces[0]?.id || '');
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    if (!id)
      void customerApi
        .list({ pageSize: 100 })
        .then((response) => {
          if (active) setCustomers(response.data.list);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    return () => {
      active = false;
    };
  }, [id, revision]);
  useEffect(() => {
    let active = true;
    if (workspaceId)
      void get<Directory>('/collaboration/options?workspaceId=' + encodeURIComponent(workspaceId))
        .then((value) => {
          if (active) setDirectory(value);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    return () => {
      active = false;
    };
  }, [workspaceId, revision]);
  const readOnly = !!id && (!canUpdate || data?.status !== 'NEGOTIATING');
  return (
    <div className="unified-area-page" style={{ maxWidth: 900 }}>
      <Space wrap>
        <Link to="/negotiations">返回谈案工作表</Link>
        {id && <BusinessTableLinks source="NEGOTIATIONS" recordId={id} />}
      </Space>
      <h1>{id ? '谈案详情与办理' : '新建谈案'}</h1>
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={() => setRevision((n) => n + 1)}>重试</Button>}
        />
      )}
      {id && !data && !error && <Spin />}
      {(!id || data) && (
        <>
          {data && (
            <Descriptions
              items={[
                { key: 'number', label: '谈案编号', children: data.negotiationNo },
                { key: 'state', label: '状态', children: NEGOTIATION_STATUS_META[data.status].text },
                {
                  key: 'customer',
                  label: '客户',
                  children: <Link to={'/customers/' + data.customerId}>打开关联客户</Link>,
                },
                { key: 'reason', label: '未签原因', children: data.unsignedReason || '—' },
              ]}
            />
          )}
          {!readOnly && (
            <Form.Item label="办理工作区">
              <Select
                aria-label="办理工作区"
                value={workspaceId || undefined}
                disabled={busy}
                placeholder="请选择有权访问的工作区"
                options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
                onChange={(value) => {
                  setWorkspaceId(value);
                  setDirectory(undefined);
                  form.setFieldsValue({ branchId: undefined, negotiatorEmployeeId: undefined });
                }}
              />
            </Form.Item>
          )}
          <Form
            layout="vertical"
            form={form}
            disabled={busy || readOnly}
            onFinish={async (values: CreateNegotiationInput) => {
              setBusy(true);
              setError('');
              try {
                if (id) {
                  await negotiationApi.update(id, {
                    negotiatorEmployeeId: values.negotiatorEmployeeId,
                    quotedAmount: values.quotedAmount ?? undefined,
                    customerConcerns: values.customerConcerns,
                    competitorInfo: values.competitorInfo,
                    remark: values.remark,
                  });
                  if (mounted.current) setRevision((n) => n + 1);
                } else {
                  const response = await negotiationApi.create(values);
                  if (mounted.current) navigate('/negotiations/' + response.data.id, { replace: true });
                }
              } catch (e) {
                if (mounted.current) setError(errorMessage(e));
              } finally {
                if (mounted.current) setBusy(false);
              }
            }}
          >
            {!id && (
              <Form.Item name="customerId" label="客户" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={customers.map((c) => ({
                    value: c.id,
                    label: c.name + '（' + c.customerNo + '）',
                  }))}
                />
              </Form.Item>
            )}
            {!id && (
              <Form.Item name="branchId" label="所属组织" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={directory?.organizations.map((o) => ({ value: o.id, label: o.name }))}
                />
              </Form.Item>
            )}
            <Form.Item name="negotiatorEmployeeId" label="谈案人" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={directory?.employees.map((e) => ({ value: e.id, label: e.name }))}
              />
            </Form.Item>
            <Form.Item name="quotedAmount" label="报价金额">
              <InputNumber stringMode min="0" precision={2} />
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
            {!readOnly && (
              <Space>
                <Button type="primary" htmlType="submit" loading={busy}>
                  {id ? '保存谈案' : '创建谈案'}
                </Button>
                {id && <Button onClick={() => setClosing(true)}>完结谈案</Button>}
              </Space>
            )}
          </Form>
        </>
      )}
      <Modal
        title="完结谈案"
        okText="确认完结"
        cancelText="取消"
        open={closing}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setClosing(false);
        }}
        onOk={async () => {
          try {
            const values = await closeForm.validateFields();
            if (!id) return;
            setBusy(true);
            await negotiationApi.close(id, values);
            if (mounted.current) {
              setClosing(false);
              setRevision((n) => n + 1);
            }
          } catch (e) {
            if (mounted.current && !(e as { errorFields?: unknown }).errorFields) setError(errorMessage(e));
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
        forceRender
      >
        <Form form={closeForm} layout="vertical" initialValues={{ outcome: 'SIGNED' }}>
          <Form.Item name="outcome" label="完结结果" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'SIGNED', label: '已签约' },
                { value: 'UNSIGNED', label: '未签约' },
              ]}
            />
          </Form.Item>
          {outcome === 'UNSIGNED' && (
            <Form.Item name="unsignedReason" label="未签原因" rules={[{ required: true, whitespace: true }]}>
              <Input.TextArea maxLength={500} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
