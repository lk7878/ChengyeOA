import { businessLabel } from '@/locales/business-labels';
import Table from '@/components/ResizableTable';
import { useEffect, useMemo, useState } from 'react';
import {
  Button, DatePicker, Drawer, Form, Input, message, Select, Space, Switch, Tabs, Tag, Tree,
} from 'antd';
import Modal from '@/components/DraggableModal';
import { EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, UserAddOutlined } from '@ant-design/icons';
import {
  authorizationAdminApi,
  authorizationErrorMessage,
} from '@/features/authorization/admin-api';
import type {
  DataScopeOption,
  FieldCapability,
  FieldCatalogEntry,
  PermissionCatalogEntry,
  PermissionCode,
  RoleAuthorizationView,
  RoleMember,
  AuthorizationUser,
} from '@/features/authorization/types';
import '@/features/authorization/authorization.css';
import { useAuthStore } from '@/stores/authStore';
import { masterDataApi } from '@/features/master-data/api';
import type { OrganizationNode, ProfessionalTeam } from '@/features/master-data/types';

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
  const [permissions, setPermissions] = useState<PermissionCode[]>([]);
  const [scopeBindings, setScopeBindings] = useState<Record<string, string[]>>({});
  const [fieldRules, setFieldRules] = useState<FieldCapability[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [scopeCreateOpen, setScopeCreateOpen] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationNode[]>([]);
  const [teams, setTeams] = useState<ProfessionalTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createForm] = Form.useForm<RoleForm>();
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
        authorizationAdminApi.catalogs.permissions(),
        authorizationAdminApi.catalogs.fields(),
        authorizationAdminApi.catalogs.dataScopes(),
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
    editForm.setFieldsValue({ name: role.name, code: role.code, description: role.description ?? undefined });
    setPermissions(role.permissionCodes);
    setScopeBindings(groupBindings(role));
    setFieldRules(role.fieldPermissions);
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
    setPermissions(role.permissionCodes);
    setScopeBindings(groupBindings(role));
    setFieldRules(role.fieldPermissions);
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

  const permissionTree = useMemo(() => [...new Set(catalog.map(item => item.resource))].map(resource => ({
    key: `resource:${resource}`,
    title: businessLabel(resource),
    selectable: false,
    children: catalog.filter(item => item.resource === resource).map(item => ({
      key: item.code,
      title: <Space size={6} wrap><span>{item.name || item.code}</span><code>{item.code}</code><Tag>{businessLabel(item.riskLevel)}</Tag></Space>,
    })),
  })), [catalog]);

  const scopeResources = useMemo(() => [...new Set(catalog
    .filter(item => item.type !== 'MENU' && permissions.includes(item.code))
    .map(item => item.resource))], [catalog, permissions]);

  const roleTabs = selected ? [
    { key: 'basic', label: '基本信息', children: <Form form={editForm} layout="vertical" onFinish={values => runMutation(() => authorizationAdminApi.roles.update(selected.id, { name: values.name, description: values.description || null, version: selected.version }))}>
      <Form.Item name="name" label="角色名称" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="code" label="角色代码"><Input disabled /></Form.Item>
      <Form.Item name="description" label="说明"><Input.TextArea rows={3} maxLength={500} /></Form.Item>
      <Space wrap>{canUpdate && <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>保存基本信息</Button>}
        {canManageStatus && <Button danger={selected.status === 'ENABLED'} loading={saving} onClick={() => runMutation(() => selected.status === 'ENABLED' ? authorizationAdminApi.roles.disable(selected.id, selected.version) : authorizationAdminApi.roles.enable(selected.id, selected.version))}>{selected.status === 'ENABLED' ? '停用角色' : '启用角色'}</Button>}
      </Space>
    </Form> },
    { key: 'permissions', label: '操作权限', children: <section className="auth-editor-section">
      <Tree checkable={canManagePermissions} defaultExpandAll treeData={permissionTree} checkedKeys={permissions} onCheck={keys => setPermissions((Array.isArray(keys) ? keys : keys.checked).filter(key => !String(key).startsWith('resource:')).map(String) as PermissionCode[])} />
      {canManagePermissions && <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => runMutation(() => authorizationAdminApi.roles.replacePermissions(selected.id, permissions, selected.version))}>保存操作权限</Button>}
    </section> },
    { key: 'scopes', label: '数据范围', children: <section className="auth-editor-section">
      {canManagePermissions && <div><Button icon={<PlusOutlined />} onClick={() => void openScopeCreate()}>新建数据范围</Button></div>}
      {scopeResources.length === 0 ? <p>请先为角色选择需要数据范围的操作权限。</p> : scopeResources.map(resource => <div className="auth-scope-row" key={resource}>
        <strong title={resource}>{businessLabel(resource)}</strong>
        <Select mode="multiple" disabled={!canManagePermissions} aria-label={`${resource} 数据范围`} value={scopeBindings[resource] ?? []} onChange={values => setScopeBindings(current => ({ ...current, [resource]: values }))} options={scopeCatalog.filter(scope => scopeCompatible(resource, scope.scopeType)).map(scope => ({ value: scope.id, label: `${scope.name} · ${businessLabel(scope.scopeType)}${scope.includeDescendants ? '（含下级）' : ''}` }))} />
      </div>)}
      {canManagePermissions && <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => runMutation(() => authorizationAdminApi.roles.replaceDataScopes(selected.id, Object.entries(scopeBindings).filter(([resource]) => scopeResources.includes(resource)).flatMap(([resource, ids]) => ids.map(dataScopeId => ({ resource, dataScopeId }))), selected.version))}>保存数据范围</Button>}
    </section> },
    { key: 'fields', label: '字段权限', children: <section className="auth-editor-section">
      <Table rowKey="code" size="small" pagination={false} dataSource={fieldCatalog.filter(field => scopeResources.includes(field.resource))} columns={fieldColumns(fieldRules, setFieldRules, canManagePermissions)} />
      {canManagePermissions && <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => runMutation(() => authorizationAdminApi.roles.replaceFieldPermissions(selected.id, fieldRules.filter(rule => scopeResources.includes(rule.resource)), selected.version))}>保存字段权限</Button>}
    </section> },
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
    <header className="auth-page-header"><div><h2>角色与权限</h2><p>业务角色采用版本控制，停用替代物理删除。</p></div><Space wrap><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>{canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>新建角色</Button>}</Space></header>
    <Table loading={loading} rowKey="id" dataSource={roles} pagination={false} scroll={{ x: 760 }} columns={[
      { title: '角色', dataIndex: 'name' },
      { title: '代码', dataIndex: 'code', render: value => <code>{value}</code> },
      { title: '类型', dataIndex: 'type', render: value => <Tag>{businessLabel(value)}</Tag> },
      { title: '状态', dataIndex: 'status', render: value => <Tag color={value === 'ENABLED' ? 'success' : 'default'}>{value === 'ENABLED' ? '启用' : '停用'}</Tag> },
      { title: '权限数', dataIndex: 'permissionCodes', render: (value: string[]) => value.length },
      { title: '操作', fixed: 'right', width: 90, render: (_, role) => <Button type="text" icon={<EditOutlined />} aria-label={`编辑${role.name}`} onClick={() => openRole(role)} /> },
    ]} />
    <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? `配置角色 · ${selected.name}` : ''} size="large" destroyOnHidden>
      <Tabs items={roleTabs} />
    </Drawer>
    <Modal open={createOpen} title="新建业务角色" onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={createForm} layout="vertical" onFinish={async values => {
        setSaving(true);
        try {
          const created = await authorizationAdminApi.roles.create({ name: values.name, code: values.code.toUpperCase(), description: values.description || null });
          setRoles(current => [created, ...current]);
          setCreateOpen(false);
          message.success('角色已创建');
        } catch (error) { message.error(authorizationErrorMessage(error)); } finally { setSaving(false); }
      }}>
        <Form.Item name="name" label="角色名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="code" label="角色代码" normalize={(value: string) => value?.toUpperCase()} rules={[{ required: true }, { pattern: /^[A-Z][A-Z0-9_]{2,63}$/, message: '请输入 3-64 位大写字母、数字或下划线' }]}><Input /></Form.Item>
        <Form.Item name="description" label="说明"><Input.TextArea rows={3} maxLength={500} /></Form.Item>
      </Form>
    </Modal>
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

function groupBindings(role: RoleAuthorizationView): Record<string, string[]> {
  return role.dataScopeBindings.reduce<Record<string, string[]>>((result, binding) => {
    result[binding.resource] = [...(result[binding.resource] ?? []), binding.dataScopeId];
    return result;
  }, {});
}

function scopeCompatible(resource: string, scopeType: string): boolean {
  if (scopeType === 'TEAM') return ['employee', 'professional_team', 'professional_team_member', 'user'].includes(resource);
  if (scopeType === 'SELF' || scopeType === 'SELF_AND_SUBORDINATES') return resource !== 'organization';
  return ['ALL', 'HQ_SCOPE', 'ORG', 'BRANCH', 'CUSTOM'].includes(scopeType);
}

function flattenOrganizations(nodes: OrganizationNode[]): OrganizationNode[] {
  return nodes.flatMap(node => [node, ...flattenOrganizations(node.children)]);
}

function fieldColumns(rules: FieldCapability[], setRules: (rules: FieldCapability[]) => void, editable: boolean) {
  const get = (field: FieldCatalogEntry) => rules.find(rule => rule.fieldCode === field.code) ?? { resource: field.resource, fieldCode: field.code, readLevel: field.defaultReadLevel, canWrite: false, canExport: false };
  const update = (field: FieldCatalogEntry, patch: Partial<FieldCapability>) => {
    const next = { ...get(field), ...patch };
    if (next.readLevel === 'NONE') { next.canWrite = false; next.canExport = false; }
    setRules([...rules.filter(rule => rule.fieldCode !== field.code), next]);
  };
  return [
    { title: '字段', dataIndex: 'code', render: (value: string, field: FieldCatalogEntry) => <Space wrap><code>{value}</code><Tag>{businessLabel(field.classification)}</Tag></Space> },
    { title: '读取', render: (_: unknown, field: FieldCatalogEntry) => <Select disabled={!editable} aria-label={`${field.code} 读取级别`} value={get(field).readLevel} style={{ width: 110 }} onChange={readLevel => update(field, { readLevel })} options={['NONE', 'MASKED', 'READ'].map(value => ({ value, label: businessLabel(value) }))} /> },
    { title: '写入', render: (_: unknown, field: FieldCatalogEntry) => <Switch aria-label={`${field.code} 写入`} disabled={!editable || get(field).readLevel === 'NONE'} checked={get(field).canWrite} onChange={canWrite => update(field, { canWrite })} /> },
    { title: '导出', render: (_: unknown, field: FieldCatalogEntry) => <Switch aria-label={`${field.code} 导出`} disabled={!editable || get(field).readLevel === 'NONE'} checked={get(field).canExport} onChange={canExport => update(field, { canExport })} /> },
  ];
}
