import { EditOutlined, PlusOutlined, ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Empty, message, Popconfirm, Space, Spin, Tag, Tooltip } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { masterDataApi } from '@/features/master-data/api';
import OrganizationForm from '@/features/master-data/components/OrganizationForm';
import OrganizationMoveDialog from '@/features/master-data/components/OrganizationMoveDialog';
import OrganizationTree from '@/features/master-data/components/OrganizationTree';
import type { CreateOrganizationInput, OrganizationNode, UpdateOrganizationInput } from '@/features/master-data/types';
import '@/features/master-data/master-data.css';

function find(nodes: OrganizationNode[], id?: string): OrganizationNode | null {
  for (const node of nodes) { if (node.id === id) return node; const child = find(node.children, id); if (child) return child; }
  return null;
}

export default function OrganizationPage() {
  const [tree, setTree] = useState<OrganizationNode[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const selected = find(tree, selectedId) ?? tree[0] ?? null;

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { const response = await masterDataApi.organizations.tree(); setTree(response.data); setSelectedId(current => find(response.data, current)?.id ?? response.data[0]?.id); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function mutate(action: () => Promise<unknown>, success: string, close: () => void) {
    setSubmitting(true);
    try { await action(); message.success(success); close(); await load(); }
    catch { message.error('操作未完成，当前输入已保留'); }
    finally { setSubmitting(false); }
  }
  async function submit(value: CreateOrganizationInput | UpdateOrganizationInput) {
    if (!selected) return;
    await mutate(() => formMode === 'edit' ? masterDataApi.organizations.update(selected.id, value as UpdateOrganizationInput) : masterDataApi.organizations.create(value as CreateOrganizationInput), '组织已保存', () => setFormMode(null));
  }
  async function toggle() {
    if (!selected) return;
    await mutate(() => selected.status === 'ENABLED' ? masterDataApi.organizations.disable(selected.id, { version: selected.version }) : masterDataApi.organizations.enable(selected.id, { version: selected.version }), selected.status === 'ENABLED' ? '组织已停用' : '组织已启用', () => undefined);
  }

  return <section className="md-page">
    <header className="md-toolbar"><div><h1>组织架构</h1><p>维护总所、总部中心、部门、分所与工作组的行政层级。</p></div><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button></header>
    {error && <Alert type="error" showIcon message="组织数据加载失败" action={<Button onClick={() => void load()}>重试</Button>} />}
    <Spin spinning={loading}><div className="md-org-layout">
      <aside className="md-tree-pane">{tree.length ? <OrganizationTree nodes={tree} selectedId={selected?.id} onSelect={node => setSelectedId(node.id)} /> : !loading && <Empty description="暂无组织" />}</aside>
      <main className="md-detail-pane">{selected ? <>
        <div className="md-detail-heading"><div><h2>{selected.name}</h2><Space><Tag>{selected.code}</Tag><Tag color={selected.status === 'ENABLED' ? 'green' : 'default'}>{selected.status === 'ENABLED' ? '启用' : '停用'}</Tag></Space></div>
          <Space wrap><Button icon={<PlusOutlined />} onClick={() => setFormMode('create')}>新增下级组织</Button><Tooltip title="编辑组织"><Button aria-label="编辑组织" icon={<EditOutlined />} onClick={() => setFormMode('edit')} /></Tooltip>
          {selected.type !== 'FIRM' && <><Tooltip title="移动组织"><Button aria-label="移动组织" icon={<SwapOutlined />} onClick={() => setMoveOpen(true)} /></Tooltip><Popconfirm title={`确认${selected.status === 'ENABLED' ? '停用' : '启用'}该组织？`} onConfirm={() => void toggle()}><Button aria-label={selected.status === 'ENABLED' ? '停用组织' : '启用组织'}>{selected.status === 'ENABLED' ? '停用' : '启用'}</Button></Popconfirm></>}</Space>
        </div>
        <Descriptions column={{ xs: 1, md: 2 }} items={[{ key: 'type', label: '类型', children: selected.type }, { key: 'level', label: '层级', children: selected.level }, { key: 'path', label: '路径', children: selected.path }, { key: 'sort', label: '排序', children: selected.sort }]} />
      </> : <Empty description="请选择组织" />}</main>
    </div></Spin>
    <OrganizationForm open={formMode !== null} parent={selected} editing={formMode === 'edit' ? selected : null} submitting={submitting} onCancel={() => setFormMode(null)} onSubmit={submit} />
    <OrganizationMoveDialog open={moveOpen} organization={selected} tree={tree} submitting={submitting} onCancel={() => setMoveOpen(false)} onSubmit={parentId => mutate(() => masterDataApi.organizations.move(selected!.id, { parentId, version: selected!.version }), '组织已移动', () => setMoveOpen(false))} />
  </section>;
}
