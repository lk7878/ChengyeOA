import PermissionOverview from '../SecurityRole/PermissionOverview';
import {previewEvent} from '../SecurityRole/worksheet-permission-options';
import { useSearchParams } from 'react-router';
import { businessLabel } from '@/locales/business-labels';
import Table from '@/components/ResizableTable';
import { useEffect, useState } from 'react';
import { Button, DatePicker, Form, Input, message, Segmented, Select, Space, Tabs, Tag } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import Modal from '@/components/DraggableModal';
import { ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { authorizationAdminApi, authorizationErrorMessage } from '@/features/authorization/admin-api';
import { validateGrantWindow } from '@/features/authorization/grant-validation';
import type {
  AuthorizationUser, DataScopeOption, GrantState, PermissionCatalogEntry, PermissionCode,
  RoleAuthorizationView, RoleGrant, SpecialGrant, UserAuthorizationView,
} from '@/features/authorization/types';
import { useAuthStore } from '@/stores/authStore';
import '@/features/authorization/authorization.css';

type RoleGrantForm = { roleId: string; source: 'PERMANENT' | 'TEMPORARY'; validFrom: Dayjs; validUntil?: Dayjs; reason?: string };
type SpecialGrantForm = { permissionCode: PermissionCode; dataScopeId: string; validFrom: Dayjs; validUntil: Dayjs; reason: string };

export default function SecurityUserPage() {
  const selfUserId = useAuthStore(state => state.authorization?.userId);
  const mayManage = useAuthStore(state => Boolean(state.authorization?.isSystemSuperAdmin));
  const [users, setUsers] = useState<AuthorizationUser[]>([]);
  const [params] = useSearchParams();
  const requestedUserId = params.get('userId');
  const [roles, setRoles] = useState<RoleAuthorizationView[]>([]);
  const [permissions, setPermissions] = useState<PermissionCatalogEntry[]>([]);
  const [scopes, setScopes] = useState<DataScopeOption[]>([]);
  const [selected, setSelected] = useState<AuthorizationUser | null>(null);
  const [summary, setSummary] = useState<UserAuthorizationView | null>(null);
  const [roleGrantOpen, setRoleGrantOpen] = useState(false);
  const [specialGrantOpen, setSpecialGrantOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ kind: 'ROLE' | 'SPECIAL'; grant: RoleGrant | SpecialGrant } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [roleForm] = Form.useForm<RoleGrantForm>();
  const [specialForm] = Form.useForm<SpecialGrantForm>();
  const [revokeForm] = Form.useForm<{ reason: string }>();
  const roleSource = Form.useWatch('source', roleForm) ?? 'PERMANENT';
  const proposedRoleId = Form.useWatch('roleId', roleForm);
  const remainingRoles=summary?.roleGrants.filter(g=>['ACTIVE','PENDING'].includes(g.state)&&g.id!==revokeTarget?.grant.id)||[];
  const remainingSpecial=summary?.specialGrants.filter(g=>['ACTIVE','PENDING'].includes(g.state)&&g.id!==revokeTarget?.grant.id)||[];

  const load = async () => {
    setLoading(true);
    try {
      const [userPage, rolePage, permissionCatalog, scopeCatalog] = await Promise.all([
        authorizationAdminApi.users.list({ page: 1, pageSize: 100, keyword: keyword || undefined }),
        authorizationAdminApi.roles.list({ page: 1, pageSize: 100 }),
        authorizationAdminApi.catalogs.permissions(),
        authorizationAdminApi.catalogs.dataScopes(),
      ]);
      setUsers(userPage.list);
      setRoles(rolePage.list.filter(role => role.type === 'BUSINESS' && role.status === 'ENABLED'));
      setPermissions(permissionCatalog);
      setScopes(scopeCatalog);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      authorizationAdminApi.users.list({ page: 1, pageSize: 100 }),
      mayManage ? authorizationAdminApi.roles.list({ page: 1, pageSize: 100 }) : Promise.resolve({ list: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }),
      mayManage ? authorizationAdminApi.catalogs.permissions() : Promise.resolve([]),
      mayManage ? authorizationAdminApi.catalogs.dataScopes() : Promise.resolve([]),
    ]).then(([userPage, rolePage, permissionCatalog, scopeCatalog]) => {
      if (!active) return;
      setUsers(userPage.list);
      setRoles(rolePage.list.filter(role => role.type === 'BUSINESS' && role.status === 'ENABLED'));
      setPermissions(permissionCatalog); setScopes(scopeCatalog); setLoading(false);
    });
    return () => { active = false; };
  }, [mayManage]);

  const openUser = async (user: AuthorizationUser) => {
    if (user.id === selfUserId) return;
    setSelected(user);
    setSummary(null);
    try { setSummary(await authorizationAdminApi.users.authorization(user.id)); }
    catch (error) { message.error(authorizationErrorMessage(error)); }
  };

  useEffect(()=>{
    if(!requestedUserId||requestedUserId===selfUserId||!mayManage)return;
    let active=true;
    void Promise.all([authorizationAdminApi.users.detail(requestedUserId),authorizationAdminApi.users.authorization(requestedUserId)])
      .then(([user,value])=>{if(active){setSelected(user);setSummary(value);}})
      .catch(error=>{if(active)message.error(authorizationErrorMessage(error));});
    return()=>{active=false;};
  },[requestedUserId,selfUserId,mayManage]);

  const reloadSummary = async () => {
    if (selected) setSummary(await authorizationAdminApi.users.authorization(selected.id));
  };

  const submitRoleGrant = async (values: RoleGrantForm) => {
    if (!selected) return;
    const validFrom = values.validFrom.toISOString();
    const validUntil = values.source === 'TEMPORARY' ? values.validUntil?.toISOString() ?? null : null;
    const error = validateGrantWindow('ROLE', values.source, validFrom, validUntil);
    if (error) { message.error(error); return; }
    if (values.source === 'TEMPORARY' && (!values.reason || values.reason.trim().length < 10)) {
      message.error('临时授权原因至少填写 10 个字符'); return;
    }
    setSaving(true);
    try {
      await authorizationAdminApi.users.grantRole(selected.id, { roleId: values.roleId, source: values.source, validFrom, validUntil, reason: values.source === 'TEMPORARY' ? values.reason!.trim() : null });
      await reloadSummary();
      setRoleGrantOpen(false);
      message.success('角色授权已生效');
    } catch (caught) { message.error(authorizationErrorMessage(caught)); } finally { setSaving(false); }
  };

  const submitSpecialGrant = async (values: SpecialGrantForm) => {
    if (!selected) return;
    const validFrom = values.validFrom.toISOString();
    const validUntil = values.validUntil.toISOString();
    const error = validateGrantWindow('SPECIAL', 'TEMPORARY', validFrom, validUntil);
    if (error) { message.error(error); return; }
    setSaving(true);
    try {
      await authorizationAdminApi.users.grantSpecial(selected.id, { permissionCode: values.permissionCode, dataScopeId: values.dataScopeId, validFrom, validUntil, reason: values.reason.trim() });
      await reloadSummary();
      setSpecialGrantOpen(false);
      message.success('临时特权已生效');
    } catch (caught) { message.error(authorizationErrorMessage(caught)); } finally { setSaving(false); }
  };

  const submitRevoke = async ({ reason }: { reason: string }) => {
    if (!selected || !revokeTarget) return;
    setSaving(true);
    try {
      if (revokeTarget.kind === 'ROLE') await authorizationAdminApi.users.revokeRole(selected.id, revokeTarget.grant.id, { reason: reason.trim(), version: revokeTarget.grant.version });
      else await authorizationAdminApi.users.revokeSpecial(selected.id, revokeTarget.grant.id, { reason: reason.trim(), version: revokeTarget.grant.version });
      await reloadSummary();
      setRevokeTarget(null);
      message.success('授权已撤销，历史记录已保留');
    } catch (caught) { message.error(authorizationErrorMessage(caught)); } finally { setSaving(false); }
  };

  return <section className="auth-page">
    <header className="auth-page-header"><div><h2>人员授权</h2><p>账号关联员工后再授予角色；智慧办案资格和逐库阅读按需配置。岗位、部门名称不自动授予管理权。</p></div><Space wrap><Input.Search aria-label="搜索用户" placeholder="用户名或姓名" value={keyword} onChange={event => setKeyword(event.target.value)} onSearch={() => void load()} /><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button></Space></header>
    <Table loading={loading} rowKey="id" dataSource={users} pagination={false} scroll={{ x: 720 }} columns={[
      { title: '用户名', dataIndex: 'username' },
      { title: '人员', dataIndex: 'employee', render: (employee: AuthorizationUser['employee']) => employee?.name ?? '未绑定员工' },
      { title: '状态', dataIndex: 'status', render: value => <Tag color={value === 'ENABLED' ? 'success' : 'default'}>{businessLabel(value)}</Tag> },
      { title: '最近登录', dataIndex: 'lastLoginAt', render: (value: string | null) => value ? new Date(value).toLocaleString() : '-' },
      { title: '操作', fixed: 'right', width: 100, render: (_, user) => <Button type="text" icon={<SafetyCertificateOutlined />} aria-label={`管理 ${user.username} 的授权`} disabled={!mayManage || user.id === selfUserId} title={!mayManage ? '仅系统超级管理员可修改授权' : user.id === selfUserId ? '禁止修改自己的授权' : undefined} onClick={() => void openUser(user)} /> },
    ]} />
    <Drawer open={Boolean(selected)} title={selected ? `授权详情 · ${selected.username}` : ''} onClose={() => { setSelected(null); setSummary(null); }} size="large" destroyOnHidden>
      <p>调岗时请核对旧角色、临时授权和直接共享。撤销一个来源不会取消其他来源的权限；请通过权限检查确认最终结果。</p>
      {selected&&!selected.employee&&<p role="alert">该账号尚未关联员工，本人及部门数据范围可能无可见记录。</p>}
      {mayManage && <Space wrap className="auth-section-actions"><Button type="primary" onClick={() => { roleForm.setFieldsValue({ source: 'PERMANENT', validFrom: dayjs() }); setRoleGrantOpen(true); }}>授予角色</Button><Button onClick={() => { specialForm.setFieldsValue({ validFrom: dayjs(), validUntil: dayjs().add(1, 'day') }); setSpecialGrantOpen(true); }}>授予临时特权</Button></Space>}
      <Tabs items={[
        { key: 'roles', label: '角色授权', children: <Table loading={!summary} rowKey="id" size="small" pagination={false} dataSource={summary?.roleGrants ?? []} columns={grantColumns('ROLE', setRevokeTarget)} /> },
        ...(mayManage&&selected?[{key:'overview',label:'有效表格权限与共享来源',children:<PermissionOverview key={selected.id} subject={'MEMBER:'+selected.id} tables={[]} onPreview={(table,subject)=>{const [target,id]=subject.split(':');window.dispatchEvent(new CustomEvent(previewEvent,{detail:{table,target,id}}))}}/>}]:[]),
        { key: 'special', label: '临时特权', children: <Table loading={!summary} rowKey="id" size="small" pagination={false} dataSource={summary?.specialGrants ?? []} columns={grantColumns('SPECIAL', setRevokeTarget)} /> },
      ]} />
    </Drawer>
    <Modal open={roleGrantOpen} title="授予角色" onCancel={() => setRoleGrantOpen(false)} onOk={() => roleForm.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={roleForm} layout="vertical" onFinish={values => void submitRoleGrant(values)}>
        <Form.Item name="roleId" label="业务角色" rules={[{ required: true }]}><Select options={roles.map(role => ({ value: role.id, label: `${role.name} · ${role.code}` }))} /></Form.Item>
        <p>本次新增：{roles.find(r=>r.id===proposedRoleId)?.name||'请选择角色'}。原有角色与直接共享不会自动撤销。</p><p>当前有效或待生效角色：{remainingRoles.map(g=>g.roleName).join('、')||'无'}；临时特权 {remainingSpecial.length} 项。调岗需要另行撤销不再需要的授权。</p>
        <Form.Item name="source" label="授权期限" initialValue="PERMANENT"><Segmented options={[{ label: '长期', value: 'PERMANENT' }, { label: '临时', value: 'TEMPORARY' }]} /></Form.Item>
        <Form.Item name="validFrom" label="开始时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
        {roleSource === 'TEMPORARY' && <><Form.Item name="validUntil" label="结束时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item><Form.Item name="reason" label="授权原因" rules={[{ required: true, min: 10, max: 500 }]}><Input.TextArea rows={3} /></Form.Item><p className="auth-form-note">临时角色授权最长 90 天。</p></>}
      </Form>
    </Modal>
    <Modal open={specialGrantOpen} title="授予临时特权" onCancel={() => setSpecialGrantOpen(false)} onOk={() => specialForm.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={specialForm} layout="vertical" onFinish={values => void submitSpecialGrant(values)}>
        <Form.Item name="permissionCode" label="特权" rules={[{ required: true }]}><Select options={permissions.filter(permission => permission.type === 'SPECIAL' && !['role.permission.manage', 'user.role.manage', 'temporary_grant.manage'].includes(permission.code)).map(permission => ({ value: permission.code, label: `${permission.name || permission.code} · ${businessLabel(permission.riskLevel)}` }))} /></Form.Item>
        <Form.Item name="dataScopeId" label="数据范围" rules={[{ required: true }]}><Select options={scopes.map(scope => ({ value: scope.id, label: `${scope.name} · ${businessLabel(scope.scopeType)}` }))} /></Form.Item>
        <Form.Item name="validFrom" label="开始时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="validUntil" label="结束时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="reason" label="授权原因" rules={[{ required: true, min: 10, max: 500 }]}><Input.TextArea rows={3} /></Form.Item>
        <p className="auth-form-note">临时特权最长 30 天，不允许直接授予授权治理权限。</p>
      </Form>
    </Modal>
    <Modal open={Boolean(revokeTarget)} title="撤销授权" onCancel={() => setRevokeTarget(null)} onOk={() => revokeForm.submit()} confirmLoading={saving} destroyOnHidden>
      <p>本次仅撤销所选授权。保留角色：{remainingRoles.map(g=>g.roleName).join('、')||'无'}；保留临时特权 {remainingSpecial.length} 项。直接共享保持不变，请在“有效表格权限与共享来源”核对撤销后的结果。</p>
      <Form form={revokeForm} layout="vertical" onFinish={values => void submitRevoke(values)}><Form.Item name="reason" label="撤销原因" rules={[{ required: true, min: 10, max: 500 }]}><Input.TextArea rows={3} /></Form.Item></Form>
    </Modal>
  </section>;
}

function stateTag(state: GrantState) {
  const color = state === 'ACTIVE' ? 'success' : state === 'PENDING' ? 'processing' : state === 'EXPIRED' ? 'warning' : 'default';
  const label = { ACTIVE: '生效中', PENDING: '待生效', EXPIRED: '已过期', REVOKED: '已撤销' }[state];
  return <Tag color={color}>{label}</Tag>;
}

function grantColumns(kind: 'ROLE' | 'SPECIAL', revoke: (target: { kind: 'ROLE' | 'SPECIAL'; grant: RoleGrant | SpecialGrant }) => void) {
  return [
    { title: kind === 'ROLE' ? '角色' : '特权', render: (_: unknown, grant: RoleGrant | SpecialGrant) => kind === 'ROLE' ? (grant as RoleGrant).roleName : (grant as SpecialGrant).permissionCode },
    { title: '状态', dataIndex: 'state', render: stateTag },
    { title: '有效期', render: (_: unknown, grant: RoleGrant | SpecialGrant) => grant.validUntil ? `${new Date(grant.validFrom).toLocaleString()} - ${new Date(grant.validUntil).toLocaleString()}` : '长期' },
    { title: '操作', width: 70, render: (_: unknown, grant: RoleGrant | SpecialGrant) => grant.state === 'ACTIVE' || grant.state === 'PENDING' ? <Button type="text" danger icon={<StopOutlined />} aria-label="撤销授权" onClick={() => revoke({ kind, grant })} /> : null },
  ];
}
