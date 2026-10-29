import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Input, Modal, Select, Space, Statistic, Table, Tabs, Tag, message } from 'antd';
import DraggableModal from '@/components/DraggableModal';
import { useAuthStore } from '@/stores/authStore';
import WorkflowDesigner from './WorkflowDesigner';
import WorkflowForm, { RecordPicker } from './WorkflowForm';
import {
  fieldMode,
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
export default function VisualApprovals() {
  const auth = useAuthStore(),
    manage = auth.hasPermission('approval.manage'),
    apply = auth.hasPermission('approval.apply'),
    process = auth.hasPermission('approval.process');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('TODO'),
    [options, setOptions] = useState<Options>(initOptions),
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
  const startKey = useRef(crypto.randomUUID()),
    actionKey = useRef(crypto.randomUUID());
  const bump = () => setRefresh((x) => x + 1);
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
  const chosen = definitions.find((d) => d.id === definitionId),
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
        ...(target ? { targetRecordId: target } : {}),
      };
      const fingerprint = JSON.stringify(payload);
      if (startPayload.current !== fingerprint) {
        startKey.current = crypto.randomUUID();
        startPayload.current = fingerprint;
      }
      const r = await post<Instance>('/workflows/instances', payload, startKey.current);
      setStartOpen(false);
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
        Modal.confirm({
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
          <Link to="/approvals">返回审批中心</Link>
          <h1>可视化审批</h1>
          <p>设计表单与流程，将审批结果同步到业务工作表。</p>
        </div>
        <Space>
          <Button onClick={bump}>刷新</Button>
          {apply && (
            <Button
              type="primary"
              onClick={() => {
                setDefinitionId('');
                setValues({});
                setTitle('');
                setSelections({});
                setTarget(params.get('record') ?? '');
                startKey.current = crypto.randomUUID();
                setStartOpen(true);
              }}
            >
              发起审批
            </Button>
          )}
        </Space>
      </header>
      {error && <Alert type="error" showIcon title={error} closable onClose={() => setError('')} />}
      <Tabs
        activeKey={tab}
        onChange={(t) => {
          setTab(t);
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
        title="发起可视化审批"
        open={startOpen}
        width={850}
        onCancel={() => setStartOpen(false)}
        onOk={start}
        confirmLoading={busy}
        okText="提交申请"
        destroyOnHidden
      >
        <div className="wf-property">
          <label>审批流程</label>
          <Select
            style={{ width: '100%' }}
            value={definitionId || undefined}
            placeholder="选择已发布流程"
            options={definitions
              .filter((d) => !params.get('table') || d.schema.binding?.tableId === params.get('table'))
              .map((d) => ({ value: d.id, label: `${d.name} · V${d.version}` }))}
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
            {chosen.schema.binding?.mode === 'UPDATE' && (
              <div className="wf-property">
                <label>回写业务记录</label>
                <RecordPicker
                  key={chosen.schema.binding.tableId}
                  tableId={chosen.schema.binding.tableId}
                  value={target || undefined}
                  onChange={setTarget}
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
              .filter((n) => n.rule?.type === 'SELECT')
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
            <Space wrap>
              {status(detail.status)}
              <Tag>V{detail.definitionVersion}</Tag>
              <span>发起人：{user(detail.applicantId)}</span>
              <span>当前节点：{node?.name}</span>
              <Button
                onClick={() => {
                  Modal.confirm({
                    title: '刷新详情',
                    content: '刷新会丢弃尚未提交的输入。',
                    onOk: () => open(detail.id),
                  });
                }}
              >
                刷新详情
              </Button>
            </Space>
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
                            placeholder="审批意见（驳回、退回时必填）"
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
                                <Button disabled={busy || !returnNode} onClick={() => act('RETURN')}>
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
                                  disabled={busy || targets.length !== 1}
                                  onClick={() => act('FORWARD')}
                                >
                                  转办
                                </Button>
                                <Button disabled={busy || !targets.length} onClick={() => act('ADD')}>
                                  加签
                                </Button>
                              </>
                            )}
                          </Space>
                        </div>
                      )}
                      {detail.status === 'PENDING' && detail.applicantId === auth.userInfo?.id && apply && (
                        <Button
                          style={{ marginTop: 16 }}
                          danger
                          disabled={busy}
                          onClick={() =>
                            Modal.confirm({ title: '撤回本次申请？', onOk: () => act('WITHDRAW') })
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
    </div>
  );
}
