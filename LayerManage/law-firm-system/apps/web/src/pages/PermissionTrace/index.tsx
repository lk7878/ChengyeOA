import { useEffect, useState } from 'react';
import { Button, Form, message, Select, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { authorizationAdminApi, authorizationErrorMessage } from '@/features/authorization/admin-api';
import TraceResult from '@/features/authorization/components/TraceResult';
import type { AuthorizationUser, PermissionCatalogEntry, PermissionCode, PermissionTraceView } from '@/features/authorization/types';
import '@/features/authorization/authorization.css';

interface Props { initialUserId?: string; initialPermissionCode?: PermissionCode }

export default function PermissionTracePage({ initialUserId, initialPermissionCode }: Props) {
  const [users, setUsers] = useState<AuthorizationUser[]>([]);
  const [permissions, setPermissions] = useState<PermissionCatalogEntry[]>([]);
  const [trace, setTrace] = useState<PermissionTraceView | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<{ userId: string; permissionCode?: PermissionCode }>();

  const query = async (userId: string, permissionCode?: PermissionCode) => {
    setLoading(true);
    try { setTrace(await authorizationAdminApi.trace.user(userId, permissionCode)); }
    catch (error) { message.error(authorizationErrorMessage(error)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void Promise.all([
      authorizationAdminApi.users.list({ page: 1, pageSize: 100 }),
      authorizationAdminApi.catalogs.permissions(),
    ]).then(([userPage, catalog]) => { setUsers(userPage.list); setPermissions(catalog); });
    if (initialUserId) {
      form.setFieldsValue({ userId: initialUserId, permissionCode: initialPermissionCode });
      void authorizationAdminApi.trace.user(initialUserId, initialPermissionCode)
        .then(setTrace)
        .catch(error => message.error(authorizationErrorMessage(error)))
        .finally(() => setLoading(false));
    }
  }, [form, initialPermissionCode, initialUserId]);

  return <section className="auth-page">
    <header className="auth-page-header"><div><h2>权限追踪</h2><p>解释权限来源、数据范围、字段能力和拒绝原因，不返回业务敏感值。</p></div></header>
    <Form form={form} layout="inline" className="auth-trace-form" onFinish={values => void query(values.userId, values.permissionCode)}>
      <Form.Item name="userId" label="目标用户" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" style={{ minWidth: 220 }} options={users.map(user => ({ value: user.id, label: `${user.username}${user.employee ? ` · ${user.employee.name}` : ''}` }))} /></Form.Item>
      <Form.Item name="permissionCode" label="权限代码"><Select allowClear showSearch optionFilterProp="label" style={{ minWidth: 280 }} options={permissions.map(permission => ({ value: permission.code, label: permission.code }))} /></Form.Item>
      <Form.Item><Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}>查询</Button></Form.Item>
    </Form>
    <Space direction="vertical" size="large" style={{ width: '100%' }}><TraceResult trace={trace} /></Space>
  </section>;
}
