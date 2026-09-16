import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, Input, Modal, Select } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { get, post } from '@/features/workspaces/api';
import { useLiveSop } from '@/features/sop/execution';
import { showRequestError } from '@/api/errors';
type Option = { id: string; version: number; title: string; kind: string; batchKey: string };
type Connection = {
  id: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  sourceTitle: string;
  targetTitle: string;
  reason: string;
};
export function SopContinuations({
  id,
  version,
  kind,
  refresh,
}: {
  id: string;
  version: number;
  kind: string;
  refresh: () => void;
}) {
  const live = useLiveSop<Connection[]>('/sop/instances/' + id + '/continuations'),
    can = useAuthStore((s) => s.hasPermission('sop.instance.manage')),
    [open, setOpen] = useState(false),
    [options, setOptions] = useState<Option[]>([]),
    [target, setTarget] = useState<string>(),
    [reason, setReason] = useState(''),
    [expected, setExpected] = useState(version),
    [key, setKey] = useState(crypto.randomUUID()),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      const [rows, current] = await Promise.all([
        get<Option[]>('/sop/instances/' + id + '/continuation-options'),
        get<{ version: number }>('/sop/instances/' + id),
      ]);
      setOptions(rows);
      setExpected(current.version);
      setKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }
  async function begin() {
    try {
      await load();
      setReason('');
      setTarget(undefined);
      setOpen(true);
    } catch (e) {
      showRequestError(e);
    }
  }
  async function save() {
    const row = options.find((o) => o.id === target);
    if (!row || !reason.trim()) return;
    setBusy(true);
    try {
      await post('/sop/instances/' + id + '/continuations', {
        targetInstanceId: row.id,
        targetVersion: row.version,
        expectedVersion: expected,
        reason,
        requestKey: key,
      });
      setOpen(false);
      refresh();
      live.refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="签约前后接续" style={{ marginTop: 16 }}>
      {live.error && <Alert type="error" title={live.error} />}{' '}
      {live.data?.map((c) => (
        <p key={c.id}>
          <Link to={'/sop/instances/' + c.sourceInstanceId}>{c.sourceTitle}</Link> →{' '}
          <Link to={'/sop/instances/' + c.targetInstanceId}>{c.targetTitle}</Link>
          <br />
          {c.reason}
        </p>
      ))}
      {live.data && !live.data.length && <p>暂无当前可读取的接续记录。</p>}
      {can && kind !== 'CASE' && <Button onClick={() => void begin()}>关联后续流程</Button>}
      <Modal
        title="关联后续流程"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        okText="确认接续"
        okButtonProps={{ 'aria-label': '确认接续', disabled: busy || !target || !reason.trim() }}
        confirmLoading={busy}
        cancelText="取消"
      >
        <p>
          先在原业务入口完成转客户、合同生效或建案，再启动对应后续流程。这里只建立关联，保留各自任务与材料权限。
        </p>
        <Select
          aria-label="后续流程"
          style={{ width: '100%' }}
          value={target}
          onChange={setTarget}
          options={options.map((o) => ({ value: o.id, label: o.title + ' · ' + o.batchKey }))}
        />
        {!options.length && <p>没有符合真实客户/合同关联且当前获权的后续流程。</p>}
        <Input.TextArea
          aria-label="接续依据"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          style={{ marginTop: 12 }}
        />
        <Button disabled={busy} onClick={() => void load().catch(showRequestError)}>刷新接续候选并采用最新版本</Button>
      </Modal>
    </Card>
  );
}
