import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Spin, Tag } from 'antd';
import { get, post } from '@/features/workspaces/api';
import { useLiveSop } from '@/features/sop/execution';
import { showRequestError } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { BusinessTableLinks } from '@/features/crm/BusinessWorkspacePage';
type Assessment = {
  id: string;
  score: number | null;
  source: string;
  evidence: string;
  assessedAt: string;
  number: number;
  correctionOfId: string | null;
  correctionReason: string | null;
  analysis: { id: string; status: string } | null;
};
type Analysis = {
  id: string;
  caseId: string;
  status: string;
  version: number;
  content: string;
  conclusion: string;
  assessment: Assessment;
  revisions: { id: string; number: number; content: string; conclusion: string; createdAt: string }[];
  closes: {
    id: string;
    status: string;
    approvalId: string | null;
    sync: { status: string; reason: string | null } | null;
  }[];
};
const states: Record<string, string> = {
  OPEN: '待分析',
  ANALYZING: '分析中',
  PENDING_CLOSE: '待关闭审核',
  CLOSED: '已关闭',
  PENDING: '待审核',
  APPROVED: '已批准',
  RETURNED: '已退回',
  CANCELLED: '已撤回',
  IN_PROGRESS: '办理中',
  IN_REVIEW: '审核中',
  CHANGES_REQUESTED: '待修改',
  PENDING_VERIFY: '待复核',
  COMPLETED: '已完成',
  SKIPPED: '已跳过',
};
export function AssessmentPage() {
  const { id } = useParams(),
    live = useLiveSop<Assessment[]>('/cases/' + id + '/quality-assessments');
  return (
    <section className="unified-area-page">
      <Link to={'/cases/' + id}>返回案件</Link>
      <h1>百分制满意度评估</h1>
      <p>
        记录独立的0–100分评估。低于80分进入专项分析；旧1–5星记录保持原量表。更正新增版本并保留原触发事实。
      </p>
      {live.error && <Alert type="error" title={live.error} />} {!live.data && !live.error && <Spin />}
      {live.data && <Assessments key={id} caseId={id!} list={live.data} refresh={live.refresh} />}
    </section>
  );
}
function Assessments({ caseId, list, refresh }: { caseId: string; list: Assessment[]; refresh: () => void }) {
  const can = useAuthStore((s) => s.hasPermission),
    [open, setOpen] = useState(false),
    [correction, setCorrection] = useState<Assessment | null>(null),
    [form] = Form.useForm(),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(crypto.randomUUID());
  function begin(previous: Assessment | null) {
    setCorrection(previous);
    form.resetFields();
    setKey(crypto.randomUUID());
    setOpen(true);
  }
  async function save() {
    try {
      const raw = await form.validateFields();
      setBusy(true);
      await post('/cases/' + caseId + '/quality-assessments', {
        ...raw,
        score: raw.score ?? null,
        assessedAt: new Date(raw.assessedAt).toISOString(),
        correctionOfId: correction?.id ?? null,
        requestKey: key,
      });
      setOpen(false);
      refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button disabled={!can('quality.assessment.record')} onClick={() => begin(null)}>
        登记评估
      </Button>
      {!list.length && <p>暂无百分制评估。</p>}
      {list.map((r) => (
        <Card
          key={r.id}
          title={'评估 ' + (r.score === null ? '未评分' : r.score + '分') + ' · 修订 ' + r.number}
          style={{ marginTop: 12 }}
        >
          <p>
            {r.source} · {new Date(r.assessedAt).toLocaleString()}
          </p>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.evidence}</p>
          {r.correctionReason && <p>更正依据：{r.correctionReason}</p>}
          <Space wrap>
            {r.analysis ? (
              <Link to={'/quality/special-analyses/' + r.analysis.id}>
                专项分析 · {states[r.analysis.status]}
              </Link>
            ) : (
              r.score !== null && r.score < 80 && <span>等待事件处理或无专项读取权限</span>
            )}
            <Button
              disabled={!can('quality.assessment.record') || list.some((a) => a.correctionOfId === r.id)}
              onClick={() => begin(r)}
            >
              更正为新版本
            </Button>
          </Space>
        </Card>
      ))}
      <Modal
        title={correction ? '更正评估版本' : '登记满意度评估'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        okText="保存评估"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ 'aria-label': '保存评估', disabled: busy }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="score" label="百分制分数（可空）">
            <InputNumber min={0} max={100} precision={0} />
          </Form.Item>
          <Form.Item name="source" label="评估来源" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="assessedAt" label="评估日期" rules={[{ required: true }]}>
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item name="evidence" label="证据或可核验引用" rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          {correction && (
            <Form.Item name="correctionReason" label="更正原因" rules={[{ required: true }]}>
              <Input.TextArea />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
export function AnalysisPage() {
  const { id } = useParams(),
    live = useLiveSop<Analysis>('/quality/special-analyses/' + id);
  return (
    <section className="unified-area-page">
      <BusinessTableLinks source="QUALITY_ANALYSES" recordId={id!} />
      {live.error && <Alert type="error" title={live.error} />} {!live.data && !live.error && <Spin />}
      {live.data && <AnalysisContent key={live.data.id} data={live.data} refresh={live.refresh} />}
    </section>
  );
}
function AnalysisContent({ data, refresh }: { data: Analysis; refresh: () => void }) {
  const can = useAuthStore((s) => s.hasPermission),
    [draft, setDraft] = useState<{ content: string; conclusion: string; version: number } | null>(null),
    [key, setKey] = useState(crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [close, setClose] = useState(false),
    [reviewer, setReviewer] = useState<string>(),
    [options, setOptions] = useState<{ id: string; name: string }[]>([]),
    [closeVersion, setCloseVersion] = useState(data.version),
    [closeKey, setCloseKey] = useState(crypto.randomUUID());
  const editable = ['OPEN', 'ANALYZING'].includes(data.status) && can('quality.analysis.manage');
  async function save() {
    setBusy(true);
    try {
      await post('/quality/special-analyses/' + data.id, {
        expectedVersion: draft?.version ?? data.version,
        requestKey: key,
        content: draft?.content ?? data.content,
        conclusion: draft?.conclusion ?? data.conclusion,
      });
      setDraft(null);
      setKey(crypto.randomUUID());
      refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  async function beginClose() {
    try {
      setOptions(await get('/quality/special-analyses/' + data.id + '/reviewers'));
      setCloseVersion(data.version);
      setCloseKey(crypto.randomUUID());
      setClose(true);
    } catch (e) {
      showRequestError(e);
    }
  }
  async function submitClose() {
    setBusy(true);
    try {
      await post('/quality/special-analyses/' + data.id + '/close', {
        expectedVersion: closeVersion,
        requestKey: closeKey,
        reviewerUserId: reviewer,
      });
      setClose(false);
      refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>低满意度专项分析</h1>
      <Tag>{states[data.status]}</Tag>
      <Space wrap>
        <Link to={'/cases/' + data.caseId}>关联案件</Link>
        <Link to={'/cases/' + data.caseId + '/assessments'}>评估版本</Link>
      </Space>
      <p>
        触发评分 {data.assessment.score} / 100 · {data.assessment.source}
      </p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{data.assessment.evidence}</p>
      <p>专项分析记录分析过程和结论，不强制指定负责人、期限或复盘入库。关闭由独立获权人通过原审批办理。</p>
      <Form layout="vertical">
        <Form.Item label="分析过程">
          <Input.TextArea
            aria-label="分析过程"
            rows={6}
            disabled={!editable}
            value={draft?.content ?? data.content}
            onChange={(e) =>
              setDraft({
                content: e.target.value,
                conclusion: draft?.conclusion ?? data.conclusion,
                version: draft?.version ?? data.version,
              })
            }
          />
        </Form.Item>
        <Form.Item label="分析结论">
          <Input.TextArea
            aria-label="分析结论"
            rows={4}
            disabled={!editable}
            value={draft?.conclusion ?? data.conclusion}
            onChange={(e) =>
              setDraft({
                content: draft?.content ?? data.content,
                conclusion: e.target.value,
                version: draft?.version ?? data.version,
              })
            }
          />
        </Form.Item>
      </Form>
      <Space wrap>
        {editable && (
          <Button aria-label="保存分析版本" loading={busy} disabled={busy} onClick={() => void save()}>
            保存分析版本
          </Button>
        )}
        {draft && draft.version !== data.version && (
          <Button
            onClick={() => {
              setDraft({ ...draft, version: data.version });
              setKey(crypto.randomUUID());
            }}
          >
            采用最新分析版本
          </Button>
        )}
        {data.status === 'ANALYZING' && can('quality.analysis.close') && (
          <Button disabled={!!draft} onClick={() => void beginClose()}>
            申请关闭专项分析
          </Button>
        )}
      </Space>
      <h2>关闭审核历史</h2>
      {data.closes.map((c) => (
        <Card key={c.id} style={{ marginTop: 12 }}>
          <Tag>{states[c.status]}</Tag>
          {c.sync?.status === 'FAILED' && (
            <Alert type="error" title="审批已决定，业务同步失败" description={c.sync.reason} />
          )}{' '}
          {c.approvalId && <Link to={'/approvals?role=TODO&instance=' + c.approvalId}>进入原审批中心</Link>}
        </Card>
      ))}
      <details>
        <summary>分析修订历史</summary>
        {data.revisions.map((r) => (
          <Card key={r.id} title={'修订 ' + r.number}>
            <p>{new Date(r.createdAt).toLocaleString()}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.content}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.conclusion}</p>
          </Card>
        ))}
      </details>
      <Modal
        title="申请关闭专项分析"
        open={close}
        onCancel={() => setClose(false)}
        onOk={() => void submitClose()}
        okText="提交关闭审核"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ 'aria-label': '提交关闭审核', disabled: busy || !reviewer }}
      >
        <p>审核人需具有独立范围权限，并回避本轮分析编写人。</p>
        <Select
          aria-label="关闭审核人"
          style={{ width: '100%' }}
          value={reviewer}
          options={options.map((o) => ({ value: o.id, label: o.name }))}
          onChange={setReviewer}
        />
        {closeVersion !== data.version && (
          <Button
            onClick={() => {
              setCloseVersion(data.version);
              setCloseKey(crypto.randomUUID());
            }}
          >
            采用最新关闭版本
          </Button>
        )}
      </Modal>
    </>
  );
}
type Metric = { status: string; _count: { _all: number } };
export function QualityMetricsPage() {
  const { data, error } = useLiveSop<{
    tasks?: Metric[];
    overdue?: number;
    issues?: Metric[];
    inspections?: Metric[];
    analyses?: Metric[];
  }>('/quality/metrics');
  return (
    <section className="unified-area-page">
      <h1>交付质量指标</h1>
      <p>仅统计当前获权组织、案件与对应业务记录，个人视图不会扩大统计范围。</p>
      {error && <Alert type="error" title={error} />} {!data && !error && <Spin />}
      {data &&
        (['tasks', 'issues', 'inspections', 'analyses'] as const).map((key) => (
          <Card
            key={key}
            title={
              { tasks: '案件SOP节点', issues: '问题整改', inspections: '二级检查', analyses: '专项分析' }[key]
            }
            style={{ marginTop: 12 }}
          >
            {data[key] === undefined ? (
              <p>未获对应业务读取权限</p>
            ) : data[key]!.length ? (
              data[key]!.map((r) => (
                <p key={r.status}>
                  {(key === 'tasks' && r.status === 'PENDING') ? '待办理'
                    : (key === 'issues' && r.status === 'OPEN') ? '待整改'
                    : (key === 'inspections' && r.status === 'PENDING') ? '待检查'
                    : states[r.status] ?? r.status}：{r._count._all}
                </p>
              ))
            ) : (
              <p>当前范围暂无记录</p>
            )}
            {key === 'tasks' && data.overdue !== undefined && <p>其中逾期 {data.overdue}</p>}
          </Card>
        ))}
    </section>
  );
}
