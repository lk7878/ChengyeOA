import FilePreviewButton from '@/features/files/FilePreviewButton';
import { useRef, useState } from 'react';
import { Alert, Button, Card, Input, Space } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { post, get } from '@/features/workspaces/api';
import { useLiveSop } from '@/features/sop/execution';
import { showRequestError } from '@/api/errors';
type FileRow = { id: string; fileName: string; fileSize: number };
export function SopSourceMaterials({ taskId }: { taskId: string }) {
  const can = useAuthStore((s) => s.hasPermission);
  return (
    <Card title="前期材料" style={{ marginTop: 16 }}>
      <p>材料保留在原线索或分析委托下。关联案件不会自动开放这些材料。</p>
      {can('sop.material.read') && <FileList taskId={taskId} />}
      {can('sop.material.manage') && <Upload taskId={taskId} />}
    </Card>
  );
}
function FileList({ taskId }: { taskId: string }) {
  const [page, setPage] = useState(1),
    live = useLiveSop<{ list: FileRow[]; total: number }>(
      '/sop/tasks/' + taskId + '/source-materials?page=' + page,
    );
  async function download(id: string) {
    try {
      const file = await get<{ base64: string; fileName: string; fileType: string }>(
          '/sop/tasks/' + taskId + '/source-materials/' + id,
        ),
        bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0)),
        url = URL.createObjectURL(new Blob([bytes], { type: file.fileType })),
        a = document.createElement('a');
      a.href = url;
      a.download = file.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      showRequestError(e);
    }
  }
  return (
    <>
      {live.error && <Alert type="error" title={live.error} />}{' '}
      {live.data?.list.map((f) => (
        <p key={f.id}>
          <FilePreviewButton link name={f.fileName} url={`/api/v1/sop/tasks/${taskId}/source-materials/${f.id}`}>{f.fileName}</FilePreviewButton>
          <Button onClick={() => void download(f.id)}>下载</Button> {f.fileSize} 字节
        </p>
      ))}
      {live.data && !live.data.list.length && <p>暂无材料</p>}
      <Space>
        <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          上一页材料
        </Button>
        <Button disabled={!live.data || page * 100 >= live.data.total} onClick={() => setPage((p) => p + 1)}>
          下一页材料
        </Button>
      </Space>
    </>
  );
}
function Upload({ taskId }: { taskId: string }) {
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    key = useRef(crypto.randomUUID()),
    [saved, setSaved] = useState(false);
  async function save() {
    if (!file) return;
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer(),
        bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      await post('/sop/tasks/' + taskId + '/source-materials', {
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        base64: btoa(binary),
        requestKey: key.current,
      });
      setFile(null);
      key.current = crypto.randomUUID();
      setSaved(true);
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginTop: 16 }}>
      {saved && <Alert type="success" title="材料已保存，列表将自动刷新" />}
      <Input
        type="file"
        aria-label="前期材料文件"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && (f.size === 0 || f.size > 10 * 1024 * 1024)) {
            setFile(null);
            setSaved(false);
            showRequestError(new Error('材料不能为空，且单个不能超过10MB'));
            return;
          }
          setFile(f ?? null);
          key.current = crypto.randomUUID();
          setSaved(false);
        }}
      />
      <Button aria-label="保存前期材料" disabled={!file || busy} loading={busy} onClick={() => void save()}>
        保存前期材料
      </Button>
    </div>
  );
}
