import { useRef, useState } from 'react';
import { Alert, Button, Input, Select } from 'antd';
import Modal from '@/components/DraggableModal';
import { errorMessage, get, post } from '../workspaces/api';
import type { Workspace } from '../workspaces/types';
import { businessSources, type BusinessSource } from './business-sources';

export default function CreateModuleBase({
  source,
  onCreated,
}: {
  source: BusinessSource;
  onCreated: (base: string, table: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<string>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectBusiness, setConnectBusiness] = useState(true);
  const attempt = useRef<{ body: string; key: string } | undefined>(undefined);
  return (
    <>
      <Button
        type="primary"
        onClick={async () => {
          setOpen(true);
          setError('');
          setName(businessSources[source].title);
          setWorkspace(undefined);
          setConnectBusiness(true);
          setWorkspaces([]);
          attempt.current = undefined;
          try {
            const data = await get<{ workspaces: Workspace[] }>('/workspaces');
            setWorkspaces(data.workspaces);
            setWorkspace(data.workspaces[0]?.id);
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        新建多维表格
      </Button>
      <Modal
        title={'新建' + businessSources[source].title}
        open={open}
        okText="创建工作表"
        cancelText="取消"
        onCancel={() => setOpen(false)}
        confirmLoading={busy}
        okButtonProps={{ disabled: !workspace || !name.trim() }}
        onOk={async () => {
          setBusy(true);
          setError('');
          try {
            const body = { name: name.trim(), moduleSource: source, connectBusiness };
            const fingerprint = JSON.stringify([workspace, body]);
            if (attempt.current?.body !== fingerprint)
              attempt.current = { body: fingerprint, key: crypto.randomUUID() };
            const data = await post<{ id: string; tableId: string }>(
              '/workspaces/' + workspace + '/drive/bases',
              body,
              attempt.current.key,
            );
            setOpen(false);
            onCreated(data.id, data.tableId);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert type="error" title={error} />}
        <p>
          业务工作表直接展示本模块已保存的记录。工作区所有者可创建业务连接；其他账号通过“分享”获得文档访问权限。
        </p>
        <Select
          aria-label="表格用途"
          style={{ width: '100%' }}
          value={connectBusiness ? 'BUSINESS' : 'CUSTOM'}
          onChange={(value) => setConnectBusiness(value === 'BUSINESS')}
          options={[
            { value: 'BUSINESS', label: '业务工作表：同步展示正式业务记录' },
            { value: 'CUSTOM', label: '普通数据表：独立录入自定义数据' },
          ]}
        />
        <label>
          工作区
          <Select
            aria-label="工作区"
            style={{ width: '100%' }}
            value={workspace}
            onChange={setWorkspace}
            options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
          />
        </label>
        <label>
          多维表格名称
          <Input
            aria-label="多维表格名称"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {!workspaces.length && <p>暂无可访问的工作区，请先从云盘创建工作区或联系负责人授权。</p>}
      </Modal>
    </>
  );
}
