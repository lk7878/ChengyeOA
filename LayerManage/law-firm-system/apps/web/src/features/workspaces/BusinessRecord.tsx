import Modal from '@/components/DraggableModal';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  Pagination,
  Select,
  Space,
  Tabs,
  Typography,
} from 'antd';
import { errorMessage, errorStatus, get, post } from './api';
import type { Option } from './types';

interface BusinessDetail {
  version: number;
  capabilities: { follow: boolean; status: boolean; assign: boolean; claim: boolean; recycle: boolean };
  statuses: string[];
  assignees: Option[];
  follows: {
    id: string;
    type: string;
    content: string;
    nextPlan: string | null;
    nextTime: string | null;
    createdAt: string;
  }[];
  followsTotal: number;
  history: { id: string; action: string; createdAt: string }[];
  historyTotal: number;
}
const states: Record<string, string> = {
  NEW: '新线索',
  ASSIGNED: '已分配',
  CONTACTED: '已联系',
  SCREENED: '已筛选',
  INVITED: '已邀约',
  VISITED: '已到访',
  LOST: '已流失',
  NURTURE: '培育中',
};
const followTypes = [
  { value: 'PHONE', label: '电话' },
  { value: 'WECHAT', label: '微信' },
  { value: 'VISIT', label: '到访' },
  { value: 'ONLINE', label: '线上' },
  { value: 'OTHER', label: '其他' },
];
const historyNames: Record<string, string> = {
  LEAD_FOLLOW_CREATE: '新增跟进',
  LEAD_STATUS_TRANSITION: '调整状态',
  LEAD_ASSIGN: '分配负责人',
  LEAD_REASSIGN: '改派负责人',
  LEAD_POOL_CLAIM: '领取线索',
  LEAD_POOL_RECYCLE: '回收线索',
  LEAD_RECYCLE: '回收线索',
};

export function BusinessRecord({
  tableId,
  recordId,
  revision,
  onSaved,
}: {
  tableId: string;
  recordId: string;
  revision: number;
  onSaved: () => void;
}) {
  const [data, setData] = useState<BusinessDetail>();
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [command, setCommand] = useState<{
    action: 'FOLLOW' | 'STATUS' | 'ASSIGN' | 'CLAIM' | 'RECYCLE';
    version: number;
    key: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [form] = Form.useForm();
  const endpoint = '/tables/' + tableId + '/records/' + recordId + '/business';
  useEffect(() => {
    let active = true;
    get<BusinessDetail>(endpoint + '?page=' + page)
      .then((value) => {
        if (active) {
          setData(value);
          setError('');
        }
      })
      .catch((e) => {
        if (active) {
          setData(undefined);
          setError(errorMessage(e));
          if ([401, 403, 404].includes(errorStatus(e) || 0)) setCommand(undefined);
        }
      });
    return () => {
      active = false;
    };
  }, [endpoint, revision, page]);
  const open = (action: 'FOLLOW' | 'STATUS' | 'ASSIGN' | 'CLAIM' | 'RECYCLE') => {
    if (!data) return;
    form.resetFields();
    form.setFieldsValue({ type: 'PHONE' });
    setCommandError('');
    setConflict(false);
    setCommand({ action, version: data.version, key: crypto.randomUUID() });
  };
  return (
    <section aria-label="线索业务办理" style={{ marginBottom: 20 }}>
      {error && <Alert type="error" title={error} />}
      {data && (
        <>
          <Space wrap style={{ marginBottom: 12 }}>
            <Button type="primary" disabled={!data.capabilities.follow} onClick={() => open('FOLLOW')}>
              新增跟进
            </Button>
            <Button disabled={!data.capabilities.assign} onClick={() => open('ASSIGN')}>
              分配负责人
            </Button>
            <Button
              disabled={!data.capabilities.status || !data.statuses.length}
              onClick={() => open('STATUS')}
            >
              调整状态
            </Button>
            <Button disabled={!data.capabilities.claim} onClick={() => open('CLAIM')}>
              领取线索
            </Button>
            <Button disabled={!data.capabilities.recycle} onClick={() => open('RECYCLE')}>
              回收线索
            </Button>
          </Space>
          <Tabs
            items={[
              {
                key: 'follow',
                label: '跟进记录（' + data.followsTotal + '）',
                children: (
                  <>
                    {!data.follows.length && (
                      <Typography.Text type="secondary">暂无可访问的跟进记录</Typography.Text>
                    )}
                    {data.follows.map((f) => (
                      <article key={f.id} style={{ borderBottom: '1px solid #eee', padding: '10px 0' }}>
                        <Typography.Text type="secondary">
                          {followTypes.find((t) => t.value === f.type)?.label || f.type} ·{' '}
                          {new Date(f.createdAt).toLocaleString('zh-CN')}
                        </Typography.Text>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{f.content}</p>
                        {f.nextPlan && <p>下次计划：{f.nextPlan}</p>}
                        {f.nextTime && <p>下次联系：{new Date(f.nextTime).toLocaleString('zh-CN')}</p>}
                      </article>
                    ))}
                  </>
                ),
              },
              {
                key: 'history',
                label: '操作历史（' + data.historyTotal + '）',
                children: data.history.map((h) => (
                  <p key={h.id}>
                    {historyNames[h.action] || h.action} · {new Date(h.createdAt).toLocaleString('zh-CN')}
                  </p>
                )),
              },
            ]}
          />
          {Math.max(data.followsTotal, data.historyTotal) > 20 && (
            <Pagination
              size="small"
              current={page}
              pageSize={20}
              total={Math.max(data.followsTotal, data.historyTotal)}
              showSizeChanger={false}
              onChange={setPage}
            />
          )}
        </>
      )}
      <Modal
        title={
          command?.action === 'FOLLOW'
            ? '新增跟进'
            : command?.action === 'STATUS'
              ? '调整线索状态'
              : command?.action === 'CLAIM'
                ? '领取线索'
                : command?.action === 'RECYCLE'
                  ? '回收线索'
                  : '分配负责人'
        }
        open={!!command}
        forceRender
        okText="提交"
        cancelText="取消"
        onCancel={() => setCommand(undefined)}
        confirmLoading={busy}
        okButtonProps={{ disabled: !data || conflict, 'aria-label': '提交业务操作' }}
        onOk={async () => {
          if (!command) return;
          try {
            const values = await form.validateFields();
            setBusy(true);
            const body =
              command.action === 'FOLLOW'
                ? {
                    type: values.type,
                    content: values.content,
                    nextPlan: values.nextPlan,
                    nextTime: values.nextTime?.toISOString(),
                  }
                : command.action === 'STATUS'
                  ? { status: values.status, reason: values.reason }
                  : command.action === 'ASSIGN'
                    ? { employeeId: values.employeeId, reason: values.reason }
                    : command.action === 'RECYCLE'
                      ? { reason: values.reason }
                      : {};
            await post(endpoint, { action: command.action, version: command.version, ...body }, command.key);
            setCommand(undefined);
            setPage(1);
            onSaved();
          } catch (e) {
            if (!(e as { errorFields?: unknown }).errorFields) {
              setCommandError(errorMessage(e));
              if (errorStatus(e) === 409) {
                setConflict(true);
                onSaved();
              } else if (errorStatus(e)) setCommand((c) => c && { ...c, key: crypto.randomUUID() });
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        {commandError && <Alert type="error" title={commandError} />}
        {conflict && data && (
          <Alert
            type="warning"
            title={'当前版本 ' + data.version + '，请先核对抽屉中的最新数据。'}
            action={
              <Button
                onClick={() => {
                  setCommand((c) => c && { ...c, version: data.version, key: crypto.randomUUID() });
                  setConflict(false);
                  setCommandError('');
                }}
              >
                已核对，保留草稿重试
              </Button>
            }
          />
        )}
        <Form name="workspace-business-command" layout="vertical" form={form} preserve={false}>
          {command?.action === 'CLAIM' ? (
            <p>确认领取这条线索到自己负责的私海？创建人及历史记录保持不变。</p>
          ) : command?.action === 'RECYCLE' ? (
            <Form.Item name="reason" label="回收原因" rules={[{ required: true, whitespace: true }]}>
              <Input.TextArea aria-label="回收原因" maxLength={500} />
            </Form.Item>
          ) : command?.action === 'FOLLOW' ? (
            <>
              <Form.Item name="type" label="跟进方式" rules={[{ required: true }]}>
                <Select aria-label="跟进方式" options={followTypes} />
              </Form.Item>
              <Form.Item name="content" label="跟进内容" rules={[{ required: true, whitespace: true }]}>
                <Input.TextArea aria-label="跟进内容" rows={4} maxLength={2000} />
              </Form.Item>
              <Form.Item name="nextPlan" label="下次计划">
                <Input.TextArea aria-label="下次计划" maxLength={500} />
              </Form.Item>
              <Form.Item name="nextTime" label="下次联系时间">
                <DatePicker aria-label="下次联系时间" showTime />
              </Form.Item>
            </>
          ) : (
            <>
              {command?.action === 'STATUS' ? (
                <Form.Item name="status" label="目标状态" rules={[{ required: true }]}>
                  <Select
                    aria-label="目标状态"
                    options={data?.statuses.map((value) => ({ value, label: states[value] || value }))}
                  />
                </Form.Item>
              ) : (
                <Form.Item name="employeeId" label="负责人" rules={[{ required: true }]}>
                  <Select
                    aria-label="负责人"
                    showSearch
                    optionFilterProp="label"
                    options={data?.assignees.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Form.Item>
              )}
              <Form.Item name="reason" label="原因" rules={[{ required: true, whitespace: true }]}>
                <Input.TextArea aria-label="原因" rows={3} maxLength={500} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </section>
  );
}
