import { useRef, useState } from 'react';
import { Alert, Button, Select } from 'antd';
import Modal from '@/components/DraggableModal';
import { moduleOptions } from '@/features/crm/business-sources';
import { errorMessage, post } from './api';
import type { Base } from './types';

export default function BaseModule({ base, onSaved }: { base: Base; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ body: string; key: string } | undefined>(undefined);
  return (
    <>
      <Button
        onClick={() => {
          setSource(base.moduleSource || undefined);
          setError('');
          setOpen(true);
        }}
      >
        所属业务模块
      </Button>
      <Modal
        title="所属业务模块"
        open={open}
        onCancel={() => setOpen(false)}
        confirmLoading={busy}
        onOk={async () => {
          setBusy(true);
          try {
            const body = { moduleSource: source || null, version: base.version };
            const fingerprint = JSON.stringify([base.id, body]);
            if (attempt.current?.body !== fingerprint)
              attempt.current = { body: fingerprint, key: crypto.randomUUID() };
            await post('/bases/' + base.id + '/module', body, attempt.current.key);
            setOpen(false);
            onSaved();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          普通数据表将直接出现在所选模块的工作表列表。此设置不会改变文档共享权限，也不会将普通记录转换为正式业务记录。
        </p>
        {error && <Alert type="error" title={error} />}
        <Select
          aria-label="所属业务模块"
          allowClear
          placeholder="仅在云盘显示"
          style={{ width: '100%' }}
          value={source}
          onChange={setSource}
          options={moduleOptions}
        />
      </Modal>
    </>
  );
}
