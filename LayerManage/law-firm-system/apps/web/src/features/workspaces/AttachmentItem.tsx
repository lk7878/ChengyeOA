import Modal from '@/components/DraggableModal';
import { useEffect, useState } from 'react';
import { Button, message } from 'antd';
import { authenticatedFetch, get } from './api';

export default function AttachmentItem({ tableId, id }: { tableId: string; id: string }) {
  const [metadata, setMetadata] = useState<{ name: string; mimeType: string }>();
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (id.startsWith('case-file:')) {
      try {
        const value = JSON.parse(id.slice(10));
        if (
          typeof value.id === 'string' &&
          typeof value.name === 'string' &&
          typeof value.mimeType === 'string'
        )
          setMetadata({ name: value.name, mimeType: value.mimeType });
      } catch {
        setMetadata(undefined);
      }
      return;
    }
    void get<{ name: string; mimeType: string }>('/tables/' + tableId + '/files/' + id + '?metadata=true')
      .then((result) => {
        if (alive) setMetadata(result);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tableId, id]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const open = async () => {
    try {
      const caseFile = id.startsWith('case-file:') ? JSON.parse(id.slice(10)) : null;
      const response = await authenticatedFetch(
        caseFile
          ? '/api/v1/files/' + encodeURIComponent(caseFile.id) + '/download'
          : '/api/v1/tables/' + tableId + '/files/' + id,
      );
      if (!response.ok) throw new Error('unavailable');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (metadata?.mimeType.startsWith('image/') || metadata?.mimeType === 'application/pdf')
        setPreview(url);
      else {
        const link = document.createElement('a');
        link.href = url;
        link.download = metadata?.name || '附件';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      message.error('附件已不可访问，请刷新记录。');
    }
  };
  return (
    <>
      <Button
        size="small"
        type="link"
        disabled={!metadata}
        onClick={() => {
          void open();
        }}
      >
        {metadata?.name || '附件不可访问'}
      </Button>
      <Modal
        open={!!preview}
        title={metadata?.name}
        onCancel={() => setPreview(undefined)}
        footer={null}
        destroyOnHidden
        width={800}
      >
        {preview &&
          (metadata?.mimeType.startsWith('image/') ? (
            <img alt={metadata.name} src={preview} style={{ maxWidth: '100%', maxHeight: '70vh' }} />
          ) : (
            <iframe
              title={metadata?.name}
              src={preview}
              style={{ width: '100%', height: '70vh', border: 0 }}
            />
          ))}
      </Modal>
    </>
  );
}
