import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { integrationApi, type PayrollBatch } from '@/api/business-integration';
import { Alert, Button, Input, Select, Space, Statistic, Table, Tabs, Tag, message } from 'antd';
import DraggableModal from '@/components/DraggableModal';
import { useAuthStore } from '@/stores/authStore';
import WorkflowDesigner from './WorkflowDesigner';
import WorkflowForm, { RecordPicker } from './WorkflowForm';
import ApprovalPrint from './ApprovalPrint';
import { displayValue } from './print-format';
import {
  fieldMode,
  recipientRules,
  matches,
  starter,
  labels,
  get,
  post,
  errorText,
  type Definition,
  type Instance,
  type Options,
  type Values,
  type TableSchema,
} from './api';
import './workflow.css';

interface Stat {
  counts: Array<{ status: string; _count: number }>;
  nodes: Array<{ nodeName: string; count: number; hours: number }>;
  overdue: number;
  syncFailures: number;
}
const initOptions: Options = { users: [], roles: [], hooks: [] };
function approvalTab(value: string | null, manage: boolean): string {
  const allowed = ['TODO', 'DONE', 'APPLIED', 'CC', ...(manage ? ['ALL', 'DESIGN', 'MONITOR'] : [])];
  return value && allowed.includes(value) ? value : 'TODO';
}
export default function VisualApprovals() {
  const auth = useAuthStore(),
    manage = auth.hasPermission('approval.manage'),
    apply = auth.hasPermission('approval.apply'),
    process = auth.hasPermission('approval.process');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const payrollId = params.get('payroll');
  const [payroll, setPayroll] = useState<PayrollBatch>();
  const tab = approvalTab(params.get('role'), manage);
  const [options, setOptions] = useState<Options>(initOptions),
    [ownRoles, setOwnRoles] = useState<string[]>([]),
    [definitions, setDefinitions] = useState<Definition[]>([]),
    [allDefinitions, setAllDefinitions] = useState<Definition[]>([]),
    [editing, setEditing] = useState<Definition>();
  const [rows, setRows] = useState<Instance[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(''),
    [refresh, setRefresh] = useState(0),
    [stats, setStats] = useState<Stat>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [startOpen, setStartOpen] = useState(false),
    [definitionId, setDefinitionId] = useState(''),
    [title, setTitle] = useState(''),
    [values, setValues] = useState<Values>({}),
    [selections, setSelections] = useState<Record<string, string[]>>({}),
    [target, setTarget] = useState('');
  const [detail, setDetail] = useState<Instance>(),
    [draft, setDraft] = useState<Values>({}),
    [remark, setRemark] = useState(''),
    [targets, setTargets] = useState<string[]>([]),
    [returnNode, setReturnNode] = useState('');
  const startPayload = useRef('');
  const [correction, setCorrection] = useState<Instance>(),
    [printing, setPrinting] = useState<Instance>();
  const startKey = useRef(crypto.randomUUID()),
    actionKey = useRef(crypto.randomUUID());
  const bump = () => setRefresh((x) => x + 1);
  useEffect(() => {
    if (!payrollId || !apply) return;
    let active = true;
    integrationApi
      .payrollDetail(payrollId)
      .then(({ data }) => {
        if (!active) return;
        if (data.instance) {
          setError('该工资表已提交审批，请从工资表页面打开已有审批。');
          return;
        }
        setPayroll(data);
        setTitle(data.title);
        setStartOpen(true);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [payrollId, apply]);
  useEffect(() => {
    get<Options & { ownRoles: string[] }>('/workflows/options')
      .then((o) => {
        setOptions(o);
        setOwnRoles(o.ownRoles);
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    if (apply)
      get<Definition[]>('/workflows/definitions')
        .then(setDefinitions)
        .catch((e) => setError(errorText(e)));
    if (manage)
      get<Definition[]>('/workflows/definitions?manage=true')
        .then(setAllDefinitions)
        .catch((e) => setError(errorText(e)));
  }, [apply, manage, refresh]);
  useEffect(() => {
    let active = true;
    if (tab === 'DESIGN') return;
    if (tab === 'MONITOR') {
      get<Stat>('/workflows/stats')
        .then((r) => {
          if (active) setStats(r);
        })
        .catch((e) => setError(errorText(e)));
    } else
      get<{ rows: Instance[]; total: number }>(
        `/workflows/instances?role=${tab}&page=${page}&keyword=${encodeURIComponent(query)}`,
      )
        .then((r) => {
          if (active) {
            setRows(r.rows);
            setTotal(r.total);
          }
        })
        .catch((e) => setError(errorText(e)));
    return () => {
      active = false;
    };
  }, [tab, page, query, refresh]);
  const open = async (id: string) => {
    try {
      const d = await get<Instance>(`/workflows/instances/${id}`);
      setDetail(d);
      setDraft(d.content);
      setRemark('');
      setTargets([]);
      setReturnNode('');
      actionKey.current = crypto.randomUUID();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const requestedId = params.get('instance');
  useEffect(() => {
    if (!requestedId) return;
    let live = true;
    get<Instance>(`/workflows/instances/${requestedId}`)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setDraft(d.content);
        setRemark('');
        setTargets([]);
        setReturnNode('');
        actionKey.current = crypto.randomUUID();
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [requestedId]);
  const chosen: Definition | undefined = correction
      ? {
          id: correction.definitionId,
          name: correction.title,
          revision: 0,
          enabled: true,
          version: correction.definitionVersion,
          schema: {
            ...correction.snapshot,
            ...(correction.snapshot.binding
              ? { binding: { ...correction.snapshot.binding, mode: 'UPDATE' } }
              : {}),
          },
        }
      : definitions.find((d) => d.id === definitionId),
    startNode = chosen?.schema.nodes.find((n) => n.type === 'START');
  const editable =
    chosen && startNode
      ? chosen.schema.fields
          .filter(
            (f) =>
              fieldMode(startNode, f.key, ownRoles) === 'EDIT' && !['formula', 'moneyUpper'].includes(f.type),
          )
          .map((f) => f.key)
      : [];
  const start = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const content = Object.fromEntries(
        Object.entries(values).filter(
          ([k]) =>
            editable.includes(k) &&
            matches(chosen.schema.fields.find((f) => f.key === k)?.visibleWhen, values),
        ),
      );
      const payload = {
        definitionId,
        title,
        content,
        selections,
        ...(correction ? { correctionOf: correction.id } : {}),
        ...(target ? { targetRecordId: target } : {}),
        ...(payroll && !correction ? { payrollBatchId: payroll.id, payrollVersion: payroll.version } : {}),
      };
      const fingerprint = JSON.stringify(payload);
      if (startPayload.current !== fingerprint) {
        startKey.current = crypto.randomUUID();
        startPayload.current = fingerprint;
      }
      const r = await post<Instance>('/workflows/instances', payload, startKey.current);
      setStartOpen(false);
      setPayroll(undefined);
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('payroll');
          return next;
        },
        { replace: true },
      );
      setDetail(r);
      setDraft(r.content);
      bump();
      message.success('申请已提交');
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const act = async (action: string, targetVersion?: number) => {
    if (!detail) return;
    setBusy(true);
    try {
      const changes = Object.fromEntries(
        Object.entries(draft).filter(
          ([k, v]) =>
            detail.editable.includes(k) &&
            matches(detail.snapshot.fields.find((f) => f.key === k)?.visibleWhen, draft) &&
            JSON.stringify(v) !== JSON.stringify(detail.content[k]),
        ),
      );
      const result = await post<Instance>(
        `/workflows/instances/${detail.id}/actions`,
        {
          action,
          version: detail.version,
          remark,
          ...(['APPROVE', 'RESUBMIT'].includes(action) ? { values: changes } : {}),
          ...(['ADD', 'FORWARD'].includes(action) ? { userIds: targets } : {}),
          ...(action === 'RETURN' ? { returnNode } : {}),
          ...(targetVersion ? { targetVersion } : {}),
        },
        actionKey.current,
      );
      setDetail(result);
      setDraft(result.content);
      setRemark('');
      setTargets([]);
      actionKey.current = crypto.randomUUID();
      bump();
      message.success('操作成功');
    } catch (e) {
      message.error(errorText(e));
      actionKey.current = crypto.randomUUID();
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    if (!detail?.snapshot.binding) return;
    try {
      const b = detail.snapshot.binding;
      if (b.mode === 'UPDATE') {
        const r = await get<{ record: { version: number } }>(
          `/tables/${b.tableId}/records/${detail.targetRecordId}`,
        );
        DraggableModal.confirm({
          title: '确认重新回写',
          content: `将把本次审批结果写入当前业务记录（版本 ${r.record.version}）。请先核对表格中的最新内容。`,
          onOk: () => act('RETRY_SYNC', r.record.version),
        });
      } else await act('RETRY_SYNC');
    } catch (e) {
      message.error(errorText(e));
    }
  };
  const user = (id: string) => options.users.find((u) => u.id === id)?.name ?? id;
  const status = (s: string) => (
    <Tag
      color={
        s === 'APPROVED' || s === 'SYNCED'
          ? 'green'
          : s === 'FAILED' || s === 'REJECTED'
            ? 'red'
            : s === 'PENDING'
              ? 'gold'
              : undefined
      }
    >
      {labels[s] ?? s}
    </Tag>
  );
  const list = (
    <Table
      rowKey="id"
      dataSource={rows}
      pagination={{ current: page, pageSize: 30, total, onChange: setPage }}
      columns={[
        { title: '审批标题', dataIndex: 'title' },
        { title: '发起人', dataIndex: 'applicantId', render: user },
        { title: '状态', dataIndex: 'status', render: status },
        { title: '流程版本', dataIndex: 'definitionVersion' },
        { title: '表格同步', dataIndex: 'syncStatus', render: status },
        { title: '发起时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
        { title: '操作', render: (_, r) => <Button onClick={() => open(r.id)}>详情 / 处理</Button> },
      ]}
    />
  );
  if (editing)
    return (
      <WorkflowDesigner
        definition={editing}
        options={options}
        onSaved={bump}
        onClose={() => setEditing(undefined)}
      />
    );
  const pending = detail?.tasks.find(
      (t) => t.assigneeId === auth.userInfo?.id && t.status === 'PENDING' && t.visit === detail.visit,
    ),
    node = detail?.snapshot.nodes.find((n) => n.id === detail.currentNode);
  return (
    <div className="wf-page">
      <header>
        <div>
          <h1>审批中心</h1>
          <p>设计表单与流程，将审批结果同步到业务工作表。</p>
        </div>
        <Space>
          <Button onClick={bump}>刷新</Button>
          {apply && (
            <Button
              type="primary"
              onClick={() => {
                setDefinitionId('');
                setCorrection(undefined);
                setPayroll(undefined);
                setValues({});
                setTitle('');
                setSelections({});
                setTarget(params.get('record') ?? '');
                startKey.current = crypto.randomUUID();
                setStartOpen(true);
              }}
            >
              新建申请
            </Button>
          )}
        </Space>
      </header>
      {error && <Alert type="error" showIcon title={error} closable onClose={() => setError('')} />}
      <Tabs
        activeKey={tab}
        onChange={(t) => {
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.set('role', t);
            return next;
          });
          setPage(1);
        }}
        items={[
          ...[
            ['TODO', '待我审批'],
            ['DONE', '我已审批'],
            ['APPLIED', '我发起的'],
            ['CC', '抄送我的'],
            ...(manage ? [['ALL', '全部流程']] : []),
          ].map(([key, label]) => ({
            key,
            label,
            children: (
              <>
                <Input.Search
                  placeholder="按审批标题查询"
                  allowClear
                  style={{ maxWidth: 360, marginBottom: 16 }}
                  onSearch={(q) => {
                    setQuery(q);
                    setPage(1);
                  }}
                />
                {list}
              </>
            ),
          })),
          ...(manage
            ? [
                {
                  key: 'DESIGN',
                  label: '流程设计',
                  children: (
                    <>
                      <Button
                        type="primary"
                        onClick={() =>
                          setEditing({ name: '', schema: starter(), version: 0, revision: 1, enabled: false })
                        }
                      >
                        新建自定义流程
                      </Button>
                      <Table
                        rowKey="id"
                        dataSource={allDefinitions}
                        columns={[
                          { title: '流程名称', dataIndex: 'name' },
                          { title: '已发布版本', dataIndex: 'version' },
                          {
                            title: '状态',
                            render: (_, r: Definition) => (
                              <Tag>{r.enabled ? '已启用' : r.version ? '已停用' : '草稿'}</Tag>
                            ),
                          },
                          {
                            title: '操作',
                            render: (_, r: Definition) => (
                              <Space>
                                <Button onClick={() => setEditing(r)}>设计 / 发布</Button>
                                {r.version > 0 && (
                                  <Button
                                    onClick={() =>
                                      post(`/workflows/definitions/${r.id}`, {
                                        name: r.name,
                                        schema: r.schema,
                                        revision: r.revision,
                                        enabled: !r.enabled,
                                      })
                                        .then(bump)
                                        .catch((e) => message.error(errorText(e)))
                                    }
                                  >
                                    {r.enabled ? '停用' : '启用'}
                                  </Button>
                                )}
                              </Space>
                            ),
                          },
                        ]}
                      />
                    </>
                  ),
                },
                {
                  key: 'MONITOR',
                  label: '运行监控',
                  children: stats ? (
                    <>
                      <Space size="large" wrap>
                        {stats.counts.map((c) => (
                          <Statistic key={c.status} title={labels[c.status] ?? c.status} value={c._count} />
                        ))}
                        <Statistic title="超时待办" value={stats.overdue} />
                        <Statistic title="待处理回写异常" value={stats.syncFailures} />
                      </Space>
                      <h3>节点处理耗时</h3>
                      <Table
                        rowKey="nodeName"
                        dataSource={stats.nodes}
                        columns={[
                          { title: '节点', dataIndex: 'nodeName' },
                          { title: '已处理任务数', dataIndex: 'count' },
                          {
                            title: '平均耗时（小时）',
                            dataIndex: 'hours',
                            render: (v: number) => v.toFixed(2),
                          },
                        ]}
                      />
                    </>
                  ) : null,
                },
              ]
            : []),
        ]}
      />
      <DraggableModal
        title={correction ? '提交更正申请' : '新建申请'}
        open={startOpen}
        width={850}
        onCancel={() => {
          setStartOpen(false);
          setPayroll(undefined);
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.delete('payroll');
              return next;
            },
            { replace: true },
          );
        }}
        onOk={start}
        confirmLoading={busy}
        okText="提交申请"
        destroyOnHidden
      >
        {payroll && !correction && (
          <Alert
            type="info"
            showIcon
            title={'工资审批：' + payroll.title}
            description={`月份：${payroll.period}；提交后冻结文件：${payroll.attachment.fileName}。审批通过表示待发放，不代表已经支付。`}
          />
        )}
        {correction && (
          <Alert
            type="info"
            showIcon
            title="更正单将重新审批，通过后更新原业务记录"
            description={`原单：${correction.title}。沿用原单的表单和流程版本，保留完整历史。`}
          />
        )}
        <div className="wf-property">
          <label>审批流程</label>
          <Select
            disabled={!!correction}
            style={{ width: '100%' }}
            value={definitionId || undefined}
            placeholder="选择已发布流程"
            options={(correction && chosen ? [chosen] : definitions)
              .filter((d) => !params.get('table') || d.schema.binding?.tableId === params.get('table'))
              .map((d) => ({
                value: d.id,
                label: `${d.schema.category ? d.schema.category + ' / ' : ''}${d.name} · V${d.version}`,
              }))}
            onChange={(id) => {
              setDefinitionId(id);
              setValues({});
              setSelections({});
              setTitle(definitions.find((d) => d.id === id)?.name ?? '');
            }}
          />
        </div>
        <div className="wf-property">
          <label>申请标题</label>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        {chosen && (
          <>
            {chosen.schema.description && (
              <Alert type="info" title="申请说明" description={chosen.schema.description} />
            )}
            {chosen.schema.binding?.mode === 'UPDATE' && (
              <div className="wf-property">
                <label>回写业务记录</label>
                <RecordPicker
                  key={chosen.schema.binding.tableId}
                  tableId={chosen.schema.binding.tableId}
                  value={target || undefined}
                  onChange={setTarget}
                  disabled={!!correction}
                />
              </div>
            )}
            <WorkflowForm
              fields={chosen.schema.fields.filter((f) => fieldMode(startNode!, f.key, ownRoles) !== 'HIDDEN')}
              values={values}
              onChange={setValues}
              users={options.users}
              editable={editable}
            />
            {chosen.schema.nodes
              .filter((n) => recipientRules(n).some((r) => r.type === 'SELECT'))
              .map((n) => (
                <div key={n.id} className="wf-property">
                  <label>{n.name} · 自选处理人</label>
                  <Select
                    style={{ width: '100%' }}
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    value={selections[n.id]}
                    onChange={(ids) => setSelections({ ...selections, [n.id]: ids })}
                    options={options.users.map((u) => ({ value: u.id, label: u.name }))}
                  />
                </div>
              ))}
          </>
        )}
      </DraggableModal>
      <DraggableModal
        title={detail?.title ?? '审批详情'}
        open={!!detail}
        width={1050}
        onCancel={() => {
          setDetail(undefined);
          if (requestedId) {
            params.delete('instance');
            setParams(params);
          }
        }}
        footer={null}
        destroyOnHidden
      >
        {detail && (
          <>
            {detail.businessLink && (
              <Alert
                type="info"
                showIcon
                title="业务审核保留原材料及审核规则"
                description={
                  <span>
                    请核对业务材料{detail.businessType === 'SOP_REVIEW' ? '并完成审核清单' : ''}后处理。
                    <a href={detail.businessLink} target="_blank" rel="noreferrer">
                      打开业务记录与材料
                    </a>
                  </span>
                }
              />
            )}
            <Space wrap>
              {status(detail.status)}
              <Tag>V{detail.definitionVersion}</Tag>
              <span>发起人：{user(detail.applicantId)}</span>
              <span>当前节点：{node?.name}</span>
              <Button
                onClick={() => {
                  DraggableModal.confirm({
                    title: '刷新详情',
                    content: '刷新会丢弃尚未提交的输入。',
                    onOk: () => open(detail.id),
                  });
                }}
              >
                刷新详情
              </Button>
              {detail.snapshot.settings?.printEnabled !== false && (
                <Button onClick={() => setPrinting(detail)}>打印审批单</Button>
              )}
              {detail.canCorrect && apply && (
                <Button
                  onClick={() => {
                    setCorrection(detail);
                    setDefinitionId(detail.definitionId);
                    setValues(detail.content);
                    setTitle(`更正：${detail.title}`.slice(0, 200));
                    setSelections({});
                    setTarget(detail.targetRecordId ?? '');
                    setDetail(undefined);
                    setStartOpen(true);
                  }}
                >
                  提交更正申请
                </Button>
              )}
            </Space>
            {detail.correctionOf && (
              <p>
                更正原申请：
                <Button type="link" onClick={() => open(detail.correctionOf!)}>
                  查看原单及历史
                </Button>
              </p>
            )}
            <div className="wf-summary">
              {(detail.snapshot.settings?.summaryFields?.length
                ? detail.snapshot.settings.summaryFields
                : detail.snapshot.fields.slice(0, 3).map((f) => f.key)
              ).map((key) => {
                const f = detail.snapshot.fields.find((f) => f.key === key);
                return f && matches(f.visibleWhen, detail.content) ? (
                  <div key={key}>
                    <small>{f.label}</small>
                    <strong>{displayValue(f, detail.content[key], options.users)}</strong>
                  </div>
                ) : null;
              })}
            </div>
            {detail.syncStatus === 'FAILED' && (
              <Alert
                type="error"
                showIcon
                title="审批已通过，但表格回写未完成"
                description={
                  <>
                    {detail.syncError}
                    <br />
                    {(manage || detail.applicantId === auth.userInfo?.id) && (
                      <Button onClick={retry}>核对后重试回写</Button>
                    )}
                  </>
                }
              />
            )}
            <Tabs
              items={[
                {
                  key: 'form',
                  label: '表单与办理',
                  children: (
                    <>
                      <WorkflowForm
                        fields={detail.snapshot.fields}
                        values={draft}
                        onChange={setDraft}
                        users={options.users}
                        editable={detail.editable}
                        instanceId={detail.id}
                      />
                      {pending && (process || (node?.type === 'START' && apply)) && (
                        <div className="wf-actions">
                          <Input.TextArea
                            placeholder={
                              node?.actions?.remarkRequired
                                ? '审批意见（必填）'
                                : '审批意见（驳回、退回时必填）'
                            }
                            value={remark}
                            maxLength={2000}
                            onChange={(e) => setRemark(e.target.value)}
                          />
                          <Space wrap>
                            <Button
                              type="primary"
                              loading={busy}
                              onClick={() => act(node?.type === 'START' ? 'RESUBMIT' : 'APPROVE')}
                            >
                              {node?.type === 'START' ? '重新提交' : '同意'}
                            </Button>
                            {node?.type !== 'START' && (
                              <>
                                <Button danger disabled={busy} onClick={() => act('REJECT')}>
                                  驳回
                                </Button>
                                <Select
                                  style={{ width: 200 }}
                                  value={returnNode || undefined}
                                  placeholder="选择退回节点"
                                  options={detail.snapshot.nodes
                                    .filter(
                                      (n) =>
                                        n.id !== detail.currentNode &&
                                        (n.type === 'START' ||
                                          (n.type === 'APPROVAL' &&
                                            detail.logs.some(
                                              (l) => l.nodeId === n.id && l.action === 'ENTER',
                                            ))),
                                    )
                                    .map((n) => ({ value: n.id, label: n.name }))}
                                  onChange={setReturnNode}
                                />
                                <Button
                                  disabled={busy || !returnNode || node?.actions?.return === false}
                                  onClick={() => act('RETURN')}
                                >
                                  退回
                                </Button>
                                <Select
                                  style={{ minWidth: 200, maxWidth: 360 }}
                                  mode="multiple"
                                  showSearch
                                  optionFilterProp="label"
                                  value={targets}
                                  placeholder="选择转办 / 加签人员"
                                  options={options.users.map((u) => ({ value: u.id, label: u.name }))}
                                  onChange={setTargets}
                                />
                                <Button
                                  disabled={busy || targets.length !== 1 || node?.actions?.forward === false}
                                  onClick={() => act('FORWARD')}
                                >
                                  转办
                                </Button>
                                <Button
                                  disabled={busy || !targets.length || node?.actions?.add === false}
                                  onClick={() => act('ADD')}
                                >
                                  加签
                                </Button>
                              </>
                            )}
                          </Space>
                        </div>
                      )}
                      {detail.status === 'PENDING' &&
                        detail.applicantId === auth.userInfo?.id &&
                        apply &&
                        detail.snapshot.settings?.allowWithdraw !== false && (
                          <Button
                            style={{ marginTop: 16 }}
                            danger
                            disabled={busy}
                            onClick={() =>
                              DraggableModal.confirm({ title: '撤回本次申请？', onOk: () => act('WITHDRAW') })
                            }
                          >
                            撤回申请
                          </Button>
                        )}
                    </>
                  ),
                },
                {
                  key: 'history',
                  label: '流程与审计记录',
                  children: (
                    <>
                      <Table
                        rowKey="id"
                        dataSource={detail.tasks}
                        columns={[
                          {
                            title: '节点',
                            dataIndex: 'nodeId',
                            render: (id: string) => detail.snapshot.nodes.find((n) => n.id === id)?.name,
                          },
                          { title: '处理人', dataIndex: 'assigneeId', render: user },
                          { title: '状态', dataIndex: 'status', render: status },
                          { title: '意见', dataIndex: 'remark' },
                          {
                            title: '处理时间',
                            dataIndex: 'processedAt',
                            render: (v: string) => (v ? new Date(v).toLocaleString() : '—'),
                          },
                        ]}
                      />
                      <h3>操作日志</h3>
                      <Table
                        rowKey="id"
                        dataSource={detail.logs}
                        columns={[
                          {
                            title: '时间',
                            dataIndex: 'createdAt',
                            render: (v: string) => new Date(v).toLocaleString(),
                          },
                          { title: '操作人', dataIndex: 'actorId', render: user },
                          { title: '操作', dataIndex: 'action', render: (a: string) => labels[a] ?? a },
                          {
                            title: '节点',
                            dataIndex: 'nodeId',
                            render: (id: string) => detail.snapshot.nodes.find((n) => n.id === id)?.name,
                          },
                          { title: '意见', dataIndex: 'remark' },
                        ]}
                      />
                    </>
                  ),
                },
                {
                  key: 'sync',
                  label: '数据联动',
                  children: (
                    <>
                      <p>表格同步：{status(detail.syncStatus)}</p>
                      {detail.targetRecordId && detail.snapshot.binding && (
                        <Button
                          onClick={() =>
                            get<TableSchema>(`/tables/${detail.snapshot.binding!.tableId}`)
                              .then((d) => navigate(`/workspaces?base=${d.table.baseId}&table=${d.table.id}`))
                              .catch((e) => message.error(errorText(e)))
                          }
                        >
                          打开关联工作表
                        </Button>
                      )}
                      <Table
                        rowKey="id"
                        dataSource={detail.deliveries}
                        columns={[
                          { title: '接口投递', dataIndex: 'status', render: status },
                          { title: '尝试次数', dataIndex: 'attempts' },
                          { title: '信息', dataIndex: 'error' },
                        ]}
                      />
                    </>
                  ),
                },
              ]}
            />
          </>
        )}
      </DraggableModal>
      <ApprovalPrint
        instance={printing}
        users={options.users}
        printer={user(auth.userInfo?.id ?? '')}
        onClose={() => setPrinting(undefined)}
      />
    </div>
  );
}
