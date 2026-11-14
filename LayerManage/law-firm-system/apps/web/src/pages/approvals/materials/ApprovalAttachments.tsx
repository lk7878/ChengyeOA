import { lazy, Suspense, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert, Button, Image, Progress, Space, Spin, Tag, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { approvalMaterialsApi, decodeAttachment, downloadBlob, type ApprovalAttachment } from '@/api/approval-materials';
import './materials.css';
const OfficeEditor = lazy(() => import('./OfficeEditor'));
export const APPROVAL_ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf,.xlsx,.docx';

export default function ApprovalAttachments({ files = [], onChange, onBusy, instanceId }: {
  files?: ApprovalAttachment[]; onChange?: Dispatch<SetStateAction<ApprovalAttachment[]>>; onBusy?: (busy: boolean) => void; instanceId?: string;
}) {
  const [storedFiles, setStoredFiles] = useState<ApprovalAttachment[]>([]);
  const [progress, setProgress] = useState<{ name: string; percent: number }>();
  const [failure, setFailure] = useState('');
  const [listError, setListError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<ApprovalAttachment>();
  const [bytes, setBytes] = useState<Uint8Array<ArrayBuffer>>();
  const [url, setUrl] = useState('');
  const [dirty, setDirty] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const visibleFiles = instanceId ? storedFiles : files;
  const readOnly = !!instanceId;
  const load = async () => {
    if (!instanceId) return;
    setLoading(true); setListError(false);
    try { setStoredFiles((await approvalMaterialsApi.list(instanceId)).data); } catch { setListError(true); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let cancelled = false;
    if (instanceId) approvalMaterialsApi.list(instanceId).then(response => { if (!cancelled) setStoredFiles(response.data); }).catch(() => { if (!cancelled) setListError(true); });
    return () => { cancelled = true; };
  }, [instanceId]);
  useEffect(() => { onBusy?.(!!progress || !!failure || dirty); }, [progress, failure, dirty, onBusy]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const upload = async (incoming: File[], sourceId?: string) => {
    if (!onChange) return [];
    const uploaded: ApprovalAttachment[] = [];
    if (files.length + incoming.length > 20 || files.reduce((sum, file) => sum + file.fileSize, 0) + incoming.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) { throw new Error('每次申请最多 20 份附件，总计 100 MB'); }
    setFailure('');
    for (const file of incoming) {
      if (!/\.(png|jpe?g|webp|pdf|xlsx|docx)$/i.test(file.name) || file.size > 10 * 1024 * 1024 || !file.size) { setFailure(`${file.name}：支持图片、PDF、XLSX、DOCX，单文件不超过 10 MB；旧版 XLS/DOC 请先另存为新格式`); throw new Error('附件格式或大小不符合要求'); }
      setProgress({ name: file.name, percent: 0 });
      try {
        const response = await approvalMaterialsApi.upload(file, sourceId, percent => setProgress({ name: file.name, percent }));
        uploaded.push(response.data);
        onChange(current => [...current, response.data]);
      } catch { setFailure(`${file.name} 上传失败，请重新选择文件上传，或移除此失败提示后继续`); throw new Error('上传失败，修改内容已保留'); }
      finally { setProgress(undefined); }
    }
    return uploaded;
  };
  const preview = async (file: ApprovalAttachment) => {
    setActive(file); setBytes(undefined); setDirty(false);
    try { const response = await approvalMaterialsApi.download(file.id, 'PREVIEW'); const data = decodeAttachment(response.data.base64); setUrl(URL.createObjectURL(new Blob([data], { type: file.mimeType }))); setBytes(data); }
    catch { setActive(undefined); }
  };
  const close = () => {
    const discard = () => { setActive(undefined); setBytes(undefined); setUrl(''); setDirty(false); };
    if (dirty) Modal.confirm({ title: '放弃尚未保存的修改？', content: '已上传的原件仍会保留。', okText: '放弃修改', cancelText: '继续编辑', onOk: discard }); else discard();
  };
  const download = async (file: ApprovalAttachment) => {
    try { const result = await approvalMaterialsApi.download(file.id); downloadBlob(new Blob([decodeAttachment(result.data.base64)], { type: file.mimeType }), file.fileName); } catch { /* API 已提示 */ }
  };
  const remove = async (file: ApprovalAttachment) => {
    // A source referenced by a revision stays available as the original evidence.
    if (files.some(item => item.sourceId === file.id)) { message.info('请先移除此文件的修改版，再移除原件'); return; }
    try { await approvalMaterialsApi.remove(file.id); onChange?.(current => current.filter(item => item.id !== file.id)); } catch { /* API 已提示 */ }
  };
  return <div>
    {!readOnly && <>
      <input ref={inputRef} type="file" aria-label="选择审批附件" multiple accept={APPROVAL_ACCEPT} hidden onChange={event => { const selected = Array.from(event.target.files || []); event.target.value = ''; void upload(selected).catch(error => message.error(error.message)); }} />
      <Button onClick={() => inputRef.current?.click()} disabled={!!progress || dirty}>上传附件或证明材料</Button>
      <p style={{ color: '#666', fontSize: 12 }}>图片、PDF、XLSX、DOCX；单文件 10 MB，最多 20 份。提交后材料冻结。</p>
    </>}
    {progress && <div>{progress.name}<Progress percent={progress.percent} /></div>}
    {failure && <Alert type="error" title={failure} closable onClose={() => setFailure('')} />}
    {listError && <Alert type="error" title="附件列表加载失败" action={<Button onClick={() => void load()}>重试</Button>} />}
    {loading && <Spin />}
    {visibleFiles.map(file => <div className="approval-file-row" key={file.id}>
      <span>{file.fileName} <small>({(file.fileSize / 1024).toFixed(1)} KB)</small>{file.sourceId && <Tag>副本</Tag>}</span>
      <Space wrap><Button size="small" onClick={() => void preview(file)}>{!readOnly && /\.(docx|xlsx)$/i.test(file.fileName) ? '预览 / 编辑' : '预览'}</Button><Button size="small" onClick={() => void download(file)}>下载</Button>{!readOnly && <Button size="small" danger disabled={!!progress} onClick={() => void remove(file)}>移除</Button>}</Space>
    </div>)}
    {readOnly && !visibleFiles.length && !listError && <p>无附件</p>}
    <Modal title={active?.fileName || '附件预览'} open={!!active} onCancel={close} footer={null} width={1100} destroyOnHidden mask={{ closable: !dirty }}>
      {!bytes ? <Spin /> : active?.mimeType.startsWith('image/') ? <Image src={url} alt={active.fileName} style={{ maxHeight: '70vh' }} /> : active?.mimeType === 'application/pdf' ? <iframe title="PDF 材料预览" src={url} style={{ width: '100%', height: '70vh', border: 0 }} /> : active && <Suspense fallback={<Spin />}><OfficeEditor key={active.id} bytes={bytes.buffer} fileName={active.fileName} readOnly={readOnly} onDirty={setDirty} onSave={async (file, exportCopy) => { const saved = await upload([file], active.id); if (exportCopy) await download(saved[0]); setActive(undefined); setBytes(undefined); setDirty(false); }} /></Suspense>}
    </Modal>
  </div>;
}
