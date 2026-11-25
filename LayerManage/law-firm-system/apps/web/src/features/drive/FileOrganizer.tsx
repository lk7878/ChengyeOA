import { useEffect, useState } from 'react';
import { Alert, Button, Input, Select, Space, Spin, TreeSelect } from 'antd';
import Modal from '@/components/DraggableModal';
import { get, post, errorMessage } from '../workspaces/api';

type Folder = { id: string; parentId: string | null; name: string };
type Entry = { id: string; name: string; version: number };
type Preview = { token: string; count: number; size: number; entries: { id: string; from: string; to: string; skipped: boolean }[]; changes: { name: string; gained: number; lost: number; changed: number }[] };
type TreeNode = { value: string; title: string; disabled?: boolean; children: TreeNode[] };
export default function FileOrganizer({ operation, files, onClose, onDone }: { operation: 'move' | 'copy'; files: Entry[]; onClose: () => void; onDone: () => void }) {
  const [folders, setFolders] = useState<Folder[]>(), [target, setTarget] = useState('__root__');
  const [collision, setCollision] = useState('rename'), [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [folderName, setFolderName] = useState('');
  const label = operation === 'move' ? '移动' : '复制';
  useEffect(() => {
    let active = true;
    void get<{ items: Folder[] }>('/personal-files/organization-folders').then(r => { if (active) setFolders(r.items); }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);
  const blocked = new Set(files.map(f => f.id));
  let changed = true;
  while (changed) { changed = false; for (const f of folders ?? []) if (f.parentId && blocked.has(f.parentId) && !blocked.has(f.id)) { blocked.add(f.id); changed = true; } }
  const tree = (parentId: string | null): TreeNode[] => (folders ?? []).filter(f => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name)).map(f => ({ value: f.id, title: f.name, disabled: blocked.has(f.id), children: tree(f.id) }));
  const body = { operation, files: files.map(({ id, version }) => ({ id, version })), targetId: target === '__root__' ? null : target, collision };
  const submit = async () => {
    setBusy(true); setError('');
    try {
      if (!preview) setPreview(await post<Preview>('/personal-files/organize/preview', body, undefined, 130000));
      else { await post('/personal-files/organize', { ...body, token: preview.token }, undefined, 130000); onDone(); }
    } catch (e) { setError(errorMessage(e)); setPreview(undefined); }
    finally { setBusy(false); }
  };
  return <Modal open title={`${label}文件和文件夹`} onCancel={() => { if (!busy) onClose(); }} width={680}
    footer={<Space><Button disabled={busy} onClick={preview ? () => setPreview(undefined) : onClose}>{preview ? '上一步' : '取消'}</Button><Button type="primary" aria-label={preview ? `确认${label}` : '下一步：核对整理结果'} loading={busy} disabled={busy || !folders || (preview && !preview.count)} onClick={() => void submit()}>{preview ? `确认${label}` : '下一步：核对整理结果'}</Button></Space>}>
    {error && <Alert type="error" title={error} />}
    {!folders ? <Spin aria-label="加载目标目录" /> : !preview ? <Space orientation="vertical" style={{ width: '100%' }}>
      <p>已选择 {files.length} 项{operation === 'copy' ? '；复制当前版本，副本独立保存。' : '；移动后保留文件历史版本及直接分享。'}</p>
      <label htmlFor="organize-target">目标文件夹</label>
      <TreeSelect id="organize-target" aria-label="目标文件夹" style={{ width: '100%' }} showSearch treeNodeFilterProp="title" treeDefaultExpandAll value={target} onChange={setTarget} treeData={[{ value: '__root__', title: '我的文件根目录', children: tree(null) }]} />
      <Space.Compact style={{ width: '100%' }}><Input aria-label="新建目标文件夹名称" placeholder="新建文件夹名称" value={folderName} maxLength={150} onChange={e => setFolderName(e.target.value)} /><Button disabled={busy || !folderName.trim()} onClick={async () => {
        setBusy(true); setError('');
        try {
          const { id } = await post<{ id: string }>('/personal-files', { name: folderName.trim(), kind: 'FOLDER', parentId: body.targetId });
          setFolders(current => [...(current ?? []), { id, name: folderName.trim(), parentId: body.targetId }]); setTarget(id); setFolderName('');
        } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
      }}>新建文件夹</Button></Space.Compact>
      <label htmlFor="organize-collision">目标目录有同名内容时</label>
      <Select id="organize-collision" aria-label="同名处理" style={{ width: '100%' }} value={collision} onChange={setCollision} options={[{ value: 'rename', label: '自动添加“副本”序号，不覆盖' }, { value: 'skip', label: '跳过同名内容' }]} />
    </Space> : <>
      <p>将{label} {preview.count} 项（含下级内容），目标：{target === '__root__' ? '我的文件根目录' : folders.find(f => f.id === target)?.name}。</p>
      <div style={{ maxHeight: '32vh', overflow: 'auto', overflowWrap: 'anywhere' }}><ul>{preview.entries.map(e => <li key={e.id}>{e.from}{e.skipped ? '（跳过）' : e.from !== e.to ? ` → ${e.to}` : ''}</li>)}</ul></div>
      <h4>共享访问变化</h4>
      <div style={{ maxHeight: '24vh', overflow: 'auto' }}>{preview.changes.length ? preview.changes.map(c => <p key={c.name}>{c.name}：新增可访问 {c.gained} 项，失去访问 {c.lost} 项，权限等级变化 {c.changed} 项。</p>) : <p>没有其他人员的访问范围变化。</p>}</div>
      {operation === 'copy' && <p>副本不沿用原来的直接分享；目标文件夹的共享权限会按上述结果应用。</p>}
    </>}
  </Modal>;
}
