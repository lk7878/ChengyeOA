import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  DownOutlined,
  FilterOutlined,
  PlusOutlined,
  ReloadOutlined,
  ShareAltOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { get, post, patch, errorMessage, errorStatus, streamEvents } from '@/features/workspaces/api';
import type {
  Access,
  Base,
  DataTable,
  Directory,
  Field,
  Member,
  QueryResult,
  RecordDetail,
  RecordRow,
  TableDetail,
  View,
  ViewConfig,
  Workspace,
} from '@/features/workspaces/types';
import { fieldNames } from '@/features/workspaces/types';
import FieldInput from '@/features/workspaces/FieldInput';
import { displayValue } from '@/features/workspaces/display-value';
import GridCell from '@/features/workspaces/GridCell';
import { changedValues, rebaseDraft } from '@/features/workspaces/editing';
import FilterEditor from '@/features/workspaces/FilterEditor';
import './workspace.css';

const emptyDirectory: Directory = { organizations: [], employees: [], users: [], teams: [] };
type Dialog = {
  kind: 'workspace' | 'base' | 'table' | 'rename' | 'field' | 'view' | 'share';
  field?: Field;
  table?: DataTable;
  view?: View;
  duplicate?: boolean;
};
type Editing = {
  schemaVersion: number;
  row?: RecordRow;
  field?: Field;
  values: Record<string, unknown>;
  key: string;
  detail?: RecordDetail;
  remote?: RecordRow;
};

export default function WorkspacesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const baseId = params.get('base') || '';
  const tableId = params.get('table') || '';
  const selectedViewId = params.get('view') || '';
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [tables, setTables] = useState<DataTable[]>([]);
  const [base, setBase] = useState<Base>();
  const [baseAccess, setBaseAccess] = useState<Access>();
  const [detail, setDetail] = useState<TableDetail>();
  const [directory, setDirectory] = useState<Directory>(emptyDirectory);
  const [result, setResult] = useState<QueryResult>();
  const [config, setConfig] = useState<ViewConfig>({});
  const [configDirty, setConfigDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [queryError, setQueryError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connection, setConnection] = useState('连接中');
  const [online, setOnline] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState<'fields' | 'view' | 'filter' | null>(null);
  const [dialog, setDialog] = useState<Dialog>();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const [members, setMembers] = useState<Member[]>([]);
  const [inlineDirty, setInlineDirty] = useState(false);
  const [viewVersion, setViewVersion] = useState(1);
  const [editing, setEditing] = useState<Editing>();
  const [saveState, setSaveState] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const view =
    detail?.views.find((v) => v.id === selectedViewId) ||
    detail?.views.find((v) => v.id === detail.preferredViewId) ||
    detail?.views.find((v) => v.isDefault);
  const currentView = useRef('');
  const mutationKey = useRef(crypto.randomUUID());
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = configDirty;
  }, [configDirty]);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const loadWorkspaces = useCallback(
    () =>
      get<{ workspaces: Workspace[]; canCreate: boolean }>('/workspaces').then((r) => {
        setWorkspaces(r.workspaces);
        setCanCreate(r.canCreate);
      }),
    [],
  );
  useEffect(() => {
    void loadWorkspaces().catch((e) => setQueryError(errorMessage(e)));
  }, [loadWorkspaces]);
  useEffect(() => {
    let alive = true;
    void get<Directory>(
      '/collaboration/options' + (base?.workspaceId ? '?workspaceId=' + base.workspaceId : ''),
    )
      .then((r) => {
        if (alive) setDirectory(r);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [base?.workspaceId]);
  useEffect(() => {
    let alive = true;
    if (!baseId) return;
    void get<{ base: Base; access: Access; tables: DataTable[] }>('/bases/' + baseId + '/tables')
      .then((r) => {
        if (alive) {
          setBase(r.base);
          setBaseAccess(r.access);
          setTables(r.tables);
        }
      })
      .catch((e) => {
        if (alive) {
          setQueryError(errorMessage(e));
          setTables([]);
          setDetail(undefined);
          setResult(undefined);
        }
      });
    return () => {
      alive = false;
    };
  }, [baseId, revision]);
  useEffect(() => {
    let alive = true;
    if (!tableId) return;
    void get<TableDetail>('/tables/' + tableId)
      .then((r) => {
        if (!alive) return;
        if (r.table.baseId !== baseId) {
          setQueryError('数据表不属于当前应用');
          setDetail(undefined);
          return;
        }
        setDetail(r);
        const v =
          r.views.find((v) => v.id === selectedViewId) ||
          r.views.find((v) => v.id === r.preferredViewId) ||
          r.views.find((v) => v.isDefault);
        if (v && (currentView.current !== v.id || !dirtyRef.current)) {
          if (currentView.current !== v.id) setPage(1);
          currentView.current = v.id;
          setConfig(v.config);
          setViewVersion(v.version);
          setConfigDirty(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setQueryError(errorMessage(e));
          setDetail(undefined);
          setResult(undefined);
          setEditing(undefined);
        }
      });
    return () => {
      alive = false;
    };
  }, [tableId, baseId, selectedViewId, revision]);
  useEffect(() => {
    let alive = true;
    if (!tableId || !detail || detail.table.id !== tableId) return;
    // Loading state follows this authenticated request, including SSE refreshes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setQueryError('');
    void post<QueryResult>('/tables/' + tableId + '/records/query', {
      viewId: view?.id,
      config,
      page,
      pageSize: 50,
    })
      .then((r) => {
        if (alive) setResult(r);
      })
      .catch((e) => {
        if (alive) {
          setResult(undefined);
          setQueryError(errorMessage(e));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tableId, detail, view?.id, config, page, revision]);
  useEffect(() => {
    if (!baseId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      if (abort.signal.aborted) return;
      setConnection('连接中');
      try {
        await streamEvents(baseId, abort.signal, (kind, payload) => {
          if (abort.signal.aborted) return;
          if (kind === 'ready') {
            setConnection('实时同步已连接');
            refresh();
          }
          if (kind === 'invalidate') {
            if ((payload as { kind?: string }).kind === 'access.updated') {
              setDetail(undefined);
              setResult(undefined);
              setEditing(undefined);
              setSettings(null);
              setDialog(undefined);
            }
            refresh();
          }
          if (kind === 'presence') setOnline((payload as { users: { id: string; name: string }[] }).users);
          if (kind === 'revoked') {
            setDetail(undefined);
            setResult(undefined);
            setTables([]);
            setEditing(undefined);
            setDirectory(emptyDirectory);
            setOnline([]);
            setQueryError('访问权限或会话已失效，请重新打开工作区。');
            setConnection('连接已失效');
            abort.abort();
          }
        });
      } catch {
        /* Network state is shown below; pending edits remain in the component. */
      }
      if (!abort.signal.aborted) {
        setConnection('连接中断，正在重连');
        timer = setTimeout(() => {
          void connect();
        }, 2000);
      }
    };
    void connect();
    return () => {
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [baseId, refresh]);
  const go = (next: Record<string, string>) => {
    if (configDirty || editing || inlineDirty) {
      Modal.confirm({
        cancelText: '取消',
        title: '有尚未保存的修改',
        content: '切换后将放弃当前未保存的视图配置或记录输入。',
        okText: '放弃并切换',
        onOk: () => {
          setConfigDirty(false);
          setEditing(undefined);
          setInlineDirty(false);
          if (next.base !== baseId) {
            setBase(undefined);
            setTables([]);
            setDirectory(emptyDirectory);
          }
          setDetail(undefined);
          setResult(undefined);
          setQueryError('');
          setParams(next);
          setMobileNav(false);
        },
      });
    } else {
      if (next.base !== baseId) {
        setBase(undefined);
        setTables([]);
        setDirectory(emptyDirectory);
      }
      setDetail(undefined);
      setResult(undefined);
      setQueryError('');
      setParams(next);
      setMobileNav(false);
    }
  };
  const openDialog = (next: Dialog) => {
    mutationKey.current = crypto.randomUUID();
    form.resetFields();
    form.setFieldsValue({
      name: next.field?.name || next.table?.name || (next.view && !next.duplicate ? next.view.name : ''),
      type: next.field?.type || next.view?.type || (next.kind === 'view' ? 'GRID' : 'TEXT'),
      template: 'BLANK',
      shared: next.view && !next.duplicate ? next.view.shared : false,
      required: next.field?.required || false,
      choices: next.field?.options.choices?.map((o) => o.name).join('\n') || '',
      targetTableId: next.field?.options.targetTableId,
      helpText: next.field?.options.helpText,
      defaultValue: next.field?.defaultValue,
      position: next.field?.position,
      principalType: 'USER',
      role: 'EDITOR',
      rowScope: 'ALL',
      canCreate: false,
      hiddenFields: [],
      readonlyFields: [],
    });
    setDialog(next);
    if (next.kind === 'share' && base)
      void get<Member[]>('/workspaces/' + base.workspaceId + '/members')
        .then(setMembers)
        .catch((e) => message.error(errorMessage(e)));
  };
  const submitDialog = async () => {
    try {
      const values = await form.validateFields();
      setBusy(true);
      const key = mutationKey.current;
      if (dialog?.kind === 'workspace') {
        await post('/workspaces', { name: values.name, organizationId: values.organizationId }, key);
        await loadWorkspaces();
      }
      if (dialog?.kind === 'base') {
        const r = await post<{ id: string }>(
          '/workspaces/' + values.workspaceId + '/bases',
          { name: values.name },
          key,
        );
        await loadWorkspaces();
        go({ base: r.id });
      }
      if (dialog?.kind === 'table') {
        const r = await post<{ id: string; viewId: string }>(
          '/bases/' + baseId + '/tables',
          { name: values.name, template: values.template },
          key,
        );
        go({ base: baseId, table: r.id, view: r.viewId });
      }
      if (dialog?.kind === 'rename' && dialog.table) {
        const r = await patch<{ id: string }>(
          '/tables/' + dialog.table.id,
          { name: values.name, version: dialog.table.schemaVersion, duplicate: dialog.duplicate },
          key,
        );
        if (dialog.duplicate) go({ base: baseId, table: r.id });
      }
      if (dialog?.kind === 'field' && detail) {
        const previous = dialog.field;
        const options: Field['options'] = values.helpText ? { helpText: values.helpText } : {};
        if (['SINGLE_SELECT', 'MULTI_SELECT'].includes(values.type))
          options.choices = String(values.choices || '')
            .split('\n')
            .map((v) => v.trim())
            .filter(Boolean)
            .map((name) => ({
              id: previous?.options.choices?.find((o) => o.name === name)?.id || name,
              name,
            }));
        if (values.type === 'RELATION') options.targetTableId = values.targetTableId;
        const url = '/tables/' + tableId + '/fields' + (previous ? '/' + previous.id : '');
        await (previous ? patch : post)(
          url,
          {
            name: values.name,
            type: values.type,
            required: values.required,
            options,
            defaultValue: values.defaultValue ?? null,
            position: values.position,
            version: detail.table.schemaVersion,
          },
          key,
        );
      }
      if (dialog?.kind === 'view') {
        const previous = dialog.view;
        const body = {
          name: values.name,
          type: values.type === 'TEXT' ? 'GRID' : values.type,
          shared: values.shared,
          config: dialog.duplicate ? config : previous?.config || {},
          ...(previous && !dialog.duplicate ? { version: previous.version } : {}),
        };
        const r = await (previous && !dialog.duplicate ? patch : post)<{ id: string }>(
          '/tables/' + tableId + '/views' + (previous && !dialog.duplicate ? '/' + previous.id : ''),
          body,
          key,
        );
        go({ base: baseId, table: tableId, view: r.id });
      }
      if (dialog?.kind === 'share' && base) {
        const previous = members.find(
          (m) => m.principalType === values.principalType && m.principalId === values.principalId,
        );
        await post(
          '/workspaces/' + base.workspaceId + '/members',
          {
            principalType: values.principalType,
            principalId: values.principalId,
            role: values.role,
            canCreate: values.canCreate,
            rowScope: values.rowScope,
            hiddenFields: values.hiddenFields,
            readonlyFields: values.readonlyFields,
            version: previous?.version,
          },
          key,
        );
      }
      setDialog(undefined);
      refresh();
      message.success('已保存');
    } catch (e) {
      if (!(e as { errorFields?: unknown }).errorFields) {
        message.error(errorMessage(e));
        if (errorStatus(e)) mutationKey.current = crypto.randomUUID();
      }
    } finally {
      setBusy(false);
    }
  };
  const updateConfig = (next: Partial<ViewConfig>) => {
    setConfig((c) => ({ ...c, ...next }));
    setConfigDirty(true);
    setPage(1);
  };
  const saveConfig = async () => {
    if (!view) return;
    setBusy(true);
    try {
      await patch('/tables/' + tableId + '/views/' + view.id, { version: viewVersion, config });
      setConfigDirty(false);
      refresh();
      message.success('视图配置已保存');
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const openRecord = async (row?: RecordRow, field?: Field) => {
    setSaveState('');
    setEditing({
      schemaVersion: detail?.table.schemaVersion || 1,
      row,
      field,
      values: row ? { ...row.values } : {},
      key: crypto.randomUUID(),
    });
    if (row)
      try {
        const d = await get<RecordDetail>('/tables/' + tableId + '/records/' + row.id);
        setEditing((old) => (old?.row?.id === row.id ? { ...old, detail: d } : old));
      } catch (e) {
        message.error(errorMessage(e));
      }
  };
  const saveRecord = async () => {
    if (!editing || !detail) return;
    setBusy(true);
    setSaveState('保存中');
    const changed = changedValues(editing.row?.values, editing.values);
    try {
      const input = {
        values: changed,
        schemaVersion: editing.schemaVersion,
        ...(editing.row ? { version: editing.row.version } : {}),
      };
      await (editing.row ? patch : post)(
        '/tables/' + tableId + '/records' + (editing.row ? '/' + editing.row.id : ''),
        input,
        editing.key,
      );
      setEditing(undefined);
      setSaveState('已保存');
      refresh();
    } catch (e) {
      setSaveState(errorMessage(e));
      if (errorStatus(e) === 409 && editing.row) {
        try {
          const latest = await get<RecordDetail>('/tables/' + tableId + '/records/' + editing.row.id);
          setEditing((old) => (old ? { ...old, remote: latest.record, key: crypto.randomUUID() } : old));
        } catch {
          /* Original input remains visible. */
        }
      } else if (errorStatus(e)) setEditing((old) => (old ? { ...old, key: crypto.randomUUID() } : old));
    } finally {
      setBusy(false);
    }
  };
  const tableAction = (table: DataTable, action: string) => {
    if (action === 'rename' || action === 'duplicate')
      return openDialog({ kind: 'rename', table, duplicate: action === 'duplicate' });
    Modal.confirm({
      okText: '确定',
      cancelText: '取消',
      title: action === 'archive' ? '归档此表？历史数据会保留。' : '恢复此表？',
      onOk: async () => {
        try {
          await patch('/tables/' + table.id, {
            archived: action === 'archive',
            version: table.schemaVersion,
          });
          if (table.id === tableId && action === 'archive') go({ base: baseId });
          refresh();
        } catch (e) {
          message.error(errorMessage(e));
        }
      },
    });
  };
  const fields = detail?.fields || [];
  const visibleFields =
    config.visibleFields === undefined
      ? fields
      : config.visibleFields.flatMap((id) => fields.find((f) => f.id === id) || []);
  const canManage = (detail?.access.level || 0) >= 3;
  const tableNav = (
    <div className="workspace-directory">
      <Input.Search
        aria-label="搜索数据表"
        placeholder="搜索数据表"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="workspace-table-list">
        {tables
          .filter((t) => t.name.includes(search))
          .map((t) => (
            <div className={'workspace-table-item ' + (t.id === tableId ? 'selected' : '')} key={t.id}>
              <button onClick={() => !t.archived && go({ base: baseId, table: t.id })} disabled={t.archived}>
                <TableOutlined aria-hidden="true" />
                <span>
                  {t.name}
                  {t.archived ? '（已归档）' : ''}
                </span>
              </button>
              {(baseAccess?.level || 0) >= 3 && (
                <Dropdown
                  menu={{
                    items: [
                      { key: 'rename', label: '重命名' },
                      { key: 'duplicate', label: '复制结构' },
                      { key: t.archived ? 'restore' : 'archive', label: t.archived ? '恢复' : '归档' },
                    ],
                    onClick: (e) => tableAction(t, e.key),
                  }}
                >
                  <Button type="text" aria-label={'管理' + t.name}>
                    ⋯
                  </Button>
                </Dropdown>
              )}
            </div>
          ))}
      </div>
      <Tooltip title={!baseAccess?.canCreate ? '需要创建数据表的授权' : ''}>
        <Button
          block
          icon={<PlusOutlined aria-hidden="true" />}
          disabled={!baseAccess?.canCreate}
          onClick={() => openDialog({ kind: 'table' })}
        >
          新建数据表
        </Button>
      </Tooltip>
    </div>
  );
  const records = result?.records || [];
  return (
    <div className="collab-workspace">
      <header className="workspace-top">
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
            OA
          </Button>
          <AppstoreOutlined />
          <button className="workspace-home" onClick={() => go({})}>
            承业 · 协作工作区
          </button>
          {base && (
            <>
              <span className="workspace-divider">/</span>
              <span>{base.name}</span>
            </>
          )}
        </Space>
        <Space>
          <Avatar.Group>
            {online.slice(0, 5).map((u) => (
              <Tooltip key={u.id} title={u.name}>
                <Avatar size="small">{u.name.slice(0, 1)}</Avatar>
              </Tooltip>
            ))}
          </Avatar.Group>
          {base && (
            <Button
              icon={<ShareAltOutlined />}
              disabled={(baseAccess?.level || 0) < 4}
              onClick={() => openDialog({ kind: 'share' })}
            >
              分享
            </Button>
          )}
          <Button onClick={() => navigate('/notifications')}>通知</Button>
          <Button onClick={() => navigate('/knowledge')}>知识库</Button>
        </Space>
      </header>
      {!baseId ? (
        <div className="workspace-home-content">
          <Space wrap>
            <h1>协作工作区</h1>
            {canCreate && <Button onClick={() => openDialog({ kind: 'workspace' })}>＋创建工作区</Button>}
            <Button disabled={!workspaces.length} onClick={() => openDialog({ kind: 'base' })}>
              ＋创建应用
            </Button>
          </Space>
          {queryError && <Alert type="error" title={queryError} />}{' '}
          {!workspaces.length && (
            <Empty description="暂无可访问的工作区。可以创建工作区，或由负责人分享给你。" />
          )}
          {workspaces.map((w) => (
            <section key={w.id}>
              <h2>{w.name}</h2>
              <Space wrap>
                {w.bases.map((b) => (
                  <Button
                    key={b.id}
                    icon={<TableOutlined aria-hidden="true" />}
                    onClick={() => go({ base: b.id })}
                  >
                    {b.name}
                  </Button>
                ))}
                {!w.bases.length && <span>应用为空，请创建第一个应用。</span>}
              </Space>
            </section>
          ))}
        </div>
      ) : (
        <div className="workspace-body">
          <aside className="workspace-sidebar">{tableNav}</aside>
          <main className="workspace-main">
            <div className="workspace-heading">
              <Button className="workspace-mobile-nav" onClick={() => setMobileNav(true)}>
                数据表
              </Button>
              <span>{detail?.table.name || '选择或新建数据表'}</span>
              <Button type="text" icon={<ReloadOutlined />} aria-label="刷新数据" onClick={refresh} />
            </div>
            {detail && (
              <>
                <div className="workspace-views">
                  <Tabs
                    activeKey={view?.id}
                    items={detail.views.map((v) => ({
                      key: v.id,
                      label: (
                        <span>
                          {v.name}
                          {!v.shared && <small> · 个人</small>}
                        </span>
                      ),
                    }))}
                    onChange={(id) => go({ base: baseId, table: tableId, view: id })}
                  />
                  <Button
                    icon={<PlusOutlined aria-hidden="true" />}
                    aria-label="新建视图"
                    onClick={() => openDialog({ kind: 'view' })}
                  />
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'copy', label: '复制为个人视图' },
                        { key: 'rename', label: '视图属性' },
                        { key: 'default', label: '设为我的默认视图' },
                        {
                          key: 'remove',
                          label: '删除视图',
                          disabled: view?.isDefault || (view?.shared && !canManage),
                        },
                      ],
                      onClick: async (e) => {
                        if (!view) return;
                        if (e.key === 'remove') {
                          Modal.confirm({
                            okText: '确定',
                            cancelText: '取消',
                            title: '删除此视图？记录仍然保留。',
                            onOk: async () => {
                              try {
                                await patch('/tables/' + tableId + '/views/' + view.id, {
                                  version: view.version,
                                  remove: true,
                                });
                                go({ base: baseId, table: tableId });
                                refresh();
                              } catch (error) {
                                message.error(errorMessage(error));
                              }
                            },
                          });
                        } else if (e.key === 'default') {
                          try {
                            await patch('/tables/' + tableId + '/views/' + view.id, { default: true });
                            message.success('已设为默认');
                          } catch (error) {
                            message.error(errorMessage(error));
                          }
                        } else openDialog({ kind: 'view', view, duplicate: e.key === 'copy' });
                      },
                    }}
                  >
                    <Button aria-label="视图菜单" icon={<DownOutlined />} />
                  </Dropdown>
                </div>
                <div className="workspace-toolbar">
                  <Button
                    type="primary"
                    icon={<PlusOutlined aria-hidden="true" />}
                    disabled={detail.access.level < 2}
                    onClick={() => {
                      void openRecord();
                    }}
                  >
                    添加记录
                  </Button>
                  <Button onClick={() => setSettings('fields')}>字段配置</Button>
                  <Button onClick={() => setSettings('view')}>视图配置</Button>
                  <Button icon={<FilterOutlined />} onClick={() => setSettings('filter')}>
                    筛选{config.filter ? ' · 已设置' : ''}
                  </Button>
                  <Button onClick={() => setSettings('view')}>分组</Button>
                  <Button onClick={() => setSettings('view')}>排序</Button>
                  <Select
                    aria-label="行高"
                    value={config.rowHeight || 40}
                    options={[
                      { value: 32, label: '紧凑' },
                      { value: 40, label: '标准' },
                      { value: 64, label: '宽松' },
                    ]}
                    onChange={(rowHeight) => updateConfig({ rowHeight })}
                  />
                  {configDirty && (
                    <>
                      <Tag color="orange">视图未保存</Tag>
                      <Button
                        loading={busy}
                        disabled={view?.shared && !canManage}
                        onClick={() => {
                          void saveConfig();
                        }}
                      >
                        保存视图
                      </Button>
                      <Button
                        onClick={() => {
                          setConfig(view?.config || {});
                          setConfigDirty(false);
                        }}
                      >
                        放弃
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}
            {queryError && (
              <Alert
                type="error"
                title={queryError}
                action={
                  <Button size="small" onClick={refresh}>
                    重试
                  </Button>
                }
              />
            )}
            {!detail && !queryError ? (
              <Empty
                className="workspace-empty"
                description="从左下角新建数据表，或选择已有数据表开始协作。"
              />
            ) : (
              detail && (
                <Spin spinning={loading}>
                  <div className="workspace-grid">
                    {
                      <Table<RecordRow>
                        size="small"
                        virtual
                        scroll={{
                          x: Math.max(
                            700,
                            visibleFields.reduce((n, f) => n + (config.widths?.[f.id] || 180), 80),
                          ),
                          y: 520,
                        }}
                        rowKey="id"
                        dataSource={records}
                        pagination={{
                          current: page,
                          pageSize: 50,
                          total: result?.total || 0,
                          onChange: setPage,
                          showSizeChanger: false,
                        }}
                        locale={{ emptyText: '没有符合条件的记录，可新增记录或调整筛选。' }}
                        columns={[
                          {
                            title: '#',
                            key: 'row',
                            width: 64,
                            fixed: 'left',
                            render: (_, row, index) => (
                              <Button
                                type="text"
                                aria-label={'展开第' + (index + 1) + '条记录'}
                                onClick={() => {
                                  void openRecord(row);
                                }}
                              >
                                {(page - 1) * 50 + index + 1}
                              </Button>
                            ),
                          },
                          ...visibleFields.map((f, index) => ({
                            title: (
                              <button
                                className="workspace-field-heading"
                                onClick={() => canManage && openDialog({ kind: 'field', field: f })}
                              >
                                {f.name}
                                {f.required ? ' *' : ''}
                              </button>
                            ),
                            key: f.id,
                            width: config.widths?.[f.id] || 180,
                            fixed: index < (config.frozen || 0) ? ('left' as const) : undefined,
                            render: (_: unknown, row: RecordRow) => (
                              <GridCell
                                row={row}
                                field={f}
                                directory={directory}
                                tableId={tableId}
                                schemaVersion={detail.table.schemaVersion}
                                height={config.rowHeight || 40}
                                onDirty={setInlineDirty}
                                onSaved={() => {
                                  setSaveState('已保存');
                                  refresh();
                                }}
                                onConflict={(draft, remote) =>
                                  setEditing({
                                    schemaVersion: detail.table.schemaVersion,
                                    row,
                                    field: f,
                                    values: { ...row.values, [f.id]: draft },
                                    remote,
                                    key: crypto.randomUUID(),
                                  })
                                }
                              />
                            ),
                          })),
                          {
                            key: 'add-field',
                            title: (
                              <Button
                                type="text"
                                aria-label="新增字段"
                                disabled={!canManage}
                                onClick={() => openDialog({ kind: 'field' })}
                              >
                                ＋
                              </Button>
                            ),
                            render: () => null,
                          },
                        ]}
                      />
                    }
                  </div>
                </Spin>
              )
            )}
            <footer className="workspace-status" role="status">
              <span>
                {result?.total ?? 0} 条可访问记录{' '}
                {result?.groups?.length ? ' · ' + result.groups.length + ' 个分组' : ''}
              </span>
              <span>{saveState || connection}</span>
            </footer>
          </main>
        </div>
      )}
      <Drawer title="数据表" open={mobileNav} onClose={() => setMobileNav(false)} placement="left">
        {tableNav}
      </Drawer>
      <Drawer
        title={settings === 'fields' ? '字段配置' : settings === 'filter' ? '筛选条件' : '视图配置'}
        open={!!settings}
        onClose={() => setSettings(null)}
        size={520}
      >
        {settings === 'fields' ? (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Button type="primary" disabled={!canManage} onClick={() => openDialog({ kind: 'field' })}>
              ＋新增字段
            </Button>
            {fields.map((f) => (
              <div key={f.id} className="workspace-field-row">
                <span>
                  {f.name}
                  <small>{fieldNames[f.type] || f.type}</small>
                </span>
                <Space>
                  <Button disabled={!canManage} onClick={() => openDialog({ kind: 'field', field: f })}>
                    配置
                  </Button>
                  <Button
                    danger
                    disabled={!canManage || f.position === 0}
                    onClick={() =>
                      Modal.confirm({
                        okText: '确定',
                        cancelText: '取消',
                        title: '归档字段 ' + f.name + '？',
                        content: '已有值保留，依赖此字段的筛选和分组需先移除。',
                        onOk: async () => {
                          try {
                            await patch('/tables/' + tableId + '/fields/' + f.id, {
                              version: detail?.table.schemaVersion,
                              archived: true,
                            });
                            refresh();
                          } catch (e) {
                            message.error(errorMessage(e));
                          }
                        },
                      })
                    }
                  >
                    归档
                  </Button>
                </Space>
              </div>
            ))}
          </Space>
        ) : settings === 'filter' ? (
          <FilterEditor
            fields={fields}
            value={config.filter}
            onChange={(filter) => updateConfig({ filter })}
          />
        ) : (
          <Form layout="vertical">
            <Form.Item label="显示字段与顺序">
              <Select
                mode="multiple"
                value={visibleFields.map((f) => f.id)}
                options={fields.map((f) => ({ value: f.id, label: f.name }))}
                onChange={(visibleFields) => updateConfig({ visibleFields })}
              />
            </Form.Item>
            <Form.Item label="分组字段">
              <Select
                mode="multiple"
                maxCount={3}
                value={config.groupBy || []}
                options={fields.map((f) => ({ value: f.id, label: f.name }))}
                onChange={(groupBy) => updateConfig({ groupBy })}
              />
            </Form.Item>
            <Form.Item label="排序字段">
              {(config.sorts || []).map((sort, i) => (
                <Space key={i}>
                  <Select
                    style={{ width: 180 }}
                    value={sort.fieldId}
                    options={fields.map((f) => ({ value: f.id, label: f.name }))}
                    onChange={(fieldId) =>
                      updateConfig({ sorts: config.sorts?.map((s, n) => (i === n ? { ...s, fieldId } : s)) })
                    }
                  />
                  <Select
                    value={sort.direction}
                    options={[
                      { value: 'asc', label: '升序' },
                      { value: 'desc', label: '降序' },
                    ]}
                    onChange={(direction) =>
                      updateConfig({
                        sorts: config.sorts?.map((s, n) => (i === n ? { ...s, direction } : s)),
                      })
                    }
                  />
                  <Button onClick={() => updateConfig({ sorts: config.sorts?.filter((_, n) => i !== n) })}>
                    移除
                  </Button>
                </Space>
              ))}
              <Button
                disabled={!fields.length || (config.sorts?.length || 0) >= 5}
                onClick={() =>
                  updateConfig({
                    sorts: [...(config.sorts || []), { fieldId: fields[0].id, direction: 'asc' }],
                  })
                }
              >
                ＋排序
              </Button>
            </Form.Item>
            <Form.Item label="冻结前几列">
              <InputNumber
                min={0}
                max={5}
                value={config.frozen || 0}
                onChange={(n) => updateConfig({ frozen: n || 0 })}
              />
            </Form.Item>
            {visibleFields.map((f) => (
              <Form.Item key={f.id} label={f.name + '列宽'}>
                <InputNumber
                  min={72}
                  max={1200}
                  value={config.widths?.[f.id] || 180}
                  onChange={(n) => updateConfig({ widths: { ...config.widths, [f.id]: n || 180 } })}
                />
              </Form.Item>
            ))}
          </Form>
        )}
        {settings !== 'fields' && (
          <Space>
            <Button
              type="primary"
              disabled={view?.shared && !canManage}
              onClick={() => {
                void saveConfig();
              }}
            >
              保存视图配置
            </Button>
            <Button onClick={() => openDialog({ kind: 'view', view, duplicate: true })}>另存个人视图</Button>
          </Space>
        )}
      </Drawer>
      <Drawer
        title={editing?.field ? '编辑 ' + editing.field.name : editing?.row ? '记录详情' : '新增记录'}
        open={!!editing}
        onClose={() => setEditing(undefined)}
        size={520}
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={busy}
            disabled={(detail?.access.level || 0) < 2 || !!editing?.remote}
            onClick={() => {
              void saveRecord();
            }}
          >
            保存
          </Button>
        }
      >
        {editing && (
          <>
            <Form layout="vertical">
              {(editing.field ? [editing.field] : fields).map((f) => (
                <Form.Item key={f.id} label={f.name} required={f.required}>
                  <FieldInput
                    field={f}
                    value={editing.values[f.id]}
                    directory={directory}
                    tableId={tableId}
                    disabled={!f.writable}
                    onChange={(value) =>
                      setEditing((old) => (old ? { ...old, values: { ...old.values, [f.id]: value } } : old))
                    }
                  />
                </Form.Item>
              ))}
            </Form>
            {saveState && <Alert type={editing.remote ? 'warning' : 'info'} title={saveState} />}
            {editing.remote && (
              <div className="workspace-conflict">
                <p>远端最新记录（版本 {editing.remote.version}）</p>
                {fields
                  .filter(
                    (f) =>
                      JSON.stringify(editing.remote?.values[f.id]) !== JSON.stringify(editing.values[f.id]),
                  )
                  .map((f) => (
                    <p key={f.id}>
                      {f.name}：{displayValue(f, editing.remote?.values[f.id], directory) || '空'} → 本地：
                      {displayValue(f, editing.values[f.id], directory) || '空'}
                    </p>
                  ))}
                <Space>
                  <Button
                    onClick={() =>
                      setEditing((old) =>
                        old?.remote
                          ? {
                              ...old,
                              schemaVersion: detail?.table.schemaVersion || old.schemaVersion,
                              row: old.remote,
                              values: old.remote.values,
                              remote: undefined,
                            }
                          : old,
                      )
                    }
                  >
                    使用远端值
                  </Button>
                  <Button
                    onClick={() =>
                      setEditing((old) =>
                        old?.remote
                          ? {
                              ...old,
                              schemaVersion: detail?.table.schemaVersion || old.schemaVersion,
                              values: rebaseDraft(old.row?.values || {}, old.values, old.remote.values),
                              row: old.remote,
                              remote: undefined,
                              key: crypto.randomUUID(),
                            }
                          : old,
                      )
                    }
                  >
                    保留本地并复核提交
                  </Button>
                </Space>
              </div>
            )}
            <h3>变更历史</h3>
            {editing.detail?.revisions.map((r) => (
              <div className="workspace-history" key={r.id}>
                <small>
                  版本 {r.version} · {new Date(r.createdAt).toLocaleString('zh-CN')}
                </small>
                {Object.entries(r.changes).map(([id, change]) => (
                  <p key={id}>
                    {fields.find((f) => f.id === id)?.name}：{String(change.before ?? '空')} →{' '}
                    {String(change.after ?? '空')}
                  </p>
                ))}
              </div>
            ))}
          </>
        )}
      </Drawer>
      <Modal
        title={
          dialog
            ? {
                workspace: '创建工作区',
                base: '创建多维表格应用',
                table: '新建数据表',
                rename: dialog.duplicate ? '复制表结构' : '重命名数据表',
                field: dialog.field ? '配置字段' : '新增字段',
                view: dialog.duplicate ? '复制为个人视图' : '视图属性',
                share: '组织协作与分享',
              }[dialog.kind]
            : ''
        }
        open={!!dialog}
        onCancel={() => setDialog(undefined)}
        onOk={() => {
          void submitDialog();
        }}
        confirmLoading={busy}
        okText="确定"
        cancelText="取消"
        forceRender
        width={560}
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          onValuesChange={(changed) => {
            if (dialog?.kind !== 'share') return;
            if ('principalType' in changed) form.setFieldValue('principalId', undefined);
            if ('principalId' in changed) {
              const m = members.find(
                (m) =>
                  m.principalId === changed.principalId &&
                  m.principalType === form.getFieldValue('principalType'),
              );
              form.setFieldsValue(
                m || {
                  role: 'EDITOR',
                  canCreate: false,
                  rowScope: 'ALL',
                  hiddenFields: [],
                  readonlyFields: [],
                },
              );
            }
          }}
        >
          {dialog?.kind !== 'share' && (
            <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true }]}>
              <Input aria-label="名称" maxLength={120} />
            </Form.Item>
          )}
          {dialog?.kind === 'workspace' && (
            <Form.Item name="organizationId" label="所属组织" rules={[{ required: true }]}>
              <Select options={directory.organizations.map((o) => ({ value: o.id, label: o.name }))} />
            </Form.Item>
          )}
          {dialog?.kind === 'base' && (
            <Form.Item name="workspaceId" label="所属工作区" rules={[{ required: true }]}>
              <Select options={workspaces.map((w) => ({ value: w.id, label: w.name }))} />
            </Form.Item>
          )}
          {dialog?.kind === 'table' && (
            <Form.Item name="template" label="创建方式">
              <Select
                options={[
                  { value: 'BLANK', label: '空白数据表' },
                  { value: 'TASKS', label: '任务管理模板' },
                  { value: 'CONTACTS', label: '客户跟进模板' },
                ]}
              />
            </Form.Item>
          )}
          {dialog?.kind === 'field' && (
            <>
              <Form.Item name="type" label="字段类型" rules={[{ required: true }]}>
                <Select options={Object.entries(fieldNames).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              <Form.Item name="required" valuePropName="checked">
                <Checkbox>必填</Checkbox>
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {() =>
                  ['SINGLE_SELECT', 'MULTI_SELECT'].includes(form.getFieldValue('type')) ? (
                    <Form.Item name="choices" label="选项（每行一个）" rules={[{ required: true }]}>
                      <Input.TextArea rows={4} />
                    </Form.Item>
                  ) : form.getFieldValue('type') === 'RELATION' ? (
                    <Form.Item name="targetTableId" label="关联数据表" rules={[{ required: true }]}>
                      <Select
                        options={tables
                          .filter((t) => !t.archived)
                          .map((t) => ({ value: t.id, label: t.name }))}
                      />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {() =>
                  !['CREATED_AT', 'CREATED_BY', 'UPDATED_AT', 'UPDATED_BY', 'FILE', 'RELATION'].includes(
                    form.getFieldValue('type'),
                  ) && (
                    <Form.Item label="默认值">
                      <FieldInput
                        field={{
                          id: dialog.field?.id || 'default',
                          name: '默认值',
                          type: form.getFieldValue('type'),
                          required: false,
                          writable: true,
                          position: 0,
                          archived: false,
                          defaultValue: null,
                          options: {
                            choices: String(form.getFieldValue('choices') || '')
                              .split('\n')
                              .filter(Boolean)
                              .map((name: string) => ({
                                id: dialog.field?.options.choices?.find((o) => o.name === name)?.id || name,
                                name,
                              })),
                          },
                        }}
                        value={form.getFieldValue('defaultValue')}
                        onChange={(value) => form.setFieldValue('defaultValue', value)}
                        directory={directory}
                        tableId={tableId}
                      />
                    </Form.Item>
                  )
                }
              </Form.Item>
              <Form.Item name="helpText" label="填写说明">
                <Input.TextArea />
              </Form.Item>
            </>
          )}
          {dialog?.kind === 'view' && (
            <>
              <Form.Item name="type" label="视图类型">
                <Select options={[{ value: 'GRID', label: '表格' }]} />
              </Form.Item>
              <Form.Item name="shared" valuePropName="checked">
                <Checkbox disabled={!canManage}>团队共享视图</Checkbox>
              </Form.Item>
            </>
          )}
          {dialog?.kind === 'share' && (
            <>
              <Alert type="info" title="分享范围为当前工作区及其应用，链接本身不会授予权限。" />
              <Form.Item name="principalType" label="成员类型">
                <Select
                  options={[
                    { value: 'USER', label: '成员' },
                    { value: 'ORG', label: '部门' },
                    { value: 'TEAM', label: '团队' },
                  ]}
                />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {() => (
                  <Form.Item name="principalId" label="分享给" rules={[{ required: true }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={(form.getFieldValue('principalType') === 'ORG'
                        ? directory.organizations
                        : form.getFieldValue('principalType') === 'TEAM'
                          ? directory.teams
                          : directory.users
                      ).map((o) => ({ value: o.id, label: o.name }))}
                    />
                  </Form.Item>
                )}
              </Form.Item>
              <Form.Item name="role" label="协作能力">
                <Select
                  options={[
                    { value: 'READER', label: '仅阅读' },
                    { value: 'EDITOR', label: '可编辑记录' },
                    { value: 'MANAGER', label: '可管理表格' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="canCreate" valuePropName="checked">
                <Checkbox>允许新建数据表</Checkbox>
              </Form.Item>
              <Form.Item name="rowScope" label="记录范围">
                <Select
                  options={[
                    { value: 'ALL', label: '授权工作区全部记录' },
                    { value: 'SELF', label: '仅本人创建的记录' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="hiddenFields" label="不可见字段（当前表）">
                <Select mode="multiple" options={fields.map((f) => ({ value: f.id, label: f.name }))} />
              </Form.Item>
              <Form.Item name="readonlyFields" label="只读字段（当前表）">
                <Select mode="multiple" options={fields.map((f) => ({ value: f.id, label: f.name }))} />
              </Form.Item>
              <h4>现有协作者</h4>
              {members.map((m) => (
                <div className="workspace-field-row" key={m.id}>
                  <span>
                    {[...directory.users, ...directory.organizations, ...directory.teams].find(
                      (o) => o.id === m.principalId,
                    )?.name || (m.role === 'OWNER' ? '工作区所有者' : '协作者')}{' '}
                    · {m.role}
                  </span>
                  <Button
                    disabled={m.role === 'OWNER' || (baseAccess?.level || 0) < 4}
                    onClick={async () => {
                      try {
                        await post('/workspaces/' + base?.workspaceId + '/members', {
                          principalType: m.principalType,
                          principalId: m.principalId,
                          version: m.version,
                          remove: true,
                        });
                        setMembers((list) => list.filter((item) => item.id !== m.id));
                        refresh();
                      } catch (e) {
                        message.error(errorMessage(e));
                      }
                    }}
                  >
                    移除
                  </Button>
                </div>
              ))}
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}
