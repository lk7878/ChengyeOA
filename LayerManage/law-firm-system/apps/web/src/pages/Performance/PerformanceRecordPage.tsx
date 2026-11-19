import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Space, Spin, Tag, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { Link, useParams, useSearchParams } from 'react-router';
import { performanceApi } from '@/api/organization';
import { requestErrorMessage } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { BusinessTableLinks } from '@/features/crm/BusinessWorkspacePage';
import type { Performance, PerformanceBusinessMetrics } from '@/types';

type Action = 'goal' | 'self' | 'manager' | 'confirm';
const titles: Record<Action, string> = {
  goal: '设置目标',
  self: '提交自评',
  manager: '主管评议',
  confirm: '确认绩效',
};
const statuses: Record<string, string> = {
  PENDING: '待考核',
  SELF_REVIEWED: '已自评',
  MANAGER_REVIEWED: '已主管评',
  CONFIRMED: '已确认',
};
export default function PerformanceRecordPage() {
  const { id = '' } = useParams();
  return <PerformanceDetail key={id} id={id} />;
}
function PerformanceDetail({ id }: { id: string }) {
  const [params] = useSearchParams();
  const has = useAuthStore((s) => s.hasPermission);
  const employeeId = useAuthStore((s) => s.authorization?.employeeId);
  const [row, setRow] = useState<Performance>();
  const [metrics, setMetrics] = useState<PerformanceBusinessMetrics>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ action: Action; row: Performance }>();
  const [form] = Form.useForm<{ goal?: string; score?: number; comment?: string }>();
  const alive = useRef(true),
    sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const data = (await performanceApi.detail(id)).data;
      if (!alive.current || seq !== sequence.current) return;
      setRow((old) => (!old || data.version >= old.version ? data : old));
      setError('');
      const nextMetrics = (await performanceApi.metrics(id)).data;
      if (alive.current && seq === sequence.current) setMetrics(nextMetrics);
    } catch (e) {
      if (!alive.current || seq !== sequence.current) return;
      setError(requestErrorMessage(e));
      const status = (e as { response?: { status?: number } }).response?.status;
      if ([401, 403, 404].includes(status ?? 0)) {
        setRow(undefined);
        setDraft(undefined);
        setMetrics(undefined);
      }
    }
  }, [id]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => {
      if (alive.current) void refresh();
    });
    const timer = window.setInterval(() => void refresh(), 5000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  const open = (action: Action) => {
    if (!row) return;
    setDraft({ action, row });
    form.setFieldsValue({
      goal: row.goal ?? '',
      score: action === 'self' ? (row.selfScore ?? undefined) : (row.managerScore ?? undefined),
      comment: action === 'self' ? (row.selfComment ?? '') : (row.managerComment ?? ''),
    });
  };
  const save = async () => {
    if (!draft || busy) return;
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setBusy(true);
    try {
      const version = draft.row.version;
      if (draft.action === 'goal') await performanceApi.setGoal(id, { goal: values.goal!.trim(), version });
      else if (draft.action === 'self')
        await performanceApi.selfReview(id, {
          selfScore: values.score!,
          selfComment: values.comment?.trim(),
          version,
        });
      else if (draft.action === 'manager')
        await performanceApi.managerReview(id, {
          managerScore: values.score!,
          managerComment: values.comment?.trim(),
          version,
        });
      else await performanceApi.confirm(id, { version });
      if (alive.current) {
        setDraft(undefined);
        message.success('绩效记录已更新');
        await refresh();
      }
    } catch (e) {
      if (alive.current) setError(requestErrorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div style={{ padding: 24 }}>
      <Link to={'/performances' + (params.size ? '?' + params.toString() : '')}>返回绩效工作表</Link>
      <h1>绩效详情</h1>
      {error && (
        <Alert type="error" title={error} action={<Button onClick={() => void refresh()}>刷新重试</Button>} />
      )}
      {!row && !error && <Spin />}
      {row && (
        <>
          <Space wrap style={{ marginBottom: 16 }}>
            <Tag>{statuses[row.status] ?? row.status}</Tag>
            {row.status === 'PENDING' && has('performance.update') && (
              <Button onClick={() => open('goal')}>设置目标</Button>
            )}
            {row.status === 'PENDING' && row.employeeId === employeeId && has('performance.update') && (
              <Button onClick={() => open('self')}>提交自评</Button>
            )}
            {row.status === 'SELF_REVIEWED' && has('performance.confirm') && (
              <Button onClick={() => open('manager')}>主管评议</Button>
            )}
            {row.status !== 'CONFIRMED' && has('performance.confirm') && (
              <Button onClick={() => open('confirm')}>确认绩效</Button>
            )}
            <BusinessTableLinks source="PERFORMANCES" recordId={id} />
          </Space>
          <Card>
            <Descriptions
              column={{ xs: 1, md: 2 }}
              items={[
                { key: 'employee', label: '被考核人', children: row.employee?.name ?? row.employeeId },
                { key: 'period', label: '考核周期', children: row.period },
                { key: 'goal', label: '考核目标', children: row.goal || '—' },
                { key: 'score', label: '绩效分数', children: row.score ?? '—' },
                { key: 'bonus', label: '奖金', children: row.bonus ?? '—' },
                { key: 'selfScore', label: '自评分数', children: row.selfScore ?? '—' },
                { key: 'selfComment', label: '自评说明', children: row.selfComment || '—' },
                { key: 'managerScore', label: '主管评分', children: row.managerScore ?? '—' },
                { key: 'managerComment', label: '主管评议', children: row.managerComment || '—' },
              ]}
            />
          </Card>
          {metrics && (
            <Card title="当前有权查看的业务指标" style={{ marginTop: 16 }}>
              <Descriptions
                items={[
                  { key: 'earnings', label: '周期内已确认案件绩效（可见范围）', children: metrics.caseEarnings ?? '暂无可见金额' },
                  { key: 'cases', label: '办结案件', children: metrics.closedCases ?? '缺少案件读取权限' },
                  {
                    key: 'payments',
                    label: '确认收款',
                    children: metrics.confirmedRevenue ?? '缺少收款或关联案件读取权限',
                  },
                  { key: 'auto', label: '参考分数', children: metrics.autoScore ?? '指标不完整，无法计算' },
                ]}
              />
            </Card>
          )}
        </>
      )}
      {row && (
        <Modal
          open={!!draft}
          title={draft ? titles[draft.action] : ''}
          okText="确认办理"
          cancelText="取消"
          onCancel={() => {
            if (!busy) setDraft(undefined);
          }}
          onOk={() => void save()}
          confirmLoading={busy}
          destroyOnHidden
        >
          {error && <Alert type="error" title={error} />}
          {draft && row && draft.row.version !== row.version && (
            <Alert
              type="warning"
              title="记录已由其他成员更新，当前输入保留。请核对最新记录后再提交。"
              action={
                <Button disabled={busy} onClick={() => setDraft({ ...draft, row })}>
                  已核对最新版本
                </Button>
              }
            />
          )}
          <Form form={form} layout="vertical" preserve={false}>
            {draft?.action === 'goal' && (
              <Form.Item
                name="goal"
                label="考核目标"
                rules={[{ required: true, whitespace: true, message: '请输入考核目标' }]}
              >
                <Input.TextArea maxLength={2000} />
              </Form.Item>
            )}
            {(draft?.action === 'self' || draft?.action === 'manager') && (
              <>
                <Form.Item name="score" label="评分" rules={[{ required: true, message: '请输入评分' }]}>
                  <InputNumber min={0} max={100} precision={0} />
                </Form.Item>
                <Form.Item name="comment" label="评议说明">
                  <Input.TextArea maxLength={2000} />
                </Form.Item>
              </>
            )}
            {draft?.action === 'confirm' && <p>确认后将结束本次绩效考核。</p>}
          </Form>
        </Modal>
      )}
    </div>
  );
}
