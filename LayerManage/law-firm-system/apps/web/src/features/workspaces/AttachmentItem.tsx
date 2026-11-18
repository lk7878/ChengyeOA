import FilePreviewButton from '@/features/files/FilePreviewButton';
import { decodeAttachment, downloadBlob } from '@/api/approval-materials';
import { useEffect, useState } from 'react';
import { Button, message } from 'antd';
import { authenticatedFetch, get } from './api';

export default function AttachmentItem({ tableId, id }: { tableId: string; id: string }) {
  const [loaded, setLoaded] = useState<{ tableId: string; id: string; name: string; mimeType: string }>();
  let metadata = loaded?.tableId === tableId && loaded.id === id ? loaded : undefined;
  if (id.startsWith('case-file:')) {
    metadata = undefined;
    try {
      const value = JSON.parse(id.slice(10));
      if (value && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.mimeType === 'string') {
        metadata = { tableId, id, name: value.name, mimeType: value.mimeType };
      }
    } catch { /* Invalid file references remain unavailable. */ }
  }

  useEffect(() => {
    let alive = true;
    if (id.startsWith('case-file:')) return;
    void get<{ name: string; mimeType: string }>('/tables/' + tableId + '/files/' + id + '?metadata=true')
      .then((result) => {
        if (alive) setLoaded({ ...result, tableId, id });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tableId, id]);
  if (!metadata) return <Button type="link" disabled>附件不可访问</Button>;
  const caseFile = id.startsWith('case-file:') ? JSON.parse(id.slice(10)) : undefined;
  const url = caseFile ? '/api/v1/files/' + encodeURIComponent(caseFile.id) + '/download'
    : '/api/v1/tables/' + encodeURIComponent(tableId) + '/files/' + encodeURIComponent(id);
  const name = metadata.name;
  async function download() {
    try {
      const response = await authenticatedFetch(url);
      if (!response.ok) throw new Error('unavailable');
      const blob = caseFile ? new Blob([decodeAttachment((await response.json()).data.base64)]) : await response.blob();
      downloadBlob(blob, name);
    } catch { message.error('附件已不可访问，请刷新记录。'); }
  }
  return <>
    <FilePreviewButton link name={name} url={url}>{name}</FilePreviewButton>
    <Button size="small" type="link" onClick={() => void download()}>下载</Button>
  </>;
}
