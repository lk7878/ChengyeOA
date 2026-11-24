import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Space, Spin, Tabs, Tag, Typography } from 'antd';
import Modal from '@/components/DraggableModal';
import { errorMessage, get, post } from './api';
import { fieldNames } from './types';
import type { Field } from './types';

type ManagedField = Field & { stopped: boolean; system: boolean; core: boolean; reason: string };
type Listing = { fields: ManagedField[]; version: number; superAdmin: boolean };
type Report = { field: Field; version: number; blockers: string[]; token: string;
  impact: { activeRecords: number; recycledRecords: number; extensionRecords: number; revisions: number; undoEntries: number } };

export function FieldManagement({ tableId, version, canManage, onCreate, onEdit, onChanged }: {
  tableId: string; version: number; canManage: boolean; onCreate: () => void; onEdit: (field: Field) => void; onChanged: () => void;
}) {
  const [data, setData] = useState<Listing>();
  const [tab, setTab] = useState('active');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState<{ action: 'stop' | 'restore' | 'delete'; field: ManagedField; report?: Report }>();
  const [confirmationName, setConfirmationName] = useState('');
  const [presentation, setPresentation] = useState<ManagedField>();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    get<Listing>('/tables/' + tableId + '/field-management').then(value => { if (active) { setData(value); setError(''); } })
      .catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tableId, version, canManage, reload]);
  const changed = () => { setLoading(true); setReload(x => x + 1); onChanged(); };
  const endpoint = (field: Field) => '/tables/' + tableId + '/fields/' + field.id;
  const requestConfirmation = async (field: ManagedField, action: 'stop' | 'restore' | 'delete') => {
    setError(''); setConfirmationName(''); setBusy(true);
    try {
      const report = action === 'restore' ? undefined : await get<Report>(endpoint(field) + '/removal-preview?action=' + action);
      setConfirm({ action, field, report });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!confirm || !data) return;
    setBusy(true); setError('');
    try {
      await post(endpoint(confirm.field) + '/manage', { action: confirm.action, version: confirm.report?.version ?? data.version,
        ...(confirm.action === 'delete' ? { token: confirm.report?.token, confirmName: confirmationName } : {}) });
      setConfirm(undefined); changed();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const savePresentation = async () => {
    if (!presentation || !data) return;
    const values = await form.validateFields(); setBusy(true); setError('');
    try { await post(endpoint(presentation) + '/manage', { action: 'presentation', version: data.version, ...values }); setPresentation(undefined); changed(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  if (!canManage) return <Alert type="info" title="需要表格管理权限才能配置、停用或恢复字段。" />;
  const fields = data?.fields.filter(f => f.stopped === (tab === 'stopped')) ?? [];
  return <>
    {error && <Alert type="error" title={error} showIcon />}
    <Space><Button type="primary" onClick={onCreate} disabled={busy}>＋新增字段</Button><Button onClick={() => { setLoading(true); setError(''); setReload(x => x + 1); }} disabled={busy}>刷新字段</Button></Space>
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'active', label: '使用中（' + (data?.fields.filter(f => !f.stopped).length ?? 0) + '）' },
      { key: 'stopped', label: '已停用（' + (data?.fields.filter(f => f.stopped).length ?? 0) + '）' },
    ]} />
    <Spin spinning={loading}>
      {!loading && !fields.length && <Typography.Text type="secondary">暂无{tab === 'stopped' ? '已停用' : '使用中'}字段</Typography.Text>}
      {fields.map(field => <div key={field.id} className="workspace-field-row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}><strong>{field.name}</strong><div><Typography.Text type="secondary">{fieldNames[field.type] || field.type}</Typography.Text> {field.system && <Tag>系统业务字段</Tag>}</div>
          {field.reason && <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 0' }}>{field.reason}</Typography.Paragraph>}
        </div>
        <Space wrap>
          <Button disabled={busy || field.stopped || field.system && !data?.superAdmin} onClick={() => {
            if (!field.system) { onEdit(field); return; }
            form.setFieldsValue({ name: field.name, helpText: field.options.helpText ?? '' }); setPresentation(field);
          }}>{field.system ? '展示配置' : '配置'}</Button>
          <Button danger={!field.stopped} disabled={busy || !field.stopped && field.core || field.system && !data?.superAdmin}
            onClick={() => void requestConfirmation(field, field.stopped ? 'restore' : 'stop')}>{field.stopped ? '恢复' : '停用'}</Button>
          {data?.superAdmin && field.stopped && !field.system && !field.core && <Button danger disabled={busy} onClick={() => void requestConfirmation(field, 'delete')}>彻底删除</Button>}
        </Space>
      </div>)}
    </Spin>
    <Modal open={!!confirm} title={(confirm?.action === 'delete' ? '彻底删除字段 · ' : confirm?.action === 'restore' ? '恢复字段 · ' : '停用字段 · ') + (confirm?.field.name ?? '')}
      onCancel={() => { if (!busy) { setConfirm(undefined); setError(''); } }} onOk={() => void apply()} confirmLoading={busy}
      okText={confirm?.action === 'delete' ? '确认彻底删除' : '确认'} cancelText="取消"
      okButtonProps={{ danger: confirm?.action === 'delete', disabled: !!confirm?.report?.blockers.length || confirm?.action === 'delete' && confirmationName !== confirm.report?.field.name }}>
      {error && <Alert type="error" title={error} />}
      {!!confirm?.report?.blockers.length && <Alert type="warning" title="请先处理以下依赖" description={<ul>{confirm.report.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>} />}
      {confirm?.action === 'stop' && <p>{confirm.field.system ? '停止在当前表格展示此字段。底层业务数据、同步关系及业务表单保留。' : '停用后不再展示此字段，已有值保留，可在“已停用”中恢复。'}</p>}
      {confirm?.action === 'restore' && <p>恢复后重新显示字段，原有值保留；如当前视图曾隐藏该列，可到“视图配置”重新勾选。</p>}
      {confirm?.action === 'delete' && confirm.report && <>
        <p>将永久删除字段及其对应值：当前记录 {confirm.report.impact.activeRecords} 条、回收站记录 {confirm.report.impact.recycledRecords} 条、业务扩展记录 {confirm.report.impact.extensionRecords} 条、字段历史 {confirm.report.impact.revisions} 条。</p>
        <p>涉及的 {confirm.report.impact.undoEntries} 条撤销/重做快照中，此字段的值也将清除。其他字段与记录保留；操作审计保留。</p>
        <Alert type="warning" showIcon title="此操作不可恢复。请核对范围，并输入字段名称确认。" />
        <Input aria-label="输入字段名称确认删除" value={confirmationName} onChange={e => setConfirmationName(e.target.value)} placeholder={confirm.report.field.name} style={{ marginTop: 12 }} />
      </>}
    </Modal>
    <Modal open={!!presentation} title="系统业务字段展示配置" onCancel={() => { if (!busy) setPresentation(undefined); }} onOk={() => void savePresentation()} confirmLoading={busy} okText="保存" cancelText="取消">
      {error && <Alert type="error" title={error} />}
      <Form form={form} layout="vertical"><Form.Item name="name" label="显示名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="helpText" label="填写说明"><Input.TextArea maxLength={1000} rows={3} /></Form.Item></Form>
    </Modal>
  </>;
}
