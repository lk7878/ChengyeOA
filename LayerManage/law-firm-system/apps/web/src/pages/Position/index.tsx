import { useAuthStore } from '@/stores/authStore';
import { categoryLabel, positionCodeLabel, newPositionCode, POSITION_CATEGORIES } from '@/locales/business-labels';
import { showRequestError } from '@/api/errors';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { masterDataApi } from '@/features/master-data/api';
import PositionTable from '@/features/master-data/components/PositionTable';
import type { CreatePositionInput, OrganizationNode, Position, UpdatePositionInput } from '@/features/master-data/types';
import '@/features/master-data/master-data.css';
import { textRules } from '@/features/master-data/form-rules';

function flatten(nodes: OrganizationNode[]): OrganizationNode[] { return nodes.flatMap(node => [node, ...flatten(node.children)]); }
type FormValues = { code: string; name: string; categoryCode: string; level: number; responsibilities?: string };

export default function PositionPage() {
  const canDelete = useAuthStore(state => Boolean(state.authorization?.isSystemSuperAdmin));
  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null);
  const [deleting, setDeleting] = useState(false);
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
  const categoryOptions = [...POSITION_CATEGORIES, ...[...new Set(positions.map(position => position.categoryCode))].filter(code => !POSITION_CATEGORIES.some(option => option.value === code)).map(code => ({ value: code, label: categoryLabel(code) }))];
  const selectedName = organizationOptions.find(item => item.value === organizationId)?.label;

  useEffect(() => { void (async () => { try { const response = await masterDataApi.organizations.options('ENABLED'); setOrganizations(response.data); setOrganizationId(response.data[0]?.id); } catch { setError(true); setLoading(false); } })(); }, []);
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
    form.setFieldsValue(position ? { code: position.code, name: position.name, categoryCode: position.categoryCode, level: position.level, responsibilities: position.responsibilities ?? undefined } : { code: newPositionCode(), name: '', categoryCode: 'LEGAL', level: 0, responsibilities: '' });
  }
  async function submit(values: FormValues) {
    if (!organizationId) return; setSubmitting(true);
    try {
      if (editing) await masterDataApi.positions.update(editing.id, {
        name: values.name, categoryCode: values.categoryCode, level: values.level,
        responsibilities: values.responsibilities, version: editing.version,
      } satisfies UpdatePositionInput);
      else await masterDataApi.positions.create({ ...values, organizationId } as CreatePositionInput);
      message.success('岗位已保存'); setOpen(false); await load();
    } catch (error) { showRequestError(error, '操作未完成，当前输入已保留'); }
    finally { setSubmitting(false); }
  }
  async function removePosition() {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await masterDataApi.positions.remove(deleteTarget.id, { version: deleteTarget.version }); message.success('岗位已删除'); setDeleteTarget(null); await load(); }
    catch (error) { showRequestError(error, '岗位删除失败'); }
    finally { setDeleting(false); }
  }
  async function toggle(position: Position) {
    try { if (position.status === 'ENABLED') await masterDataApi.positions.disable(position.id, { version: position.version }); else await masterDataApi.positions.enable(position.id, { version: position.version }); message.success('岗位状态已更新'); await load(); }
    catch (error) { showRequestError(error, position.activeAssignmentCount > 0 ? '该岗位仍有在任人员，无法停用' : '岗位状态更新失败'); }
  }

  return <section className="md-page"><header className="md-toolbar"><div><h1>岗位管理</h1><p>拖动表头右侧可调整列宽；岗位编码自动分配，任职关系以所属组织为准。</p></div><div className="md-toolbar-actions"><Select aria-label="组织筛选" value={organizationId} options={organizationOptions} onChange={setOrganizationId} style={{ minWidth: 220 }} /><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Button type="primary" icon={<PlusOutlined />} disabled={!organizationId} onClick={() => showForm()}>新增岗位</Button></div></header>
    {error && <Alert type="error" showIcon title="岗位数据加载失败" action={<Button onClick={() => void load()}>重试</Button>} />}
    <PositionTable onDelete={canDelete ? setDeleteTarget : undefined} data={positions} loading={loading} onEdit={showForm} onToggle={position => void toggle(position)} onRetry={() => void load()} />
    <Modal title="删除岗位" open={Boolean(deleteTarget)} onCancel={() => setDeleteTarget(null)} onOk={() => void removePosition()} confirmLoading={deleting} okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }}>
      <p>确认删除岗位“{deleteTarget?.name}”？</p><p>存在当前或历史任职关联的岗位无法删除，请保留岗位并按需停用。</p>
    </Modal>
    <Modal title={editing ? '编辑岗位' : '新增岗位'} open={open} confirmLoading={submitting} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnHidden okText="确定" cancelText="取消">
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item label="所属组织"><Input value={selectedName} disabled /></Form.Item>
        <Form.Item name="code" label="岗位编码" extra="系统自动分配稳定编号；原始编码可通过悬停查看。"><PositionCodeInput name={editing?.name} /></Form.Item>
        <Form.Item name="name" label="岗位名称" rules={textRules('岗位名称')}><Input maxLength={100} /></Form.Item>
        <Form.Item name="categoryCode" label="岗位分类" rules={[{ required: true, message: '请选择岗位分类' }]}><Select showSearch optionFilterProp="label" options={categoryOptions} /></Form.Item>
        <Form.Item name="level" label="岗位级别" rules={[{ required: true, message: '请输入岗位级别' }]}><InputNumber min={0} precision={0} /></Form.Item>
        <Form.Item name="responsibilities" label="岗位职责" rules={textRules('岗位职责', 0, 2000, false)}><Input.TextArea rows={4} maxLength={2000} showCount /></Form.Item>
      </Form>
    </Modal>
  </section>;
}

function PositionCodeInput({ value = '', name, id }: { value?: string; name?: string; id?: string }) {
  return <Input id={id} disabled value={value ? positionCodeLabel(value, name) : '自动分配'} title={`内部编码：${value}`} />;
}
