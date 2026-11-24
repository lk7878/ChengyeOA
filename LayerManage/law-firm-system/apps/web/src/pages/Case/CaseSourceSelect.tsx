import { useEffect, useState } from 'react';
import { Alert, Button, Input, List, Select, Space, Tag } from 'antd';
import Modal from '@/components/DraggableModal';
import { get, post, errorMessage } from '@/features/workspaces/api';

type Source = { name: string; enabled: boolean; version: number };
type Directory = { items: Source[]; canManage: boolean };

/** Business dictionary only: selecting a source never changes ownership or grants. */
export default function CaseSourceSelect({ value, onChange, disabled }: {
  value?: string; onChange?: (value: string | undefined) => void; disabled?: boolean;
}) {
  const [directory, setDirectory] = useState<Directory>({ items: [], canManage: false });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  async function refresh() {
    setLoading(true);
    try { setDirectory(await get<Directory>('/case-sources')); setError(''); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    void get<Directory>('/case-sources').then(data => { if (active) setDirectory(data); })
      .catch(e => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function save(input: { name: string; enabled?: boolean; version?: number }) {
    setSaving(true);
    try { await post('/case-sources', input); setName(''); await refresh(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); }
  }
  const errors = error ? <Alert type="error" title={error} action={<Button onClick={() => void refresh()}>重试</Button>} /> : null;
  return <>
    <Space.Compact style={{ width: '100%' }}>
      <Select aria-label="案件来源" style={{ flex: 1, minWidth: 0 }} value={value} onChange={next => onChange?.(next)}
        disabled={disabled} loading={loading} showSearch optionFilterProp="label" allowClear
        placeholder="选择案件来源" options={directory.items.filter(s => s.enabled).map(s => ({ value: s.name, label: s.name }))} />
      {directory.canManage && <Button onClick={() => setOpen(true)}>管理来源</Button>}
    </Space.Compact>
    {!open && errors}
    <Modal title="案件来源管理" open={open} onCancel={() => setOpen(false)} footer={null}>
      <p>来源仅用于业务分类。停用后不再供新选，历史案件中的来源保留。</p>
      {errors}
      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Input aria-label="新增来源名称" placeholder="新增来源名称" maxLength={100} value={name} onChange={e => setName(e.target.value)} />
        <Button type="primary" loading={saving} disabled={!name.trim() || loading} onClick={() => void save({ name })}>新增来源</Button>
        <Button disabled={saving} onClick={() => void refresh()}>刷新</Button>
      </Space.Compact>
      <List loading={loading} dataSource={directory.items} renderItem={item => <List.Item actions={[
        <Button key="status" disabled={saving} onClick={() => void save({ name: item.name, enabled: !item.enabled, version: item.version })}>
          {item.enabled ? '停用' : '恢复'}
        </Button>,
      ]}>{item.name} <Tag>{item.enabled ? '启用' : '已停用'}</Tag></List.Item>} />
    </Modal>
  </>;
}
