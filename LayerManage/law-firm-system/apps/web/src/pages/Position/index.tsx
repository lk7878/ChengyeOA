import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { masterDataApi } from '@/features/master-data/api';
import PositionTable from '@/features/master-data/components/PositionTable';
import type { CreatePositionInput, OrganizationNode, Position, UpdatePositionInput } from '@/features/master-data/types';
import '@/features/master-data/master-data.css';

function flatten(nodes: OrganizationNode[]): OrganizationNode[] { return nodes.flatMap(node => [node, ...flatten(node.children)]); }
type FormValues = { code: string; name: string; categoryCode: string; level: number; responsibilities?: string };

export default function PositionPage() {
  const [organizations, setOrganizations] = useState<OrganizationNode[]>([]);
  const [organizationId, setOrganizationId] = useState<string>();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const organizationOptions = useMemo(() => flatten(organizations).map(item => ({ value: item.id, label: item.name })), [organizations]);
  const selectedName = organizationOptions.find(item => item.value === organizationId)?.label;

  useEffect(() => { void (async () => { try { const response = await masterDataApi.organizations.tree('ENABLED'); setOrganizations(response.data); setOrganizationId(response.data[0]?.id); } catch { setError(true); setLoading(false); } })(); }, []);
  const load = useCallback(async () => {
    if (!organizationId) { setPositions([]); setLoading(false); return; }
    setLoading(true); setError(false);
    try { const response = await masterDataApi.positions.list({ organizationId }); setPositions(response.data); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [organizationId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function showForm(position?: Position) {
    setEditing(position ?? null); setOpen(true);
    form.setFieldsValue(position ? { code: position.code, name: position.name, categoryCode: position.categoryCode, level: position.level, responsibilities: position.responsibilities ?? undefined } : { code: '', name: '', categoryCode: '', level: 0, responsibilities: '' });
  }
  async function submit(values: FormValues) {
    if (!organizationId) return; setSubmitting(true);
    try {
      if (editing) await masterDataApi.positions.update(editing.id, { ...values, version: editing.version } as UpdatePositionInput);
      else await masterDataApi.positions.create({ ...values, organizationId } as CreatePositionInput);
      message.success('岗位已保存'); setOpen(false); await load();
    } catch { message.error('操作未完成，当前输入已保留'); }
    finally { setSubmitting(false); }
  }
  async function toggle(position: Position) {
    try { if (position.status === 'ENABLED') await masterDataApi.positions.disable(position.id, { version: position.version }); else await masterDataApi.positions.enable(position.id, { version: position.version }); message.success('岗位状态已更新'); await load(); }
    catch { message.error(position.activeAssignmentCount > 0 ? '该岗位仍有在任人员，无法停用' : '岗位状态更新失败'); }
  }

  return <section className="md-page"><header className="md-toolbar"><div><h1>岗位管理</h1><p>岗位编码在组织内唯一，任职关系以岗位所属组织为准。</p></div><div className="md-toolbar-actions"><Select aria-label="组织筛选" value={organizationId} options={organizationOptions} onChange={setOrganizationId} style={{ minWidth: 220 }} /><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Button type="primary" icon={<PlusOutlined />} disabled={!organizationId} onClick={() => showForm()}>新增岗位</Button></div></header>
    {error && <Alert type="error" showIcon message="岗位数据加载失败" action={<Button onClick={() => void load()}>重试</Button>} />}
    <PositionTable data={positions} loading={loading} onEdit={showForm} onToggle={position => void toggle(position)} onRetry={() => void load()} />
    <Modal title={editing ? '编辑岗位' : '新增岗位'} open={open} confirmLoading={submitting} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={submit}><Form.Item label="所属组织"><Input value={selectedName} disabled /></Form.Item><Form.Item name="code" label="岗位编码" rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item><Form.Item name="name" label="岗位名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="categoryCode" label="岗位分类" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="level" label="岗位级别" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item><Form.Item name="responsibilities" label="岗位职责"><Input.TextArea rows={4} /></Form.Item></Form>
    </Modal>
  </section>;
}
