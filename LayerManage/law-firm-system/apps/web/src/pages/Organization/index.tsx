import { showRequestError } from '@/api/errors';
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Empty, Input, message, Popconfirm, Result, Space, Spin, Tag, Tooltip } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { masterDataApi } from '@/features/master-data/api';
import OrganizationForm from '@/features/master-data/components/OrganizationForm';
import OrganizationMoveDialog from '@/features/master-data/components/OrganizationMoveDialog';
import OrganizationTree from '@/features/master-data/components/OrganizationTree';
import type { CreateOrganizationInput, OrganizationNode, UpdateOrganizationInput } from '@/features/master-data/types';
import '@/features/master-data/master-data.css';
import { allowedChildTypes } from '@/features/master-data/form-rules';
import { filterOrganizations, flattenOrganizations, organizationTypeLabels } from '@/features/master-data/organization-utils';
import { useAuthStore } from '@/stores/authStore';

export default function OrganizationPage() {
  const isSuperAdmin = useAuthStore(state => state.authorization?.isSystemSuperAdmin === true);
  const [tree, setTree] = useState<OrganizationNode[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit' | 'copy' | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const all = flattenOrganizations(tree);
  const selected = all.find(node => node.id === selectedId) ?? tree[0] ?? null;
  const visibleTree = filterOrganizations(tree, keyword);

  const load = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true); setError(false);
    try {
      const response = await masterDataApi.organizations.tree();
      setTree(response.data);
      setSelectedId(current => flattenOrganizations(response.data).find(node => node.id === current)?.id ?? response.data[0]?.id);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [isSuperAdmin]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function mutate(action: () => Promise<unknown>, success: string, close: () => void) {
    if (submitting) return;
    setSubmitting(true);
    try { await action(); message.success(success); close(); await load(); }
    catch (error) { showRequestError(error, '操作未完成，当前输入已保留'); }
    finally { setSubmitting(false); }
  }
  async function submit(value: CreateOrganizationInput | UpdateOrganizationInput, source?: OrganizationNode) {
    if (!selected) return;
    await mutate(async () => {
      const response = formMode === 'edit'
        ? await masterDataApi.organizations.update(selected.id, value as UpdateOrganizationInput)
        : source
          ? await masterDataApi.organizations.copy(source.id, { ...value as CreateOrganizationInput, sourceVersion: source.version })
          : await masterDataApi.organizations.create(value as CreateOrganizationInput);
      setSelectedId(response.data.id); setKeyword('');
      setCollapsedIds(current => new Set([...current].filter(id => !response.data.path?.split('/').includes(id))));
    }, source ? '组织及下级、岗位结构已复制' : '组织已保存', () => setFormMode(null));
  }
  async function toggle() {
    if (!selected) return;
    await mutate(() => selected.status === 'ENABLED' ? masterDataApi.organizations.disable(selected.id, { version: selected.version }) : masterDataApi.organizations.enable(selected.id, { version: selected.version }), selected.status === 'ENABLED' ? '组织已停用' : '组织已启用', () => undefined);
  }
  if (!isSuperAdmin) return <Result status="403" title="仅系统超级管理员可以管理组织架构" />;
  return <section className="md-page">
    <header className="md-toolbar"><div><h1>组织架构</h1><p>查询和维护组织层级、岗位结构与部门负责人。</p></div><Button icon={<ReloadOutlined />} disabled={submitting} onClick={() => void load()}>刷新</Button></header>
    {error && <Alert type="error" showIcon title="组织数据加载失败" action={<Button onClick={() => void load()}>重试</Button>} />}
    <Spin spinning={loading}><div className="md-org-layout">
      <aside className="md-tree-pane">
        <Input.Search allowClear aria-label="搜索组织" placeholder="搜索名称、编码或负责人" value={keyword} onChange={event => setKeyword(event.target.value)} style={{ marginBottom: 16 }} />
        {visibleTree.length ? <OrganizationTree collapsedIds={collapsedIds} forceExpanded={Boolean(keyword.trim())} onToggle={id => setCollapsedIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} nodes={visibleTree} selectedId={selected?.id} onSelect={node => { if (!submitting) setSelectedId(node.id); }} /> : !loading && <Empty description={keyword ? '没有匹配的组织' : '暂无组织'} />}
      </aside>
      <main className="md-detail-pane">{selected ? <>
        <div className="md-detail-heading" style={{ flexDirection: 'column' }}><div><h2>{selected.name}</h2><Space><Tag>{selected.code}</Tag><Tag color={selected.status === 'ENABLED' ? 'green' : 'default'}>{selected.status === 'ENABLED' ? '启用' : '停用'}</Tag></Space></div>
          <Space wrap>
            <Tooltip title={selected.status !== 'ENABLED' ? '停用组织不能新增下级' : !allowedChildTypes(selected.type).length ? '工作组不能再新增下级组织' : undefined}>
              <Button aria-label="新增下级组织" icon={<PlusOutlined />} disabled={submitting || selected.status !== 'ENABLED' || !allowedChildTypes(selected.type).length} onClick={() => setFormMode('create')}>新增下级组织</Button>
            </Tooltip>
            <Button aria-label="编辑组织" icon={<EditOutlined />} disabled={submitting} onClick={() => setFormMode('edit')}>编辑组织</Button>
            {selected.type !== 'FIRM' && <>
              <Button aria-label="复制组织" icon={<CopyOutlined />} disabled={submitting} onClick={() => setFormMode('copy')}>复制组织</Button>
              <Button aria-label="移动组织" icon={<SwapOutlined />} disabled={submitting} onClick={() => setMoveOpen(true)}>移动组织</Button>
              <Popconfirm title={'确认' + (selected.status === 'ENABLED' ? '停用' : '启用') + '该组织？'} okText="确认" cancelText="取消" onConfirm={toggle}>
                <Button disabled={submitting}>{selected.status === 'ENABLED' ? '停用组织' : '启用组织'}</Button>
              </Popconfirm>
              <Popconfirm title={'确认删除“' + selected.name + '”？'} description="删除后不可恢复。存在下级、岗位或历史关联的组织无法删除。" okText="确认删除" cancelText="取消"
                onConfirm={() => mutate(() => masterDataApi.organizations.remove(selected.id, { version: selected.version }), '组织已删除', () => setSelectedId(selected.parentId ?? undefined))}>
                <Button aria-label="删除组织" danger icon={<DeleteOutlined />} disabled={submitting}>删除组织</Button>
              </Popconfirm>
            </>}
          </Space>
        </div>
        <Descriptions column={{ xs: 1, md: 2 }} items={[
          { key: 'type', label: '类型', children: organizationTypeLabels[selected.type] },
          { key: 'parent', label: '上级组织', children: all.find(node => node.id === selected.parentId)?.name ?? '无（根律所）' },
          { key: 'level', label: '层级', children: selected.level },
          { key: 'sort', label: '排序', children: selected.sort },
          { key: 'manager', label: '部门负责人', children: selected.manager ? selected.manager.name + '（' + selected.manager.employeeNo + '）' + (selected.manager.status === 'LEAVED' ? ' · 已离职，请更换' : '') : '未设置' },
        ]} />
        <Button type="link" disabled={submitting} onClick={() => setFormMode('edit')}>{selected.manager ? '更换部门负责人' : '设置部门负责人'}</Button>
      </> : <Empty description="请选择组织" />}</main>
    </div></Spin>
    <OrganizationForm open={formMode !== null} tree={tree}
      parent={formMode === 'copy' ? all.find(node => node.id === selected?.parentId) ?? null : selected}
      editing={formMode === 'edit' ? selected : null} copySource={formMode === 'copy' ? selected : null}
      submitting={submitting} onCancel={() => setFormMode(null)} onSubmit={submit} />
    <OrganizationMoveDialog open={moveOpen} organization={selected} tree={tree} submitting={submitting} onCancel={() => setMoveOpen(false)} onSubmit={parentId => mutate(() => masterDataApi.organizations.move(selected!.id, { parentId, version: selected!.version }), '组织已移动', () => setMoveOpen(false))} />
  </section>;
}
