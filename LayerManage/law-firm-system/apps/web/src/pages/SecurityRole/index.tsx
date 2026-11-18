import OtherFunctions from './OtherFunctions';
import ApplicationDefaults from './ApplicationDefaults';
import OfficeTemplate from './OfficeTemplate';
import CreateRole from './CreateRole';
import { ApplicationPermissions, type WorksheetChange } from './ApplicationPermissions';
import request from '@/api/request';
import { WorksheetPermissions } from './WorksheetPermissions';
import { businessLabel } from '@/locales/business-labels';
import Table from '@/components/ResizableTable';
import { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Form, Input, message, Select, Space, Switch, Tabs, Tag, Checkbox, Collapse } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import Modal from '@/components/DraggableModal';
import { EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, UserAddOutlined } from '@ant-design/icons';
import {
  authorizationAdminApi,
  authorizationErrorMessage,
} from '@/features/authorization/admin-api';
import type {
  DataScopeOption,
  FieldCatalogEntry,
  PermissionCatalogEntry,
  RoleAuthorizationView,
  RoleMember,
  AuthorizationUser,
} from '@/features/authorization/types';
import '@/features/authorization/authorization.css';
import { useAuthStore } from '@/stores/authStore';
import { masterDataApi } from '@/features/master-data/api';
import type { OrganizationNode, ProfessionalTeam } from '@/features/master-data/types';

const isSmartCaseRole = (role: RoleAuthorizationView) => role.code === 'SMART_CASE_USER';

type RoleForm = { name: string; code: string; description?: string };
type ScopeForm = { name: string; scopeType: string; includeDescendants: boolean; organizationId?: string; professionalTeamId?: string };

export default function SecurityRolePage() {
  const authorization = useAuthStore(state => state.authorization);
  const canCreate = Boolean(authorization?.isSystemSuperAdmin || authorization?.permissions.includes('role.create'));
  const canUpdate = Boolean(authorization?.isSystemSuperAdmin || authorization?.permissions.includes('role.update'));
  const canManageStatus = Boolean(authorization?.isSystemSuperAdmin || authorization?.permissions.includes('role.status.manage'));
  const canManagePermissions = Boolean(authorization?.isSystemSuperAdmin || authorization?.permissions.includes('role.permission.manage'));
  const canReadCatalog = Boolean(authorization?.isSystemSuperAdmin || authorization?.permissions.includes('permission.catalog.read'));
  const [roles, setRoles] = useState<RoleAuthorizationView[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [fieldCatalog, setFieldCatalog] = useState<FieldCatalogEntry[]>([]);
  const [scopeCatalog, setScopeCatalog] = useState<DataScopeOption[]>([]);
  const [selected, setSelected] = useState<RoleAuthorizationView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleAuthorizationView | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<{members:{id:string;userId:string;user:{username:string}}[];blockers:{id:string;name:string;reason:string}[];sharedTables:string[];token:string}|null>(null);
  const [deleteError,setDeleteError]=useState('');
  const [revokeOnDelete,setRevokeOnDelete]=useState(false);
  const [deleteReason,setDeleteReason]=useState('');
  useEffect(()=>{if(!deleteTarget)return;let active=true;void request.get<{data:NonNullable<typeof deleteImpact>}>('/v1/roles/'+deleteTarget.id+'/deletion-impact').then(r=>{if(active)setDeleteImpact(r.data);}).catch(e=>{if(active)setDeleteError(authorizationErrorMessage(e));});return()=>{active=false;};},[deleteTarget]);
  const [createOpen, setCreateOpen] = useState(false);
  const [scopeCreateOpen, setScopeCreateOpen] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationNode[]>([]);
  const [teams, setTeams] = useState<ProfessionalTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmWorksheets,setConfirmWorksheets]=useState(false);
  const [worksheetSaveError,setWorksheetSaveError]=useState('');
  const [worksheetChanges,setWorksheetChanges]=useState<WorksheetChange[]>([]);
  const [editForm] = Form.useForm<RoleForm>();
  const [scopeForm] = Form.useForm<ScopeForm>();
  const scopeType = Form.useWatch('scopeType', scopeForm);
  // SPEC-015 follow-up：per-role 成员管理。
  const canManageMembers = Boolean(authorization?.isSystemSuperAdmin || authorization?.permissions.includes('user_role.membership.manage'));
  const [members, setMembers] = useState<RoleMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberCandidates, setMemberCandidates] = useState<AuthorizationUser[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [revokeMember, setRevokeMember] = useState<RoleMember | null>(null);
  const [addMemberForm] = Form.useForm<{ userId: string; source: 'PERMANENT' | 'TEMPORARY'; validFrom?: unknown; validUntil?: unknown; reason?: string }>();
  const [revokeForm] = Form.useForm<{ reason: string }>();

  const load = async () => {
    setLoading(true);
    try {
      const [page, permissionsResult, fields, scopes] = await Promise.all([
        authorizationAdminApi.roles.list({ page: 1, pageSize: 100 }),
        canReadCatalog ? authorizationAdminApi.catalogs.permissions() : Promise.resolve([]),
        canManagePermissions ? authorizationAdminApi.catalogs.fields() : Promise.resolve([]),
        canManagePermissions ? authorizationAdminApi.catalogs.dataScopes() : Promise.resolve([]),
      ]);
      setRoles(page.list);
      setCatalog(permissionsResult);
      setFieldCatalog(fields);
      setScopeCatalog(scopes);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      authorizationAdminApi.roles.list({ page: 1, pageSize: 100 }),
      canReadCatalog ? authorizationAdminApi.catalogs.permissions() : Promise.resolve([]),
      canManagePermissions ? authorizationAdminApi.catalogs.fields() : Promise.resolve([]),
      canManagePermissions ? authorizationAdminApi.catalogs.dataScopes() : Promise.resolve([]),
    ]).then(([page, permissionsResult, fields, scopes]) => {
      if (!active) return;
      setRoles(page.list); setCatalog(permissionsResult); setFieldCatalog(fields); setScopeCatalog(scopes); setLoading(false);
    });
    return () => { active = false; };
  }, [canManagePermissions, canReadCatalog]);

  const openRole = (role: RoleAuthorizationView) => {
    setSelected(role);
    setWorksheetChanges([]);
    editForm.setFieldsValue({ name: role.name, code: role.code, description: role.description ?? undefined });
    void loadMembers(role.id);
  };

  const loadMembers = async (roleId: string) => {
    setMembersLoading(true);
    try { setMembers(await authorizationAdminApi.roles.members(roleId)); }
    catch { message.error('角色成员加载失败'); } finally { setMembersLoading(false); }
  };

  const openAddMember = async () => {
    setAddMemberOpen(true);
    addMemberForm.resetFields();
    try {
      const page = await authorizationAdminApi.users.list({ page: 1, pageSize: 100 });
      setMemberCandidates(page.list);
    } catch { message.error('用户列表加载失败'); }
  };

  const submitAddMember = async (values: { userId: string; source: 'PERMANENT' | 'TEMPORARY'; validFrom?: unknown; validUntil?: unknown; reason?: string }) => {
    if (!selected) return;
    const validFrom = (values.validFrom as { toISOString?: () => string } | undefined)?.toISOString?.() ?? new Date().toISOString();
    const validUntil = values.source === 'TEMPORARY' && values.validUntil ? (values.validUntil as { toISOString?: () => string }).toISOString?.() ?? null : null;
    if (values.source === 'TEMPORARY' && (!values.reason || values.reason.trim().length < 10)) {
      message.error('临时授权原因至少填写 10 个字符'); return;
    }
    setSaving(true);
    try {
      await authorizationAdminApi.users.grantRole(values.userId, {
        roleId: selected.id, source: values.source, validFrom, validUntil,
        reason: values.source === 'TEMPORARY' ? values.reason!.trim() : null,
      });
      setAddMemberOpen(false);
      await loadMembers(selected.id);
      message.success('成员已添加');
    } catch (caught) { message.error(authorizationErrorMessage(caught)); } finally { setSaving(false); }
  };

  const submitRevokeMember = async ({ reason }: { reason: string }) => {
    if (!selected || !revokeMember) return;
    setSaving(true);
    try {
      await authorizationAdminApi.users.revokeRole(revokeMember.userId, revokeMember.id, { reason: reason.trim(), version: revokeMember.version });
      setRevokeMember(null);
      await loadMembers(selected.id);
      message.success('成员已移除，历史记录已保留');
    } catch (caught) { message.error(authorizationErrorMessage(caught)); } finally { setSaving(false); }
  };

  const acceptUpdatedRole = (role: RoleAuthorizationView) => {
    setSelected(role);
    setRoles(current => current.map(item => item.id === role.id ? role : item));
  };

  const runMutation = async (mutate: () => Promise<RoleAuthorizationView>) => {
    setSaving(true);
    try {
      acceptUpdatedRole(await mutate());
      message.success('角色配置已保存');
    } catch (error) {
      message.error(authorizationErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const openScopeCreate = async () => {
    scopeForm.setFieldsValue({ scopeType: 'BRANCH', includeDescendants: true });
    setScopeCreateOpen(true);
    try {
      const [organizationResponse, teamResponse] = await Promise.all([
        masterDataApi.organizations.options('ENABLED'),
        masterDataApi.professionalTeams.list({ page: 1, pageSize: 100, status: 'ENABLED' }),
      ]);
      setOrganizations(organizationResponse.data);
      setTeams(teamResponse.data.list);
    } catch { message.error('数据范围目标加载失败'); }
  };

  const managedSmartCase = selected?.code === 'SMART_CASE_USER';
  const roleTabs = selected ? [
    { key: 'basic', label: '基本信息', children: <Form form={editForm} layout="vertical" onFinish={values => runMutation(() => authorizationAdminApi.roles.update(selected.id, { name: values.name, description: values.description || null, version: selected.version }))}>
      <Form.Item name="name" label="角色名称" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="code" label="角色代码"><Input disabled /></Form.Item>
      <Form.Item name="description" label="说明"><Input.TextArea rows={3} maxLength={500} /></Form.Item>
      <Space wrap>{canUpdate && <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>保存基本信息</Button>}
        {canManageStatus && <Button danger={selected.status === 'ENABLED'} loading={saving} onClick={() => runMutation(() => selected.status === 'ENABLED' ? authorizationAdminApi.roles.disable(selected.id, selected.version) : authorizationAdminApi.roles.enable(selected.id, selected.version))}>{selected.status === 'ENABLED' ? '停用角色' : '启用角色'}</Button>}
      </Space>
    </Form> },
    { key: 'members', label: '成员', children: <section className="auth-editor-section">
      {canManageMembers && <Button type="primary" icon={<UserAddOutlined />} loading={saving} onClick={() => void openAddMember()}>添加成员</Button>}
      <Table rowKey="id" size="small" pagination={false} loading={membersLoading} dataSource={members} columns={[
        { title: '用户', dataIndex: 'username', render: (value: string) => <code>{value}</code> },
        { title: '用户状态', dataIndex: 'userStatus', render: (value: string) => <Tag color={value === 'ENABLED' ? 'success' : 'default'}>{value === 'ENABLED' ? '启用' : '停用'}</Tag> },
        { title: '授予状态', dataIndex: 'state', render: (value: string) => <Tag color={value === 'ACTIVE' ? 'success' : value === 'REVOKED' ? 'default' : value === 'EXPIRED' ? 'warning' : 'processing'}>{businessLabel(value)}</Tag> },
        { title: '生效期', render: (_: unknown, member: RoleMember) => <span>{new Date(member.validFrom).toLocaleDateString('zh-CN')}{member.validUntil ? ` ~ ${new Date(member.validUntil).toLocaleDateString('zh-CN')}` : ' ~ 永久'}</span> },
        { title: '操作', render: (_: unknown, member: RoleMember) => <Button type="text" danger disabled={!canManageMembers || member.state === 'REVOKED'} onClick={() => setRevokeMember(member)}>移除</Button> },
      ]} />
    </section> },
  ] : [];

  return <section className="auth-page">
    <header className="auth-page-header"><div><h2>角色与权限</h2><p>智慧办案使用资格统一在“智慧办案使用者”的成员中追加或移除，可与任意岗位角色组合。知识库另按账号逐库授权。</p></div><Space wrap>{canManagePermissions&&<OfficeTemplate roles={roles.filter(r=>!isSmartCaseRole(r))} onSaved={()=>void load()}/>} {canManagePermissions && <WorksheetPermissions roles={roles.filter(r=>r.type==='BUSINESS'&&r.status==='ENABLED'&&!isSmartCaseRole(r))} superAdmin={!!authorization?.isSystemSuperAdmin}/>}<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>{canCreate && <Button aria-label="新建角色" type="primary" icon={<PlusOutlined />} onClick={() => { setCreateOpen(true); }}>新建角色</Button>}</Space></header>
    <Table loading={loading} rowKey="id" dataSource={roles} pagination={false} scroll={{ x: 760 }} columns={[
      { title: '角色', dataIndex: 'name' },
      { title: '代码', dataIndex: 'code', render: value => <code>{value}</code> },
      { title: '类型', dataIndex: 'type', render: value => <Tag>{businessLabel(value)}</Tag> },
      { title: '状态', dataIndex: 'status', render: value => <Tag color={value === 'ENABLED' ? 'success' : 'default'}>{value === 'ENABLED' ? '启用' : '停用'}</Tag> },
      { title: '权限数', dataIndex: 'permissionCodes', render: (value: string[]) => value.length },
      { title: '操作', fixed: 'right', width: 140, render: (_, role) => <Space><Button type="text" icon={<EditOutlined />} aria-label={`编辑${role.name}`} onClick={() => openRole(role)} />{canManageStatus && role.type === 'BUSINESS' && !isSmartCaseRole(role) && <Button type="link" danger onClick={() => {setDeleteImpact(null);setDeleteError('');setRevokeOnDelete(false);setDeleteReason('');setDeleteTarget(role);}}>删除</Button>}</Space> },
    ]} />
    <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? `配置角色 · ${selected.name}` : ''} size="large" destroyOnHidden>
      {managedSmartCase ? <><Alert type="info" title="智慧办案使用者 · 独立使用资格" description="本角色仅提供智慧办案入口，不授予其他人的案件、文件、任务或知识库。可追加给任何岗位；移除成员即撤销此项资格。超级管理员的系统权限不受此角色影响。"/><Tabs items={roleTabs.filter(t=>t.key==='members')} /></> : <><Tabs items={[...roleTabs.filter(t=>t.key==='basic'),{
        key:'worksheets',label:'应用与表格权限',children:selected&&<>
          <Collapse items={[{key:'defaults',label:'应用创建权限与新增表默认授权',children:<ApplicationDefaults role={selected} onSaved={acceptUpdatedRole} editable={!!authorization?.isSystemSuperAdmin&&selected.type==='BUSINESS'}/>}]} />
          <ApplicationPermissions key={selected.id+':'+selected.version} roleId={selected.id} changes={worksheetChanges} onChange={setWorksheetChanges}
            readOnly={!canManagePermissions||selected.type!=='BUSINESS'} superAdmin={!!authorization?.isSystemSuperAdmin}/>
          {canManagePermissions&&selected.type==='BUSINESS'&&<Button type="primary" disabled={!worksheetChanges.length} loading={saving}
            onClick={()=>{setWorksheetSaveError('');setConfirmWorksheets(true);}}>核对并保存表格授权</Button>}
          {worksheetSaveError && <Alert role="alert" type="error" title={worksheetSaveError}/>}
          <Modal open={confirmWorksheets} title="确认保存这些授权变更？" okText="确认保存" cancelText="取消"
            onCancel={()=>setConfirmWorksheets(false)} onOk={()=>{
              setConfirmWorksheets(false);setSaving(true);
              void request.put<{data:RoleAuthorizationView}>('/v1/roles/'+selected.id+'/worksheets',
                {version:selected.version,worksheets:worksheetChanges},{suppressGlobalError:true})
                .then(response=>{acceptUpdatedRole(response.data);setWorksheetChanges([]);message.success('表格授权已保存');})
                .catch(error=>{setWorksheetSaveError(error instanceof Error && error.message==='STEP_UP_CANCELLED'
                  ? '已取消验证，授权尚未保存；已选权限保留，可重新保存。' : authorizationErrorMessage(error));})
                .finally(()=>setSaving(false));
            }}>仅更新差异中列出的工作表。验证完成后会继续保存，取消验证会保留已选权限。</Modal>
        </>},{key:'other-functions',label:'其他功能权限',children:selected&&canManagePermissions&&<><Button onClick={()=>void openScopeCreate()}>新建数据范围</Button><OtherFunctions role={selected} catalog={catalog} scopes={scopeCatalog} editable={selected.type==='BUSINESS'} onSaved={acceptUpdatedRole}/></>},...roleTabs.filter(t=>t.key==='members')]} />
      <Collapse items={[{key:'advanced',label:'权限明细与诊断（只读）',children:<><Alert type="info" title="逐表授权在使用该表时生效，不会复制成全局权限。以下历史规则保留原有效果；无法等价映射的规则待迁移，不会因保存表格而清空。"/><p>操作来源：本角色历史授权。实际成员还可能通过其他角色、临时授权及直接共享获得权限，请在权限检查中核对。</p><Table rowKey="code" size="small" pagination={{pageSize:10}} dataSource={selected?.permissionCodes.map(code=>({code,name:catalog.find(p=>p.code===code)?.name||code,resource:catalog.find(p=>p.code===code)?.resource||''}))||[]} columns={[{title:'功能',dataIndex:'name'},{title:'来源',render:()=> '历史角色规则（保留）'},{title:'数据范围',render:(_,p)=>selected?.dataScopeBindings.filter(b=>b.resource===p.resource).map(b=>scopeCatalog.find(s=>s.id===b.dataScopeId)?.name||b.scopeType).join('、')||'由业务规则约束'}]}/><p>字段规则：{selected?.fieldPermissions.map(f=>`${fieldCatalog.find(c=>c.code===f.fieldCode)?.field||f.fieldCode}：${f.readLevel}${f.canWrite?' / 可写':''}${f.canExport?' / 可导出':''}`).join('；')||'使用业务默认字段规则'}</p></>}]} /></>}
    </Drawer>
    <Modal open={Boolean(deleteTarget)} title={`删除角色 · ${deleteTarget?.name ?? ''}`} okText="确认删除" okButtonProps={{ danger: true, disabled: !deleteImpact || !!deleteImpact.blockers.length || (!!deleteImpact.members.length && (!revokeOnDelete || deleteReason.trim().length<10)) }} confirmLoading={saving} onCancel={() => setDeleteTarget(null)} onOk={async () => {
      if (!deleteTarget) return;
      setSaving(true);
      try {
        await request.delete('/v1/roles/'+deleteTarget.id,{data:{version:deleteTarget.version,...(revokeOnDelete?{revokeMembers:true,impactToken:deleteImpact?.token,reason:deleteReason.trim()}: {})}});
        if (selected?.id === deleteTarget.id) setSelected(null);
        setDeleteTarget(null);
        await load();
        message.success('角色已删除');
      } catch (error) { message.error(authorizationErrorMessage(error)); } finally { setSaving(false); }
    }}><p>删除后不再显示或分配此角色，历史审计保留。同名新角色不会继承原授权。</p>
      {deleteError&&<Alert type="error" title={deleteError}/>}
      {!deleteImpact&&!deleteError&&<p>正在核对成员与业务依赖…</p>}
      {deleteImpact&&<><p>有效及待生效授权：{deleteImpact.members.length} 项；使用该角色分享的表格：{deleteImpact.sharedTables.length} 张。</p>
      <ul>{deleteImpact.members.map(m=><li key={m.id}>{m.user.username}</li>)}</ul>
      {deleteImpact.blockers.map(b=><Alert key={b.id} type="error" title={b.name} description={b.reason}/>)}
      {!!deleteImpact.members.length&&canManageMembers&&<><Checkbox checked={revokeOnDelete} onChange={e=>setRevokeOnDelete(e.target.checked)}>已核对影响，撤销以上成员授权并删除角色</Checkbox><Input.TextArea aria-label="撤销并删除原因" value={deleteReason} onChange={e=>setDeleteReason(e.target.value)} placeholder="请输入至少 10 字的操作原因" maxLength={500}/></>}
      <p>成员授权与角色删除在同一事务内完成；审批依赖必须先处理。其他角色或直接共享的独立授权仍保留。</p></>}</Modal>
    {createOpen&&<CreateRole roles={roles} canAuthorize={canManagePermissions} onClose={()=>setCreateOpen(false)}
      onCreated={created=>{setRoles(current=>[created,...current]);setCreateOpen(false);openRole(created);}}/>}
    <Modal open={scopeCreateOpen} title="新建数据范围" onCancel={() => setScopeCreateOpen(false)} onOk={() => scopeForm.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={scopeForm} layout="vertical" onFinish={async values => {
        setSaving(true);
        try {
          const created = await authorizationAdminApi.catalogs.createDataScope({
            name: values.name,
            scopeType: values.scopeType,
            includeDescendants: values.includeDescendants,
            organizationId: ['ORG', 'BRANCH'].includes(values.scopeType) ? values.organizationId ?? null : null,
            professionalTeamId: values.scopeType === 'TEAM' ? values.professionalTeamId ?? null : null,
          });
          setScopeCatalog(current => [...current, created].sort((left, right) => left.name.localeCompare(right.name)));
          setScopeCreateOpen(false);
          message.success('数据范围已创建');
        } catch (error) { message.error(authorizationErrorMessage(error)); } finally { setSaving(false); }
      }}>
        <Form.Item name="name" label="范围名称" rules={[{ required: true }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="scopeType" label="范围类型" rules={[{ required: true }]}><Select options={['ALL', 'HQ_SCOPE', 'ORG', 'BRANCH', 'TEAM', 'SELF_AND_SUBORDINATES', 'SELF'].map(value => ({ value, label: businessLabel(value) }))} /></Form.Item>
        {['ORG', 'BRANCH'].includes(scopeType) && <Form.Item name="organizationId" label="目标组织" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={flattenOrganizations(organizations).filter(organization => scopeType !== 'BRANCH' || organization.type === 'BRANCH').map(organization => ({ value: organization.id, label: `${organization.name} · ${organization.code}` }))} /></Form.Item>}
        {scopeType === 'TEAM' && <Form.Item name="professionalTeamId" label="目标团队" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={teams.map(team => ({ value: team.id, label: `${team.name} · ${team.code}` }))} /></Form.Item>}
        <Form.Item name="includeDescendants" label="包含下级" valuePropName="checked"><Switch disabled={!['ORG', 'BRANCH'].includes(scopeType)} /></Form.Item>
      </Form>
    </Modal>
    <Modal open={addMemberOpen} title="添加成员" onCancel={() => setAddMemberOpen(false)} onOk={() => addMemberForm.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={addMemberForm} layout="vertical" onFinish={submitAddMember}>
        <Form.Item name="userId" label="用户" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={memberCandidates.map(user => ({ value: user.id, label: `${user.username}${user.employee?.name ? ` · ${user.employee.name}` : ''}` }))} /></Form.Item>
        <Form.Item name="source" label="授权类型" rules={[{ required: true }]}><Select options={[{ value: 'PERMANENT', label: '永久' }, { value: 'TEMPORARY', label: '临时' }]} /></Form.Item>
        {addMemberForm.getFieldValue('source') === 'TEMPORARY' && <>
          <Form.Item name="validUntil" label="有效期至" rules={[{ required: true }]}><DatePicker showTime /></Form.Item>
          <Form.Item name="reason" label="临时原因" rules={[{ required: true }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        </>}
      </Form>
    </Modal>
    <Modal open={Boolean(revokeMember)} title={`移除成员 · ${revokeMember?.username ?? ''}`} onCancel={() => setRevokeMember(null)} onOk={() => revokeForm.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={revokeForm} layout="vertical" onFinish={submitRevokeMember}>
        <Form.Item name="reason" label="移除原因（至少 10 字）" rules={[{ required: true }, { min: 10, message: '移除原因至少 10 个字符' }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      </Form>
    </Modal>
  </section>;
}

function flattenOrganizations(nodes: OrganizationNode[]): OrganizationNode[] {
  return nodes.flatMap(node => [node, ...flattenOrganizations(node.children)]);
}
