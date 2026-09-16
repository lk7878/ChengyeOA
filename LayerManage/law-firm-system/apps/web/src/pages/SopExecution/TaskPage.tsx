import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Space, Spin, Tag, message } from 'antd';
import { get, post } from '@/features/workspaces/api';
import { BusinessTableLinks } from '@/features/crm/BusinessWorkspacePage';
import { showRequestError } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { useLiveSop, sopStates, type SopTask } from '@/features/sop/execution';
export default function SopTaskPage() {
  const { id } = useParams();
  const { data, error, refresh } = useLiveSop<SopTask>('/sop/tasks/' + id);
  return (
    <section className="unified-area-page">
      <Space wrap>
        <Link to="/sop/tasks">返回SOP工作表</Link>
        <Button onClick={refresh}>刷新任务</Button>
      </Space>
      {error && <Alert type="error" title={error} />} {!data && !error && <Spin />}
      {data && <TaskContent key={data.id} task={data} refresh={refresh} />}
    </section>
  );
}
function TaskContent({ task, refresh }: { task: SopTask; refresh: () => void }) {
  const user = useAuthStore((s) => s.userInfo),
    canInstance = useAuthStore((s) => s.hasPermission('sop.instance.read'));
  const [command, setCommand] = useState<{
      action: string;
      expectedVersion: number;
      requestKey: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [options, setOptions] = useState<{ id: string; employee: { name: string } }[]>([]),
    [form] = Form.useForm();
  const manage = task.permissions.includes('sop.task.manage'),
    execute = task.permissions.includes('sop.task.execute'),
    active = task.instanceStatus === 'ACTIVE' && !['COMPLETED', 'SKIPPED'].includes(task.status);
  useEffect(() => {
    let live = true;
    if (manage)
      void get<typeof options>('/sop/task-options')
        .then((rows) => {
          if (live) setOptions(rows);
        })
        .catch(() => {
          if (live) setOptions([]);
        });
    return () => {
      live = false;
    };
  }, [manage]);
  const labels: Record<string, string> = {
    START: '开始办理',
    COMPLETE: '完成节点',
    ASSIGN: '分派任务',
    RESCHEDULE: '调整期限',
    SKIP: '跳过节点',
  };
  function open(action: string) {
    form.resetFields();
    setCommand({ action, expectedVersion: task.version, requestKey: crypto.randomUUID() });
  }
  async function save() {
    if (!command) return;
    try {
      const values = await form.validateFields();
      setBusy(true);
      const body = { ...command, ...values };
      if (command.action === 'ASSIGN') {
        body.assigneeUserId = values.assigneeUserId ?? null;
        body.validUntil = values.validUntil ? new Date(values.validUntil).toISOString() : null;
      }
      if (command.action === 'RESCHEDULE')
        body.dueDate = values.dueDate ? new Date(values.dueDate).toISOString() : null;
      await post('/sop/tasks/' + task.id + '/actions', body);
      setCommand(null);
      message.success('任务已更新');
      refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>{task.name}</h1>
      <Space wrap>
        <Tag>{sopStates[task.status]}</Tag>
        {task.overdue && <Tag color="red">已逾期</Tag>}
        <Tag>流程：{sopStates[task.instanceStatus]}</Tag>
        <BusinessTableLinks source="SOP_TASKS" recordId={task.id} />
      </Space>
      <Descriptions
        column={1}
        items={[
          {
            key: 'assigned',
            label: '负责人',
            children: task.assigneeUserId === user?.id ? '我' : task.assigneeUserId ? '已分派' : '未分派',
          },
          {
            key: 'due',
            label: '期限',
            children: task.dueDate ? new Date(task.dueDate).toLocaleString() : '未设置',
          },
          { key: 'instruction', label: '办理说明', children: task.node.instruction || '无补充说明' },
          { key: 'remark', label: '办理记录', children: task.remark || '暂无' },
        ]}
      />
      {task.case ? (
        <p>
          <Link to={'/cases/' + task.case.id}>
            {task.case.caseNo} · {task.case.title}
          </Link>
        </p>
      ) : (
        <Alert type="info" title="当前仅获权办理此任务；关联案件和文件需要单独授权。" />
      )}
      {canInstance && (
        <p>
          <Link to={'/sop/instances/' + task.instanceId}>查看流程进度（按权限显示）</Link>
        </p>
      )}
      <Space wrap>
        {active && execute && ['PENDING', 'CHANGES_REQUESTED'].includes(task.status) && (
          <Button type="primary" onClick={() => open('START')}>
            开始办理
          </Button>
        )}
        {active && execute && task.status === 'IN_PROGRESS' && (
          <Button onClick={() => open('COMPLETE')}>完成节点</Button>
        )}
        {active && manage && (
          <>
            <Button onClick={() => open('ASSIGN')}>分派任务</Button>
            <Button onClick={() => open('RESCHEDULE')}>调整期限</Button>
            <Button onClick={() => open('SKIP')}>跳过节点</Button>
          </>
        )}
      </Space>
      {task.node.reviewRequired && <p>此节点配置完成审核，直接完成不会绕过审核要求。</p>}
      {task.node.materials.length > 0 && (
        <ul>
          {task.node.materials.map((m) => (
            <li key={m.code}>
              {m.name} · {m.required ? '必需' : '非强制'}：{m.instruction}
            </li>
          ))}
        </ul>
      )}
      <Modal
        title={command ? labels[command.action] : ''}
        open={!!command}
        onCancel={() => !busy && setCommand(null)}
        onOk={() => void save()}
        okText="确认办理"
        cancelText="取消"
        confirmLoading={busy}
        forceRender
      >
        <Form form={form} layout="vertical">
          {command?.action === 'ASSIGN' ? (
            <>
              <Form.Item name="assigneeUserId" label="负责人">
                <Select
                  allowClear
                  placeholder="留空撤回分派"
                  options={options.map((o) => ({ value: o.id, label: o.employee.name }))}
                />
              </Form.Item>
              <Form.Item name="validUntil" label="协作授权截止时间">
                <Input type="datetime-local" />
              </Form.Item>
              <p>只授予此任务的读取和执行，截止时间留空表示持续至撤回；候选最多500人。</p>
            </>
          ) : command?.action === 'RESCHEDULE' ? (
            <Form.Item name="dueDate" label="任务期限">
              <Input type="datetime-local" />
            </Form.Item>
          ) : command?.action === 'SKIP' ? (
            <Form.Item name="reason" label="跳过原因" rules={[{ required: true }]}>
              <Input.TextArea maxLength={500} />
            </Form.Item>
          ) : (
            <Form.Item name="remark" label="办理说明">
              <Input.TextArea maxLength={2000} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
