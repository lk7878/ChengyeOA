import { useEffect, useState } from 'react';
import { message, Select } from 'antd';
import { authorizationAdminApi, authorizationErrorMessage } from '@/features/authorization/admin-api';
import TraceResult from '@/features/authorization/components/TraceResult';
import type { PermissionCode, PermissionTraceView } from '@/features/authorization/types';
import '@/features/authorization/authorization.css';

export default function MyAccessPage() {
  const [trace, setTrace] = useState<PermissionTraceView | null>(null);
  const [selectedPermission, setSelectedPermission] = useState<PermissionCode | undefined>();
  const load = async (permissionCode?: PermissionCode) => {
    try { setTrace(await authorizationAdminApi.trace.me(permissionCode)); }
    catch (error) { message.error(authorizationErrorMessage(error)); }
  };
  useEffect(() => {
    void authorizationAdminApi.trace.me(undefined)
      .then(setTrace)
      .catch(error => message.error(authorizationErrorMessage(error)));
  }, []);
  const options = [...new Set(trace?.sources.map(source => source.permissionCode) ?? [])];
  return <section className="auth-page">
    <header className="auth-page-header"><div><h2>我的权限</h2><p>查看当前账号的有效权限、来源、范围和有效期。</p></div></header>
    <div className="auth-self-filter"><label htmlFor="my-permission-filter">按权限查看</label><Select id="my-permission-filter" allowClear value={selectedPermission} placeholder="全部有效权限" onChange={value => { setSelectedPermission(value); void load(value); }} options={options.map(code => ({ value: code, label: code }))} /></div>
    <TraceResult trace={trace} />
  </section>;
}
