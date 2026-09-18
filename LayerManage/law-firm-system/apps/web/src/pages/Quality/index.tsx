import Modal from '@/components/DraggableModal';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Tag,
  message,
} from 'antd';
import { get, post } from '@/features/workspaces/api';
import { useLiveSop } from '@/features/sop/execution';
import { showRequestError } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { BusinessTableLinks } from '@/features/crm/BusinessWorkspacePage';
import { downloadBlob } from '@/api/approval-materials';
import type { PermissionCode } from '@/features/authorization/types';
type Check = { code: string; name: string; result: string; reason: string };
type Policy = {
  id: string;
  code: string;
  name: string;
  number: number;
  mode: string;
  amount: number;
  organizationId: string;
  professionalTeamId: string | null;
  stratified: boolean;
  checklist: Check[];
};
type Issue = {
  id: string;
  caseId: string;
  inspectionId: string;
  name: string;
  evidence: string;
  status: string;
  version: number;
  assigneeUserId: string | null;
  dueAt: string | null;
  materialsVisible: boolean;
  revisions: {
    id: string;
    number: number;
    action: string;
    content: string;
    createdAt: string;
    attachments: { fileId: string; file: { fileName: string } }[];
  }[];
};
const states: Record<string, string> = {
  PENDING: '待检查',
  RECORDED: '已记录检查',
  OPEN: '待整改',
  IN_PROGRESS: '整改中',
  PENDING_VERIFY: '待复核',
  CLOSED: '已关闭',
  CANCELLED: '已取消',
};
const actions: Record<string, string> = {
  ASSIGN: '分派整改',
  START: '开始整改',
  SUBMIT: '提交整改',
  VERIFY: '复核通过',
  RETURN: '退回整改',
  CANCEL: '取消问题',
};
function useCan() {
  return useAuthStore((s) => s.hasPermission);
}
function Feedback({ error, data }: { error: string; data: unknown }) {
  return (
    <>
      {error && <Alert type="error" title={error} />} {!data && !error && <Spin />}
    </>
  );
}
export function QualityRulesPage() {
  const { data, error, refresh } = useLiveSop<{ list: Policy[]; total: number }>('/quality/policies'),
    can = useCan();
  return (
    <section className="unified-area-page">
      <h1>抽检策略版本</h1>
      <p>策略保存后不可改写。调整配置将创建新版本；分层时样本数或比例分别应用于每个团队。</p>
      <Link to="/quality/runs">查看抽检批次</Link>
      <Feedback error={error} data={data} />
      {data && (
        <>
          <PolicyEditor refresh={refresh} enabled={can('quality.sample.manage')} />
          {data.list.map((p) => (
            <Card key={p.id} title={p.name + ' · 版本 ' + p.number} style={{ marginTop: 12 }}>
              <p>
                {p.mode === 'COUNT' ? '样本数' : '比例'}：{p.amount}
                {p.mode === 'RATIO' ? '%' : ''} · {p.stratified ? '按团队分层' : '不分层'}
              </p>
              <p>{p.checklist.map((c) => c.name).join('、')}</p>
            </Card>
          ))}
          {!data.list.length && <p>暂无抽检策略。</p>}
          <p>共 {data.total} 个策略版本（本页最多50个）。</p>
        </>
      )}
    </section>
  );
}
function PolicyEditor({ refresh, enabled }: { refresh: () => void; enabled: boolean }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [form] = Form.useForm(),
    [options, setOptions] = useState<{
      organizations: { id: string; name: string }[];
      teams: { id: string; name: string; homeOrganizationId: string }[];
    }>(),
    [key, setKey] = useState(crypto.randomUUID());
  async function begin() {
    try {
      setOptions(await get('/quality/options'));
      setOpen(true);
      setKey(crypto.randomUUID());
    } catch (e) {
      showRequestError(e);
    }
  }
  async function save() {
    try {
      const v = await form.validateFields();
      setBusy(true);
      const checklist = String(v.checklist)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name, index) => ({ code: 'CHECK_' + (index + 1), name }));
      await post('/quality/policies', {
        ...v,
        professionalTeamId: v.professionalTeamId ?? null,
        checklist,
        requestKey: key,
      });
      setOpen(false);
      form.resetFields();
      refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button disabled={!enabled} onClick={() => void begin()}>
        新增策略版本
      </Button>
      <Modal
        title="新增抽检策略版本"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        okText="保存策略"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ 'aria-label': '保存策略', disabled: busy }}
      >
        <Form form={form} layout="vertical" initialValues={{ mode: 'COUNT', amount: 1, stratified: false }}>
          <Form.Item name="code" label="策略编码" rules={[{ required: true, pattern: /^[A-Z0-9_-]+$/ }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="策略名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="organizationId" label="所属组织" rules={[{ required: true }]}>
            <Select options={options?.organizations.map((o) => ({ value: o.id, label: o.name }))} />
          </Form.Item>
          <Form.Item name="professionalTeamId" label="限定团队">
            <Select allowClear options={options?.teams.map((o) => ({ value: o.id, label: o.name }))} />
          </Form.Item>
          <Form.Item name="mode" label="抽样方式">
            <Select
              options={[
                { value: 'COUNT', label: '固定数量' },
                { value: 'RATIO', label: '百分比' },
              ]}
            />
          </Form.Item>
          <Form.Item name="amount" label="数量或百分比">
            <InputNumber min={1} max={10000} />
          </Form.Item>
          <Form.Item name="stratified" valuePropName="checked">
            <Checkbox>按团队分层抽取</Checkbox>
          </Form.Item>
          <Form.Item name="checklist" label="检查项目（每行一项）" rules={[{ required: true }]}>
            <Input.TextArea rows={5} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
export function QualityRunsPage() {
  const [page, setPage] = useState(1),
    { data, error, refresh } = useLiveSop<{
      list: { id: string; month: string; batchKey: string; policy: { name: string; number: number } }[];
      total: number;
    }>('/quality/runs?page=' + page),
    can = useCan(),
    [open, setOpen] = useState(false),
    [policies, setPolicies] = useState<Policy[]>([]),
    [busy, setBusy] = useState(false),
    [form] = Form.useForm(),
    [key, setKey] = useState(crypto.randomUUID());
  async function begin() {
    try {
      setPolicies((await get<{ list: Policy[] }>('/quality/policies?pageSize=100')).list);
      setKey(crypto.randomUUID());
      setOpen(true);
    } catch (e) {
      showRequestError(e);
    }
  }
  async function save() {
    try {
      const v = await form.validateFields();
      setBusy(true);
      await post('/quality/runs', { ...v, month: v.month || undefined, requestKey: key });
      setOpen(false);
      form.resetFields();
      refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="unified-area-page">
      <h1>月度抽检批次</h1>
      <Space wrap>
        <Link to="/admin/quality-rules">抽检策略</Link>
        <Link to="/quality/reviews">二级检查工作表</Link>
        <Link to="/quality/issues">问题整改工作表</Link>
        <Button disabled={!can('quality.sample.manage')} onClick={() => void begin()}>
          创建抽检批次
        </Button>
      </Space>
      <p>
        默认抽取上海时区上一自然月已结案件。同一策略、权限范围、月份和批次号固定样本；补抽填写新批次号与原因。
      </p>
      <Feedback error={error} data={data} />
      {data?.list.map((r) => (
        <Card key={r.id} style={{ marginTop: 12 }}>
          <Link to={'/quality/runs/' + r.id}>
            {r.policy.name} · {r.month} · {r.batchKey}
          </Link>
        </Card>
      ))}
      {data && !data.list.length && <p>暂无抽检批次。</p>}
      <Space>
        <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          上一页
        </Button>
        <span>第 {page} 页</span>
        <Button disabled={!data || page * 50 >= data.total} onClick={() => setPage((p) => p + 1)}>
          下一页
        </Button>
      </Space>
      <Modal
        title="创建抽检批次"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        okText="执行抽样"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ 'aria-label': '执行抽样', disabled: busy }}
      >
        <Form form={form} layout="vertical" initialValues={{ batchKey: 'PRIMARY' }}>
          <Form.Item name="policyId" label="策略版本" rules={[{ required: true }]}>
            <Select options={policies.map((p) => ({ value: p.id, label: p.name + ' v' + p.number }))} />
          </Form.Item>
          <Form.Item name="month" label="月份（留空取上月）">
            <Input placeholder="2026-08" />
          </Form.Item>
          <Form.Item name="batchKey" label="批次号" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="reason" label="补抽原因">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
export function QualityRunPage() {
  const { id } = useParams(),
    { data, error } = useLiveSop<{
      id: string;
      month: string;
      batchKey: string;
      policy: Policy;
      reason: string | null;
      algorithm: string;
      seed: string;
      candidateHash: string | null;
      candidates: { id: string }[];
      exclusions: { id: string; reason: string }[];
      items: { id: string; name: string; status: string }[];
      scopeRestricted: boolean;
    }>('/quality/runs/' + id);
  return (
    <section className="unified-area-page">
      <Link to="/quality/runs">返回抽检批次</Link>
      <Feedback error={error} data={data} />
      {data && (
        <>
          <h1>
            {data.policy.name} · {data.month}
          </h1>
          <p>
            当前可见候选 {data.candidates.length} 项，检查记录 {data.items.length} 项。
          </p>
          {data.scopeRestricted && <Alert type="info" title="权限范围已收紧，仅显示当前可见对象。" />}
          {data.reason && <p>补抽依据：{data.reason}</p>}
          <details>
            <summary>抽样复现依据</summary>
            <p style={{ overflowWrap: 'anywhere' }}>
              算法 {data.algorithm}；种子 {data.seed}；候选摘要{' '}
              {data.candidateHash ?? '当前范围不足，隐藏完整摘要'}
            </p>
          </details>
          {data.items.map((i) => (
            <Card key={i.id} style={{ marginTop: 12 }}>
              <Link to={'/quality/reviews/' + i.id}>{i.name}</Link> <Tag>{states[i.status]}</Tag>
            </Card>
          ))}
          {!data.items.length && <p>当前没有可见检查记录。可能候选为空、已抽取或缺少检查读取权限。</p>}
        </>
      )}
    </section>
  );
}
export function QualityInspectionPage() {
  const { id } = useParams(),
    live = useLiveSop<{
      id: string;
      runId: string;
      caseId: string;
      name: string;
      version: number;
      status: string;
      checklist: Check[];
      issues: { id: string; name: string; status: string }[];
    }>('/quality/inspections/' + id);
  return (
    <section className="unified-area-page">
      <BusinessTableLinks source="QUALITY_REVIEWS" recordId={id!} />
      <Feedback error={live.error} data={live.data} />
      {live.data && <InspectionForm key={live.data.id} data={live.data} refresh={live.refresh} />}
    </section>
  );
}
function InspectionForm({
  data,
  refresh,
}: {
  data: {
    id: string;
    runId: string;
    caseId: string;
    name: string;
    version: number;
    status: string;
    checklist: Check[];
    issues: { id: string; name: string; status: string }[];
  };
  refresh: () => void;
}) {
  const [draft, setDraft] = useState<{ checks: Check[]; version: number } | null>(null),
    [key, setKey] = useState(crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    can = useCan(),
    checks = draft?.checks ?? data.checklist;
  async function save() {
    setBusy(true);
    try {
      await post('/quality/inspections/' + data.id, {
        expectedVersion: draft?.version ?? data.version,
        requestKey: key,
        checklist: checks,
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
  function change(index: number, part: Partial<Check>) {
    setDraft({
      version: draft?.version ?? data.version,
      checks: checks.map((c, i) => (i === index ? { ...c, ...part } : c)),
    });
  }
  const enabled = data.status === 'PENDING' && can('quality.inspection.record');
  return (
    <>
      <h1>{data.name}</h1>
      <Space wrap>
        <Link to={'/quality/runs/' + data.runId}>返回抽检批次</Link>
        <Link to={'/cases/' + data.caseId}>关联案件</Link>
        <Tag>{states[data.status]}</Tag>
      </Space>
      <p>记录事实检查结果；不替代一级审批，也不重新打开已结案件。不通过将生成整改问题。</p>
      {checks.map((c, i) => (
        <Card title={c.name} key={c.code} style={{ marginTop: 12 }}>
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Select
              aria-label={c.name + '检查结果'}
              disabled={!enabled}
              value={c.result}
              options={[
                { value: 'PENDING', label: '待检查', disabled: true },
                { value: 'PASS', label: '通过' },
                { value: 'FAIL', label: '不通过' },
                { value: 'NA', label: '不适用' },
              ]}
              onChange={(result) => change(i, { result })}
            />
            <Input.TextArea
              aria-label={c.name + '依据'}
              disabled={!enabled}
              value={c.reason}
              placeholder="不通过或不适用必须填写依据"
              onChange={(e) => change(i, { reason: e.target.value })}
            />
          </Space>
        </Card>
      ))}
      {enabled && (
        <Button aria-label="提交检查结果" disabled={busy} loading={busy} onClick={() => void save()}>
          提交检查结果
        </Button>
      )}
      {draft && draft.version !== data.version && (
        <Button
          onClick={() => {
            setDraft({ ...draft, version: data.version });
            setKey(crypto.randomUUID());
          }}
        >
          采用最新检查版本
        </Button>
      )}
      {data.issues.map((i) => (
        <p key={i.id}>
          <Link to={'/quality/issues/' + i.id}>整改问题：{i.name}</Link> <Tag>{states[i.status]}</Tag>
        </p>
      ))}
    </>
  );
}
export function QualityIssuePage() {
  const { id } = useParams(),
    live = useLiveSop<Issue>('/quality/issues/' + id);
  return (
    <section className="unified-area-page">
      <BusinessTableLinks source="QUALITY_ISSUES" recordId={id!} />
      <Feedback error={live.error} data={live.data} />
      {live.data && <IssueContent key={live.data.id} data={live.data} refresh={live.refresh} />}
    </section>
  );
}
function IssueContent({ data, refresh }: { data: Issue; refresh: () => void }) {
  const can = useCan(),
    user = useAuthStore((s) => s.userInfo),
    [operation, setOperation] = useState(''),
    [reading, setReading] = useState(false),
    [version, setVersion] = useState(data.version),
    [key, setKey] = useState(crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [form] = Form.useForm(),
    [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]),
    [files, setFiles] = useState<{ id: string; fileName: string }[]>([]),
    [uploads, setUploads] = useState<{ fileName: string; fileType: string; base64: string }[]>([]);
  useEffect(() => {
    if (operation === 'ASSIGN')
      get<{ id: string; name: string }[]>('/quality/issues/' + data.id + '/assignees')
        .then(setAssignees)
        .catch(showRequestError);
    if (operation === 'SUBMIT' && data.materialsVisible)
      get<{ id: string; fileName: string }[]>('/quality/issues/' + data.id + '/materials')
        .then(setFiles)
        .catch(showRequestError);
  }, [operation, data.id, data.materialsVisible]);
  async function save() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      await post('/quality/issues/' + data.id + '/actions', {
        ...values,
        action: operation,
        expectedVersion: version,
        requestKey: key,
        ...(operation === 'SUBMIT' ? { uploads } : {}),
        ...(values.dueAt ? { dueAt: new Date(values.dueAt).toISOString() } : {}),
      });
      setOperation('');
      form.resetFields();
      setUploads([]);
      refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  async function download(fileId: string) {
    try {
      const f = await get<{ base64: string; fileName: string; fileType: string }>(
        '/quality/issues/' + data.id + '/materials/' + fileId,
      );
      downloadBlob(
        new Blob([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], { type: f.fileType }),
        f.fileName,
      );
    } catch (e) {
      showRequestError(e);
    }
  }
  async function upload(list: FileList | null) {
    if (!list) return;
    setReading(true);
    try {
      if (list.length > 10 || [...list].some((f) => f.size > 10 * 1024 * 1024))
        throw Error('每次最多10个文件，每个不超过10MB');
      const values = await Promise.all(
        [...list].map(
          (f) =>
            new Promise<{ fileName: string; fileType: string; base64: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  fileName: f.name,
                  fileType: f.type || 'application/octet-stream',
                  base64: String(reader.result).split(',')[1],
                });
              reader.onerror = reject;
              reader.readAsDataURL(f);
            }),
        ),
      );
      setUploads(values);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '读取文件失败');
    } finally {
      setReading(false);
    }
  }
  const terminal = ['CLOSED', 'CANCELLED'].includes(data.status),
    mine = user?.id === data.assigneeUserId;
  const allowed = (action: string) => {
    const p: PermissionCode = ['ASSIGN', 'CANCEL'].includes(action)
      ? 'quality.issue.manage'
      : ['VERIFY', 'RETURN'].includes(action)
        ? 'quality.issue.verify'
        : 'quality.issue.resolve';
    return (
      !terminal &&
      can(p) &&
      (action === 'ASSIGN'
        ? data.status !== 'PENDING_VERIFY'
        : action === 'START'
          ? mine && data.status === 'OPEN'
          : action === 'SUBMIT'
            ? mine && data.status === 'IN_PROGRESS'
            : ['VERIFY', 'RETURN'].includes(action)
              ? !mine && data.status === 'PENDING_VERIFY'
              : true)
    );
  };
  return (
    <>
      <h1>{data.name}</h1>
      <Tag>{states[data.status]}</Tag>
      <p style={{ whiteSpace: 'pre-wrap' }}>{data.evidence}</p>
      <Space wrap>
        <Link to={'/quality/reviews/' + data.inspectionId}>来源检查</Link>
        <Link to={'/cases/' + data.caseId}>关联案件</Link>
      </Space>
      <p>整改期限：{data.dueAt ? new Date(data.dueAt).toLocaleString() : '待分派'}</p>
      <Space wrap>
        {Object.keys(actions)
          .filter(allowed)
          .map((a) => (
            <Button
              key={a}
              onClick={() => {
                setOperation(a);
                setVersion(data.version);
                setKey(crypto.randomUUID());
                form.resetFields();
                setUploads([]);
              }}
            >
              {actions[a]}
            </Button>
          ))}
      </Space>
      <h2>整改与复核历史</h2>
      {data.revisions.map((r) => (
        <Card key={r.id} title={'第 ' + r.number + ' 次 · ' + actions[r.action]} style={{ marginTop: 12 }}>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.content || '已记录操作'}</p>
          {r.attachments.map((a) => (
            <Button key={a.fileId} type="link" onClick={() => void download(a.fileId)}>
              {a.file.fileName}
            </Button>
          ))}
        </Card>
      ))}
      <Modal
        title={actions[operation]}
        open={!!operation}
        onCancel={() => setOperation('')}
        onOk={() => void save()}
        okText="确认办理"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ 'aria-label': '确认办理', disabled: busy || reading }}
      >
        <Form form={form} layout="vertical">
          {operation === 'ASSIGN' ? (
            <>
              <Form.Item name="assigneeUserId" label="整改负责人" rules={[{ required: true }]}>
                <Select options={assignees.map((a) => ({ value: a.id, label: a.name }))} />
              </Form.Item>
              <Form.Item name="dueAt" label="整改期限" rules={[{ required: true }]}>
                <Input type="datetime-local" />
              </Form.Item>
            </>
          ) : (
            operation !== 'START' && (
              <Form.Item name="content" label="办理依据" rules={[{ required: true }]}>
                <Input.TextArea rows={5} />
              </Form.Item>
            )
          )}
          {operation === 'SUBMIT' && (
            <>
              <Form.Item name="fileIds" label="引用案件材料">
                <Select
                  mode="multiple"
                  disabled={!data.materialsVisible}
                  options={files.map((f) => ({ value: f.id, label: f.fileName }))}
                />
              </Form.Item>
              {can('case.file.manage') && (
                <label>
                  新增整改材料（保留案件终态）
                  <input
                    aria-label="新增整改材料"
                    type="file"
                    multiple
                    onChange={(e) => void upload(e.target.files)}
                  />
                </label>
              )}
            </>
          )}
        </Form>
        {version !== data.version && (
          <Button
            onClick={() => {
              setVersion(data.version);
              setKey(crypto.randomUUID());
            }}
          >
            采用最新问题版本
          </Button>
        )}
      </Modal>
    </>
  );
}
