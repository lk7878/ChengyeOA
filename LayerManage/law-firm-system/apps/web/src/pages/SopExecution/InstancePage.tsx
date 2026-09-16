import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Button, Input, Modal, Space, Spin, Table, Tag, message } from 'antd';
import { post } from '@/features/workspaces/api';
import { useAuthStore } from '@/stores/authStore';
import { showRequestError } from '@/api/errors';
import { useLiveSop, sopStates, type SopInstance } from '@/features/sop/execution';
export default function SopInstancePage() {
  const { id } = useParams();
  const { data, error, refresh } = useLiveSop<SopInstance>('/sop/instances/' + id);
  return (
    <section className="unified-area-page">
      <Space wrap>
        <Link to="/sop/tasks">SOP工作表</Link>
        <Button onClick={refresh}>刷新流程</Button>
      </Space>
      {error && <Alert type="error" title={error} />} {!data && !error && <Spin />}
      {data && <InstanceContent key={data.id} data={data} refresh={refresh} />}
    </section>
  );
}
function InstanceContent({ data, refresh }: { data: SopInstance; refresh: () => void }) {
  const canManage = useAuthStore((s) => s.hasPermission('sop.instance.manage'));
  const [command, setCommand] = useState<{
      action: string;
      expectedVersion: number;
      requestKey: string;
    } | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false);
  const actions =
    data.status === 'ACTIVE'
      ? ['PAUSE', 'COMPLETE', 'CANCEL']
      : data.status === 'PAUSED'
        ? ['RESUME', 'CANCEL']
        : [];
  const labels: Record<string, string> = {
    PAUSE: '暂停流程',
    RESUME: '恢复流程',
    COMPLETE: '完成流程',
    CANCEL: '取消流程',
  };
  async function save() {
    if (!command) return;
    setBusy(true);
    try {
      await post('/sop/instances/' + data.id + '/actions', {
        ...command,
        ...(command.action === 'CANCEL' ? { reason } : {}),
      });
      setCommand(null);
      message.success('流程已更新');
      refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>
        {data.templateName} · 第 {data.templateNumber} 版
      </h1>
      <Space wrap>
        <Tag>{sopStates[data.status]}</Tag>
        <span>
          获权任务进度：{data.progress.completed}/{data.progress.visible}
        </span>
        {data.case && (
          <Link to={'/cases/' + data.case.id}>
            {data.case.caseNo} · {data.case.title}
          </Link>
        )}
      </Space>
      <p>批次：{data.batchKey}。完成流程不会自动结案。</p>
      <Space wrap>
        {canManage &&
          actions.map((action) => (
            <Button
              key={action}
              onClick={() => {
                setReason('');
                setCommand({ action, expectedVersion: data.version, requestKey: crypto.randomUUID() });
              }}
            >
              {labels[action]}
            </Button>
          ))}
      </Space>
      <Table
        rowKey="id"
        dataSource={data.tasks}
        pagination={false}
        scroll={{ x: 550 }}
        columns={[
          {
            title: '节点任务',
            dataIndex: 'name',
            render: (name: string, row: { id: string }) => <Link to={'/sop/tasks/' + row.id}>{name}</Link>,
          },
          { title: '状态', dataIndex: 'status', render: (v: string) => sopStates[v] },
          {
            title: '期限',
            dataIndex: 'dueDate',
            render: (v: string | null) => (v ? new Date(v).toLocaleString() : '未设置'),
          },
          { title: '逾期', dataIndex: 'overdue', render: (v: boolean) => (v ? '已逾期' : '—') },
        ]}
      />
      <Modal
        open={!!command}
        title={command ? labels[command.action] : ''}
        onCancel={() => !busy && setCommand(null)}
        onOk={() => void save()}
        okText="确认办理"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ disabled: command?.action === 'CANCEL' && !reason.trim() }}
      >
        {command?.action === 'CANCEL' ? (
          <Input.TextArea
            aria-label="取消原因"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
        ) : (
          <p>该操作会按当前版本校验流程状态。</p>
        )}
      </Modal>
    </>
  );
}
