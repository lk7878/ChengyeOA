import { useState } from 'react';
import { Alert, Button, Form, Radio, Space, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { useAuthStore } from '@/stores/authStore';
import { errorMessage } from '@/features/workspaces/api';
import { defaultAppearance, useAppearance, useAppearanceStore, type Appearance } from './store';

export default function AppearanceSettings({ onClose }: { onClose(): void }) {
  const preferences = useAppearance();
  const [changes, setDraft] = useState<Appearance>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const draft = changes ?? preferences;
  const accountId = useAuthStore(state => state.userInfo?.id);
  const { status, load, save } = useAppearanceStore();
  const submit = async () => {
    if (busy || status !== 'ready') return;
    setBusy(true); setError('');
    try { await save(draft); message.success('外观设置已保存'); onClose(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <Modal open className="oa-appearance-settings" title="外观设置" width={520} onCancel={() => { if (!busy) onClose(); }}
    footer={<Space wrap><Button disabled={busy} onClick={() => setDraft({ ...defaultAppearance })}>恢复默认</Button>
      <Button disabled={busy} onClick={onClose}>取消</Button>
      <Button type="primary" loading={busy} disabled={status !== 'ready'} onClick={() => void submit()}>保存</Button></Space>}>
    <p style={{ marginBottom: 16 }}>仅对当前账号生效，点击“保存”后应用；恢复默认后也需保存。</p>
    {status === 'error' && <Alert type="error" title="无法读取个人设置，请重试。" action={<Button onClick={() => { if (accountId) void load(accountId); }}>重试</Button>}/>}
    {status === 'loading' && <p>正在读取个人设置…</p>}
    {error && <Alert type="error" title={error}/>}
    <Form layout="vertical" disabled={busy || status !== 'ready'}>
      <Form.Item label="界面模式"><Radio.Group aria-label="界面模式" value={draft.colorMode || 'light'}
        onChange={e => setDraft({ ...draft, colorMode: e.target.value })} options={[
          { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
        ]}/><div>同步应用到 OA 和智慧办案。</div></Form.Item>
      <Form.Item label="字体大小"><Radio.Group name="appearance-font-size" aria-label="字体大小" value={draft.fontSize}
        onChange={e => setDraft({ ...draft, fontSize: e.target.value })} options={[
          { value: 'standard', label: '标准' }, { value: 'large', label: '大' }, { value: 'extraLarge', label: '特大' },
        ]}/></Form.Item>
      <Form.Item label="背景配色"><Radio.Group name="appearance-background" aria-label="背景配色" value={draft.background}
        onChange={e => setDraft({ ...draft, background: e.target.value })} options={[
          { value: 'default', label: '默认' }, { value: 'beige', label: '柔和米色' }, { value: 'green', label: '淡绿色' },
        ]}/></Form.Item>
      <Form.Item label="表格行高"><Radio.Group name="appearance-row-height" aria-label="表格行高" value={draft.rowHeight}
        onChange={e => setDraft({ ...draft, rowHeight: e.target.value })} options={[
          { value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'comfortable', label: '宽松' },
        ]}/></Form.Item>
    </Form>
  </Modal>;
}
