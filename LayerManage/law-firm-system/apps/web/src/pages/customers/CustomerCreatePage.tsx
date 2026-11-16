import { errorMessage, get, post } from '@/features/workspaces/api';
import type { Field } from '@/features/workspaces/types';
import BusinessWorkspacePage from '@/features/crm/BusinessWorkspacePage';
import { useAuthStore } from '@/stores/authStore';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space } from 'antd';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { customerApi } from '@/api/customer';
import { CUSTOMER_TYPES, type CreateCustomerInput } from '@/api/types';
import { crmNameRules, phoneRules } from '@/features/crm/form-rules';
import { CUSTOMER_TYPE_META } from '../leads/meta';

export function CustomerWorkspacePage() {
  const location = useLocation();
  return location.state?.fromCase ? <CustomerCreatePage /> : <BusinessWorkspacePage source="CUSTOMERS" />;
}
export default function CustomerCreatePage() {
  const location = useLocation(),
    navigate = useNavigate();
  const [params] = useSearchParams();
  const tableId = params.get('table');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [sourceState, setSourceState] = useState<{ tableId: string; field?: Field }>();
  const sourceField = sourceState?.tableId === tableId ? sourceState.field : undefined;
  const sourceLoading = Boolean(tableId && sourceState?.tableId !== tableId);
  const creationKey = useRef(crypto.randomUUID());
  useEffect(() => {
    let active = true;
    if (tableId) void get<{ fields: Field[] }>('/tables/' + tableId).then(detail => {
      if (active) setSourceState({ tableId, field: detail.fields.find(f => f.name === '客户来源' && f.type === 'SINGLE_SELECT' && f.writable) });
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '加载客户来源失败'); });
    return () => { active = false; };
  }, [tableId]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const canCreate = useAuthStore((s) => s.hasPermission('customer.create'));
  const fromCase = Boolean(location.state?.fromCase);
  const initialName =
    typeof location.state?.createCustomerName === 'string' ? location.state.createCustomerName : '';
  const cancel = () =>
    fromCase ? navigate('/cases', { replace: true, state: { resumeCase: true } }) : navigate('/customers');
  if (!canCreate) return <Alert type="error" title="没有新建客户权限" />;
  return (
    <div className="unified-area-page" style={{ maxWidth: 760 }}>
      <h1>新建客户</h1>
      {error && <Alert type="error" title={error} />}
      <Form<CreateCustomerInput & { sourceValue?: string }>
        layout="vertical"
        disabled={busy}
        initialValues={{ name: initialName, customerType: 'INDIVIDUAL' }}
        onFinish={async (values) => {
          setBusy(true);
          setError('');
          try {
            const { sourceValue, ...customer } = values;
            const response = tableId ? { data: await post<{ id: string }>('/tables/' + tableId + '/business-records', {
              ...customer, ...(sourceField && sourceValue ? { sourceFieldId: sourceField.id, sourceValue } : {}),
            }, creationKey.current) } : await customerApi.create(customer);
            if (!mounted.current) return;
            if (fromCase)
              navigate('/cases', {
                replace: true,
                state: { resumeCase: true, createdCustomer: response.data },
              });
            else navigate('/customers/' + response.data.id, { replace: true, state: { customerCreated: true } });
          } catch (e) {
            if (mounted.current) setError(tableId ? errorMessage(e) : e instanceof Error ? e.message : '创建失败，请保留输入后重试');
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      >
        <Form.Item name="name" label="姓名" rules={crmNameRules}>
          <Input maxLength={50} />
        </Form.Item>
        <Form.Item
          name="phone"
          label="电话"
          rules={[{ required: true, whitespace: true, message: '请输入客户电话' }, ...phoneRules()]}
        >
          <Input maxLength={20} />
        </Form.Item>
        {sourceField && <Form.Item name="sourceValue" label="客户来源" extra="选择律师后，基础资料将自动同步到对应客资表。">
          <Select allowClear options={sourceField.options.choices?.map(c => ({ value: c.id, label: c.name }))} />
        </Form.Item>}
        <Form.Item name="wechat" label="微信">
          <Input maxLength={50} />
        </Form.Item>
        <Form.Item name="customerType" label="客户类型">
          <Select options={CUSTOMER_TYPES.map((value) => ({ value, label: CUSTOMER_TYPE_META[value] }))} />
        </Form.Item>
        <Form.Item name="email" label="邮箱">
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="address" label="地址">
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Input maxLength={200} placeholder="多个标签用逗号分隔" />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={3} maxLength={500} />
        </Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" loading={busy} disabled={sourceLoading}>
            创建客户
          </Button>
          <Button disabled={busy} onClick={cancel}>
            {fromCase ? '返回新建案件' : '返回客户工作表'}
          </Button>
        </Space>
      </Form>
    </div>
  );
}
