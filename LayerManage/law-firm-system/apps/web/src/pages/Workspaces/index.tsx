import { FieldManagement } from '@/features/workspaces/FieldManagement';
import CaseRegistration from '@/features/workspaces/CaseRegistration';
import MoveTable from '@/features/workspaces/MoveTable';
import BulkTransfer from '@/features/workspaces/BulkTransfer';
import AfterSalesStatusAction from '@/features/workspaces/AfterSalesStatusAction';
import RowComments from '@/features/workspaces/RowComments';
import { appearanceRowHeight, useAppearance, useAppearanceStore } from '@/features/appearance/store';
import { createRefreshScheduler } from '@/features/workspaces/refresh-scheduler';
import LifecycleTableControl from '@/features/workspaces/LifecycleTableControl';
import Modal from '@/components/DraggableModal';
import BaseModule from '@/features/workspaces/BaseModule';
import { inventoryViewConfig } from '@/pages/Inventory/context';
import { financialSources, financialViewConfig, financeContextParams } from '@/pages/finance/context';
import { useMenuLabels } from '@/features/navigation/menu-labels';
import { useAuthStore } from '@/stores/authStore';
import { businessSources, isBusinessSource, domainCreate } from '@/features/crm/business-sources';
import CreateBusinessLead from '@/features/crm/CreateBusinessLead';
import CreateBusinessFollow from '@/features/crm/CreateBusinessFollow';
import { useUnifiedShell } from '@/features/navigation/shell-context';
import CloudDrivePage from '@/features/drive/CloudDrivePage';
import { BusinessRecord } from '@/features/workspaces/BusinessRecord';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Avatar, Button, Checkbox, Dropdown, Empty, Form, Input, InputNumber, Pagination, Select, Space, Spin, Table, Tabs, Tag, Tooltip, message } from 'antd';
import type { FormInstance } from 'antd';
import Drawer from '@/components/DraggableDrawer';
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
import { displayValue, fieldLabel, fieldHint } from '@/features/workspaces/display-value';
import PasteDialog from '@/features/workspaces/PasteDialog';
import type { PasteSnapshot } from '@/features/workspaces/clipboard';
import { groupedRows, type GridRow } from '@/features/workspaces/grouping';
import RecordOperations from '@/features/workspaces/RecordOperations';
import GridCell from '@/features/workspaces/GridCell';
import { changedValues, rebaseDraft, initialValues } from '@/features/workspaces/editing';
import FilterEditor from '@/features/workspaces/FilterEditor';
import { useGridViewport } from '@/features/workspaces/use-grid-viewport';
import './workspace.css';

// The draggable modal remounts its form on opening. Initialize after that mount,
// so preserve=false cleanup cannot erase existing field settings.
function DialogFormValues({form, values}: {form: FormInstance; values: Record<string, unknown>}) {
  const initial = useRef(values);
  useEffect(() => { form.setFieldsValue(initial.current); }, [form]);
  return null;
}

const emptyDirectory: Directory = { organizations: [], employees: [], users: [], teams: [] };
type Dialog = {
  kind: 'workspace' | 'base' | 'table' | 'rename' | 'field' | 'view' | 'share';
  field?: Field;
  table?: DataTable;
  view?: View;
  duplicate?: boolean;
};
type Editing = {
  preview?: Record<string,unknown>;
  schemaVersion: number;
  row?: RecordRow;
  field?: Field;
  values: Record<string, unknown>;
  key: string;
  detail?: RecordDetail;
  remote?: RecordRow;
};

export default function WorkspacesPage() {
  const [params] = useSearchParams();
  return params.get('base') ? <WorkspaceEditor /> : <CloudDrivePage />;
}

export function WorkspaceEditor({ businessMode = false }: { businessMode?: boolean }) {
  const { sourceLabel } = useMenuLabels();
  const { gridRef, bodyHeight } = useGridViewport();
  const superAdmin = useAuthStore(state=>!!state.authorization?.isSystemSuperAdmin);
  const appearance = useAppearance();
  const saveAppearance = useAppearanceStore(state => state.save);
  const appearanceReady = useAppearanceStore(state => state.status === 'ready');
  const canStartWorkflow = useAuthStore(s => s.hasPermission('approval.apply') && s.hasPermission('approval.read'));
  const canRequestRefund = useAuthStore(s => s.hasPermission('refund.create'));
  const [creatingLead, setCreatingLead] = useState(false);
  const unifiedShell = useUnifiedShell();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const baseId = params.get('base') || '';
  const tableId = params.get('table') || '';
  const recordId = params.get('record') || '';
  const commentsOnly = params.get('comments') === '1';
  const [commentRow, setCommentRow] = useState<string>();
  const commentRecordId = commentRow || (commentsOnly ? recordId : '');
  const selectedViewId = params.get('view') || '';
  const financeContractId = params.get('contract');
  const financeCaseId = params.get('case');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [tables, setTables] = useState<DataTable[]>([]);
  const [orderToken, setOrderToken] = useState('');
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [base, setBase] = useState<Base>();
  const [baseAccess, setBaseAccess] = useState<Access>();
  const [detail, setDetail] = useState<TableDetail>();
  const summaryModeRef = useRef(false);
  useEffect(() => { summaryModeRef.current = ['INVENTORY_SUMMARY', 'OFFICE_SUMMARY', 'OFFICE_STOCK'].includes(detail?.table.inventoryKind || ''); }, [detail?.table.inventoryKind]);
  const creation = domainCreate(detail?.table.source);
  const canCreateDomain = useAuthStore((s) => !!creation && s.hasPermission(creation.permission));
  const [directory, setDirectory] = useState<Directory>(emptyDirectory);
  const [result, setResult] = useState<QueryResult>();
  const [config, setConfig] = useState<ViewConfig>({});
  const [configDirty, setConfigDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [recordSelection, setRecordSelection] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] });
  const selectionScope = tableId + ':' + selectedViewId;
  const selectedRecords = recordSelection.scope === selectionScope ? recordSelection.ids : [];
  const [page, setPage] = useState(1);
  const [folds, setFolds] = useState<{ scope: string; keys: Set<string> }>({ scope: '', keys: new Set() });
  const [anchor, setAnchor] = useState<{ rowId: string; fieldId: string }>();
  const [paste, setPaste] = useState<{ snapshot: PasteSnapshot; text: string }>();
  const [queryError, setQueryError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connection, setConnection] = useState('连接中');
  const [online, setOnline] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState<'fields' | 'view' | 'filter' | null>(null);
  const [dialog, setDialog] = useState<Dialog>();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const fieldName = Form.useWatch('name', form);
  const assignmentField = dialog?.kind === 'field' && (dialog.field?.options.prospectAssignee || detail?.table.source === 'CUSTOM' && detail.table.name.includes('客资') && fieldName?.trim() === '跟进人');
  const [invite, setInvite] = useState<{tableId:string;version:number;invitations:Record<string,string>;users?:{id:string;name:string}[];roles:{id:string;name:string}[]}>();
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
  const visitedBase = useRef('');
  const mutationKey = useRef(crypto.randomUUID());
  const dirtyRef = useRef(false);
  const inlineDirtyRef = useRef(false);
  const draftRef = useRef(false);
  const refreshPausedRef = useRef(false);
  const loadedTableRef = useRef('');
  useEffect(() => {
    refreshPausedRef.current = configDirty || inlineDirty || !!editing || !!paste || busy || !!settings || !!dialog || creatingLead;
  }, [configDirty, inlineDirty, editing, paste, busy, settings, dialog, creatingLead]);
  useEffect(() => {
    dirtyRef.current = configDirty;
    inlineDirtyRef.current = inlineDirty;
    draftRef.current = inlineDirty || !!editing || !!paste;
  }, [configDirty, inlineDirty, editing, paste]);
  useEffect(() => {
    // Route identity changes invalidate the paste target, including browser back/forward navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPaste(undefined);
    setCreatingLead(false);
    setAnchor(undefined);
    setInlineDirty(false);
    inlineDirtyRef.current = false;
  }, [tableId, baseId]);
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
      '/collaboration/options' + (base?.workspaceId ? '?workspaceId=' + base.workspaceId + (tableId?'&tableId='+encodeURIComponent(tableId):'') : ''),
    )
      .then((r) => {
        if (alive) setDirectory(r);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [base?.workspaceId,tableId]);
  useEffect(() => {
    let alive = true;
    if (!baseId) {
      visitedBase.current = '';
      return;
    }
    void get<{ base: Base; access: Access; tables: DataTable[]; orderToken: string }>(
      '/bases/' + baseId + '/tables',
    )
      .then((r) => {
        if (alive) {
          setBase(r.base);
          if (visitedBase.current !== baseId) {
            visitedBase.current = baseId;
            // Entering a Base records personal navigation once; refreshes and SSE do not.
            void post('/drive/nodes/' + baseId + '/visit', {}).catch(() => undefined);
          }
          setBaseAccess(r.access);
          setTables(r.tables);
          setOrderToken(r.orderToken);
        }
      })
      .catch((e) => {
        if (alive) {
          setQueryError(errorMessage(e));
          if (![401, 403, 404].includes(errorStatus(e) || 0)) return;
          setBase(undefined);
          setBaseAccess(undefined);
          setTables([]);
          setDetail(undefined);
          setResult(undefined);
          setRecordSelection({ scope: '', ids: [] });
          setInlineDirty(false);
          inlineDirtyRef.current = false;
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
          if(!r.table.baseId){setQueryError('数据表目录不可用');return;}
          const next=new URLSearchParams(params);next.set('base',r.table.baseId);setParams(next,{replace:true});
          return;
        }
        if (!draftRef.current) setDetail(old => JSON.stringify(old) === JSON.stringify(r) ? old : r);
        const v =
          r.views.find((v) => v.id === selectedViewId) ||
          r.views.find((v) => v.id === r.preferredViewId) ||
          r.views.find((v) => v.isDefault);
        if (v && (currentView.current !== v.id || (!dirtyRef.current && !draftRef.current))) {
          if (currentView.current !== v.id) setPage(1);
          currentView.current = v.id;
          setConfig(old => JSON.stringify(old) === JSON.stringify(v.config) ? old : v.config);
          setViewVersion(v.version);
          setConfigDirty(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setQueryError(errorMessage(e));
          if (![401, 403, 404].includes(errorStatus(e) || 0)) return;
          setDetail(undefined);
          setResult(undefined);
          setRecordSelection({ scope: '', ids: [] });
          setInlineDirty(false);
          inlineDirtyRef.current = false;
          setEditing(undefined);
          setPaste(undefined);
        }
      });
    return () => {
      alive = false;
    };
  }, [tableId, baseId, selectedViewId, revision, params, setParams]);
  useEffect(() => {
    let alive = true;
    if (!tableId || !detail || detail.table.id !== tableId) return;
    // Only initial loading blocks the grid; background updates keep existing rows interactive.
    setLoading(loadedTableRef.current !== tableId);
    setQueryError('');
    let queryConfig: ViewConfig;
    try {
      queryConfig = inventoryViewConfig(detail.table.source, detail.fields, config, params);
      queryConfig = financialViewConfig(
        detail.table.source,
        detail.fields,
        queryConfig,
        financeContractId,
        financeCaseId,
      );
    } catch (e) {
      setResult(undefined);
      setQueryError((e as Error).message);
      setLoading(false);
      return;
    }
    void post<QueryResult>('/tables/' + tableId + '/records/query', {
      viewId: view?.id,
      config: queryConfig,
      page,
      pageSize: 50,
    })
      .then((r) => {
        if (alive && !draftRef.current) {
          loadedTableRef.current = tableId;
          setResult(r);
        }
      })
      .catch((e) => {
        if (alive) {
          setQueryError(errorMessage(e));
          if (![401, 403, 404].includes(errorStatus(e) || 0)) return;
          setResult(undefined);
          setRecordSelection({ scope: '', ids: [] });
          setInlineDirty(false);
          inlineDirtyRef.current = false;
          setQueryError(errorMessage(e));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tableId, detail, view?.id, config, page, financeContractId, financeCaseId, params, revision]);
  useEffect(() => {
    if (!baseId) return;
    let stopped = false,
      connecting = false;
    const updates = createRefreshScheduler(refresh, () =>
      refreshPausedRef.current || inlineDirtyRef.current || document.visibilityState === 'hidden',
      () => summaryModeRef.current ? 1000 : 30_000,
    );
    let connectedOnce = false;
    let reconnectDelay = 10_000;
    let attempt: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void connect();
      }, delay);
    };
    const connect = async () => {
      if (stopped || connecting || !navigator.onLine) return;
      connecting = true;
      attempt = new AbortController();
      setConnection('连接中');
      try {
        await streamEvents(
          baseId,
          attempt.signal,
          (kind, payload) => {
            if (stopped) return;
            if (kind === 'ready') {
              setConnection('实时同步已连接');
              if (connectedOnce) updates.queue();
              connectedOnce = true;
            }
            if (kind === 'invalidate') {
              if ((payload as { kind?: string }).kind === 'access.updated') {
                setRecordSelection({ scope: '', ids: [] });
                setDetail(undefined);
                setResult(undefined);
                setInlineDirty(false);
                inlineDirtyRef.current = false;
                setEditing(undefined);
                setPaste(undefined);
                setSettings(null);
                setDialog(undefined);
                refresh();
              } else updates.queue();
            }
            if (kind === 'presence') setOnline((payload as { users: { id: string; name: string }[] }).users);
            if (kind === 'revoked') {
              setRecordSelection({ scope: '', ids: [] });
              setBase(undefined);
              setBaseAccess(undefined);
              setSettings(null);
              setDialog(undefined);
              refresh();
              setDetail(undefined);
              setResult(undefined);
              setInlineDirty(false);
              inlineDirtyRef.current = false;
              setTables([]);
              setEditing(undefined);
              setPaste(undefined);
              setDirectory(emptyDirectory);
              setOnline([]);
              setQueryError('访问权限或会话已失效，请重新打开工作区。');
              setConnection('连接已失效');
              stopped = true;
              updates.dispose();
              attempt?.abort();
            }
          },
          tableId,
        );
      } catch {
        // A failed stream never changes saved data or an editor's mutation key.
      } finally {
        connecting = false;
        if (!stopped) {
          setOnline([]);
          setConnection(navigator.onLine ? '连接中断，正在重连' : '网络已断开，未提交草稿已保留');
          if (navigator.onLine) {
            schedule(reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
          }
        }
      }
    };
    const offline = () => {
      clearTimeout(timer);
      attempt?.abort();
      setOnline([]);
      setConnection('网络已断开，未提交草稿已保留');
    };
    const online = () => {
      if (!stopped) schedule(0);
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    if (navigator.onLine) void connect();
    else offline();
    return () => {
      stopped = true;
      updates.dispose();
      clearTimeout(timer);
      attempt?.abort();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [baseId, tableId, refresh]);
  const go = (next: Record<string, string>) => {
    Object.assign(next, financeContextParams(params));
    for (const key of ['kind', 'action', 'item']) if (params.get(key)) next[key] = params.get(key)!;
    if (next.base && params.get('driveReturn')) next.driveReturn = params.get('driveReturn')!;
    setAnchor(undefined);
    setPaste(undefined);
    if (configDirty || editing || inlineDirty) {
      Modal.confirm({
        cancelText: '取消',
        title: '有尚未保存的修改',
        content: '切换后将放弃当前未保存的视图配置或记录输入。',
        okText: '放弃并切换',
        onOk: () => {
          setConfigDirty(false);
          setEditing(undefined);
          setPaste(undefined);
          setInlineDirty(false);
          if (next.base !== baseId) {
            setBase(undefined);
            setTables([]);
            setDirectory(emptyDirectory);
          }
          setDetail(undefined);
          setResult(undefined);
          setRecordSelection({ scope: '', ids: [] });
          setInlineDirty(false);
          inlineDirtyRef.current = false;
          setQueryError('');
          setParams(next);
          refresh();
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
      setInlineDirty(false);
      inlineDirtyRef.current = false;
      setQueryError('');
      setParams(next);
      // Clicking the selected table may leave route dependencies unchanged.
      // Reload after clearing detail instead of leaving an empty editor indefinitely.
      refresh();
      setMobileNav(false);
    }
  };
  const dialogValues = (next: Dialog) => ({
      name: next.field?.name || next.table?.name || (next.view && !next.duplicate ? next.view.name : ''),
      type: next.field?.type || next.view?.type || (next.kind === 'view' ? 'GRID' : 'TEXT'),
      template: 'BLANK',
      shared: next.view && !next.duplicate ? next.view.shared : false,
      required: next.field?.required || false,
      choices: next.field?.options.choices?.map((o) => o.name).join('\n') || '',
      targetTableId: next.field?.options.targetTableId,
      assignmentOrganizationId: next.field?.options.assignmentOrganizationId || workspaces.find(w=>w.id===base?.workspaceId)?.organizationId,
      helpText: next.field?.options.helpText,
      defaultValue: next.field?.defaultValue,
      position: next.field?.position,
      role: 'READER',
    });
  const openDialog = (next: Dialog) => {
    mutationKey.current = crypto.randomUUID();
    form.resetFields();
    if (next.kind === 'field') setSettings(null);
    setDialog(next);
    if (next.kind === 'share' && tableId) {
      setInvite(undefined);
      void get<{version:number;invitations:Record<string,string>;users?:{id:string;name:string}[];roles:{id:string;name:string}[]}>('/tables/'+tableId+'/invitations')
        .then(data=>setInvite({...data,tableId})).catch(e=>message.error(errorMessage(e)));
    }
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
          {
            name: values.name,
            ...(isBusinessSource(values.template)
              ? { source: values.template }
              : { template: values.template }),
          },
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
        const options: Field['options'] = {...(previous?.options.primary ? {primary:true} : {}), ...(values.helpText ? { helpText: values.helpText } : {})};
        if (assignmentField) { options.prospectAssignee = true; options.assignmentOrganizationId = values.assignmentOrganizationId; }
        if (!assignmentField && ['SINGLE_SELECT', 'MULTI_SELECT'].includes(values.type))
          options.choices = String(values.choices || '')
            .split('\n')
            .map((v) => v.trim())
            .filter(Boolean)
            .map((name) => ({
              id: previous?.options.choices?.find((o) => o.name === name)?.id || name,
              name,
            }));
        if (values.type === 'RELATION') {
          if (previous?.options.targetSource) options.targetSource=previous.options.targetSource;
          else options.targetTableId = values.targetTableId;
        }
        const url = '/tables/' + tableId + '/fields' + (previous ? '/' + previous.id : '');
        await (previous ? patch : post)(
          url,
          {
            name: values.name,
            type: assignmentField ? 'USER' : values.type,
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
      if (dialog?.kind === 'share') {
        if (!invite || invite.tableId!==tableId) throw new Error('COLLAB_ACCESS_CONFLICT');
        await post('/tables/'+tableId+'/invitations',{userId:values.principalId,roleId:values.role,version:invite.version},key);
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
      values: row ? { ...row.values } : initialValues(detail?.fields ?? []),
      key: crypto.randomUUID(),
    });
    const next = new URLSearchParams(params);
    if (row) next.set('record', row.id);
    else next.delete('record');
    setParams(next, { replace: true });
  };
  const closeRecord = () => {
    setEditing(undefined);
    setPaste(undefined);
    const next = new URLSearchParams(params);
    next.delete('record');
    setParams(next, { replace: true });
  };
  const recordTableId = detail?.table.id;
  const recordSchemaVersion = detail?.table.schemaVersion;
  useEffect(() => {
    if (!recordId || recordTableId !== tableId || commentsOnly) return;
    let active = true;
    get<RecordDetail>('/tables/' + tableId + '/records/' + recordId)
      .then((d) => {
        if (!active) return;
        setEditing((old) =>
          old?.row?.id === recordId
            ? { ...old, detail: d }
            : {
                row: d.record,
                values: d.record.values,
                schemaVersion: recordSchemaVersion || 1,
                key: crypto.randomUUID(),
                detail: d,
              },
        );
      })
      .catch((e) => {
        if (active) {
          setQueryError(errorMessage(e));
          if (![401, 403, 404].includes(errorStatus(e) || 0)) return;
          setEditing(undefined);
          setPaste(undefined);
        }
      });
    return () => {
      active = false;
    };
  }, [recordId, tableId, recordTableId, recordSchemaVersion, revision, commentsOnly]);
  const saveRecord = async () => {
    if (!editing || !detail) return;
    setBusy(true);
    setSaveState('保存中');
    const changed = changedValues(editing.row?.values, editing.values);
    const medicalLink=fields.find(f=>f.options.medicalRelation);
    if(medicalLink&&editing.values[medicalLink.id])for(const f of fields.filter(f=>f.options.medicalAutofill))delete changed[f.id];
    try {
      const input = {
        values: changed,
        schemaVersion: editing.schemaVersion,
        ...(editing.row ? { version: editing.row.version } : {}),
      };
      await post(
        '/tables/' + tableId + '/records' + (editing.row ? '/' + editing.row.id + '/update' : ''),
        input,
        editing.key,
      );
      closeRecord();
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
    const deleting = action === 'delete';
    const key = crypto.randomUUID();
    Modal.confirm({
      okText: deleting ? '删除' : '确定',
      okButtonProps: { danger: deleting },
      cancelText: '取消',
      title: deleting
        ? `删除“${table.name}”？`
        : action === 'archive'
          ? '归档此表？历史数据会保留。'
          : '恢复此表？',
      content: deleting
        ? table.source === 'CUSTOM'
          ? '将永久删除此表及表内数据、附件、视图和自动化规则，无法恢复。未保存的修改也会丢失。'
          : '将永久删除此工作表的入口、视图、自定义扩展数据、附件和自动化规则。关联的原始业务记录会保留，可重新连接业务数据。未保存的修改会丢失。'
        : undefined,
      onOk: async () => {
        if (deleting) {
          const confirmed = await new Promise<boolean>((resolve) => {
            Modal.confirm({
              title: '高危操作：再次确认永久删除',
              content: `即将永久删除“${table.name}”。请确认已备份需要保留的数据，此操作无法撤销。`,
              okText: '确认永久删除',
              okButtonProps: { danger: true },
              cancelText: '保留此表',
              onOk: () => { resolve(true); },
              onCancel: () => { resolve(false); },
            });
          });
          if (!confirmed) return;
        }
        try {
          await patch(
            '/tables/' + table.id,
            {
              ...(deleting ? { remove: true } : { archived: action === 'archive' }),
              version: table.schemaVersion,
            },
            key,
          );
          if (deleting) {
            setTables((old) => old.filter((item) => item.id !== table.id));
            if (table.id === tableId) {
              setEditing(undefined);
              setPaste(undefined);
              setConfigDirty(false);
              setInlineDirty(false);
              inlineDirtyRef.current = false;
              setDetail(undefined);
              setResult(undefined);
              setSettings(null);
              setDialog(undefined);
              setQueryError('');
              setParams((old) => {
                const next = new URLSearchParams(old);
                for (const name of ['table', 'view', 'record']) next.delete(name);
                const fallback = tables.find((item) => item.id !== table.id && !item.archived);
                if (fallback) next.set('table', fallback.id);
                return next;
              });
            }
            message.success('数据表已删除');
          } else if (table.id === tableId && action === 'archive') go({ base: baseId });
          refresh();
        } catch (e) {
          message.error(errorMessage(e));
          throw e;
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
  const movableTables = tables.filter((t) => t.canManage && !t.archived);
  const moveTable = async (from: string, to: string) => {
    if (directoryBusy || search || !orderToken || from === to) return;
    const order = movableTables.map((t) => t.id);
    const source = order.indexOf(from),
      target = order.indexOf(to);
    if (source < 0 || target < 0) return;
    order.splice(target, 0, order.splice(source, 1)[0]);
    setDirectoryBusy(true);
    try {
      await post('/bases/' + baseId + '/tables/reorder', { order, orderToken });
      message.success('目录顺序已保存');
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setDirectoryBusy(false);
      refresh();
    }
  };
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
            <div
              className={'workspace-table-item ' + (t.id === tableId ? 'selected' : '')}
              key={t.id}
              onDragOver={(e) => {
                if (t.canManage && !t.archived && !search && !directoryBusy) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                void moveTable(e.dataTransfer.getData('application/x-chengye-table'), t.id);
              }}
            >
              <button onClick={() => !t.archived && go({ base: baseId, table: t.id })} disabled={t.archived}>
                <TableOutlined aria-hidden="true" />
                <span>
                  {t.name}
                  {t.archived ? '（已归档）' : ''}
                </span>
              </button>
              {t.canManage && !t.archived && (
                <button
                  className="workspace-table-drag"
                  aria-label={'拖动排序' + t.name}
                  title="拖动排序，或使用菜单上移/下移"
                  draggable={!search && !directoryBusy}
                  disabled={!!search || directoryBusy}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('application/x-chengye-table', t.id);
                  }}
                >
                  ⠿
                </button>
              )}
              {t.canManage && (
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'move-up',
                        label: '上移',
                        disabled:
                          !!search ||
                          directoryBusy ||
                          t.archived ||
                          movableTables.findIndex((item) => item.id === t.id) <= 0,
                      },
                      {
                        key: 'move-down',
                        label: '下移',
                        disabled:
                          !!search ||
                          directoryBusy ||
                          t.archived ||
                          movableTables.findIndex((item) => item.id === t.id) >= movableTables.length - 1,
                      },
                      { key: 'rename', label: '重命名' },
                      { key: 'duplicate', label: '复制结构' },
                      { key: t.archived ? 'restore' : 'archive', label: t.archived ? '恢复' : '归档' },
                      { key: 'delete', label: '删除', danger: true, disabled: !t.canDelete },
                    ],
                    onClick: (e) => {
                      if (e.key === 'move-up' || e.key === 'move-down') {
                        const index = movableTables.findIndex((item) => item.id === t.id);
                        const target = movableTables[index + (e.key === 'move-up' ? -1 : 1)];
                        if (target) void moveTable(t.id, target.id);
                      } else tableAction(t, e.key);
                    },
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
  const groupingFields = (config.groupBy || []).flatMap((id) => fields.find((f) => f.id === id) || []);
  const foldScope = JSON.stringify([tableId, view?.id, config.groupBy]);
  const collapsed = folds.scope === foldScope ? folds.keys : new Set<string>();
  const gridRows = groupedRows(records, groupingFields, result?.groups || [], collapsed);
  const pasteRows = gridRows.filter((r) => !r.group);
  const startPaste = (text = '', target = anchor) => {
    if (!detail || inlineDirty || editing || loading) return;
    const start = target ? pasteRows.findIndex((r) => r.id === target.rowId) : 0;
    const column = target ? visibleFields.findIndex((f) => f.id === target.fieldId) : 0;
    if (start < 0 || column < 0) {
      message.info('请重新选择起始单元格。');
      return;
    }
    setPaste({
      text,
      snapshot: {
        tableId,
        schemaVersion: detail.table.schemaVersion,
        rows: pasteRows.slice(start),
        fields: visibleFields.slice(column),
        directory,
        allowAppend:
          detail.table.source === 'CUSTOM' && page * 50 >= (result?.total || 0) && collapsed.size === 0,
      },
    });
  };
  return (
    <div className="collab-workspace">
      <header className="workspace-top">
        <Space wrap>
          {!unifiedShell && (
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
              OA
            </Button>
          )}
          <AppstoreOutlined />
          <button
            className="workspace-home"
            onClick={() =>
              go(
                Object.fromEntries(
                  new URLSearchParams(
                    params.get('driveReturn') || (base?.workspaceId ? 'workspace=' + base.workspaceId : ''),
                  ),
                ),
              )
            }
          >
            {businessMode ? '选择业务工作表' : '承业 · 承业空间'}
          </button>
          {base && (
            <>
              <span className="workspace-divider">/</span>
              <span>{sourceLabel(base.moduleSource,base.name)}</span>
            </>
          )}
        </Space>
        <Space>
          {businessMode && (
            <Button
              onClick={() => {
                const open = () => navigate('/workspaces?' + params.toString());
                if (configDirty || editing || inlineDirty)
                  Modal.confirm({
                    title: '有尚未保存的修改',
                    content: '切换入口将放弃当前草稿。',
                    okText: '放弃并切换',
                    cancelText: '取消',
                    onOk: open,
                  });
                else open();
              }}
            >
              在承业空间中打开
            </Button>
          )}
          {base && baseAccess && baseAccess.level >= 3 && <BaseModule base={base} onSaved={refresh} />}
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
              disabled={!detail || (!superAdmin && (!detail.access.canManageAccess || detail.access.level < 3))}
              onClick={() => openDialog({ kind: 'share' })}
            >
              分享
            </Button>
          )}
          {!unifiedShell && (
            <>
              <Button onClick={() => navigate('/notifications')}>通知</Button>
              <Button onClick={() => window.open('/smart-case', '_blank', 'noopener,noreferrer')}>知识库</Button>
            </>
          )}
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
          <section className="workspace-main">
            <div className="workspace-heading">
              <Button className="workspace-mobile-nav" onClick={() => setMobileNav(true)}>
                数据表
              </Button>
              <span>{detail?.table.name || '选择或新建数据表'}</span>
              <LifecycleTableControl detail={detail} onChanged={refresh} />
              {['INVENTORY_SUMMARY', 'OFFICE_SUMMARY'].includes(detail?.table.inventoryKind || '') && <Tag>按物品自动汇总 · 只读</Tag>}
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
                  {detail.access.level>=3&&detail.access.canManageAccess&&<MoveTable tableId={tableId} disabled={configDirty||inlineDirty||!!editing}/>}
                  <BulkTransfer detail={detail} config={config} viewId={view?.id} onImported={refresh} superAdmin={!!useAuthStore.getState().authorization?.isSystemSuperAdmin}/>
                  <Button
                    type="primary"
                    icon={<PlusOutlined aria-hidden="true" />}
                    disabled={
                      detail.access.level < 2 || detail.access.add === false ||
                      (detail.table.source !== 'CUSTOM' && !detail.canCreateBusiness && !canCreateDomain && !(creation && detail.businessPermissions?.includes(creation.permission)))
                    }
                    onClick={() => {
                      if (creation) {
                        if (configDirty || editing || inlineDirty)
                          Modal.confirm({
                            title: '有尚未保存的修改',
                            content: '前往新建页面将放弃当前未保存的修改。',
                            okText: '放弃并前往',
                            cancelText: '取消',
                            onOk: () =>
                              navigate(
                                creation.path +
                                  '?' +
                                  new URLSearchParams({
                                    ...Object.fromEntries(params),
                                    workspace: detail.access.workspaceId,
                                  }),
                              ),
                          });
                        else
                          navigate(
                            creation.path +
                              '?' +
                              new URLSearchParams({
                                ...Object.fromEntries(params),
                                workspace: detail.access.workspaceId,
                              }),
                          );
                      } else if (['LEADS', 'FOLLOWS'].includes(detail.table.source)) setCreatingLead(true);
                      else void openRecord();
                    }}
                  >
                    {['INVENTORY_REGISTER', 'OFFICE_REGISTER'].includes(detail.table.inventoryKind || '') ? '新增领用登记' : creation?.label || (detail.table.source === 'LEADS' ? '新建线索' : detail.table.source === 'FOLLOWS' ? '新增跟进' : '添加记录')}
                  </Button>
                  <Button
                    disabled={
                      detail.access.level < 2 || inlineDirty || !!editing || loading || !visibleFields.length
                    }
                    onClick={() => startPaste()}
                  >
                    批量粘贴
                  </Button>
                  {detail.table.source !== 'CUSTOM' && (
                    <Button
                      disabled={busy || configDirty || inlineDirty || !!editing}
                      onClick={async () => {
                        const key = detail.table.source === 'LEADS' ? 'assignedTo' : detail.table.source === 'SOP_TASKS' ? 'assigneeUserId' : 'createdBy';
                        const field = fields.find((f) => f.options.businessKey === key);
                        if (!field) {
                          message.info('当前未授权个人筛选字段');
                          return;
                        }
                        try {
                          setBusy(true);
                          const created = await post<{ id: string }>('/tables/' + tableId + '/views', {
                            name: isBusinessSource(detail.table.source)
                              ? businessSources[detail.table.source].personal
                              : '我的记录',
                            type: 'GRID',
                            shared: false,
                            config: {
                              ...config,
                              filter: { fieldId: field.id, operator: 'eq', value: '$currentUser' },
                            },
                          });
                          go({ base: baseId, table: tableId, view: created.id });
                          refresh();
                        } catch (e) {
                          message.error(errorMessage(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      创建个人视图
                    </Button>
                  )}
                  {detail.access.level >= 2 && <RecordOperations key={tableId} tableId={tableId} schemaVersion={detail.table.schemaVersion} selected={records.filter(r => selectedRecords.includes(r.id))} canDelete={Boolean(detail.canDeleteRecords)} disabled={inlineDirty || busy} revision={revision} onChanged={refresh} />}
                  {canStartWorkflow && detail.access.automate !== false && <Button disabled={inlineDirty || busy} onClick={() => navigate('/approvals?table=' + tableId + (selectedRecords.length === 1 ? '&record=' + selectedRecords[0] : ''))}>发起审批</Button>}
                  <Button onClick={() => setSettings('fields')}>字段配置</Button>
                  <Button onClick={() => setSettings('view')}>视图配置</Button>
                  <Button icon={<FilterOutlined />} onClick={() => setSettings('filter')}>
                    筛选{config.filter ? ' · 已设置' : ''}
                  </Button>
                  <Button onClick={() => setSettings('view')}>分组</Button>
                  <Button onClick={() => setSettings('view')}>排序</Button>
                  <Select
                    aria-label="行高"
                    disabled={!appearanceReady}
                    value={appearance.rowHeight}
                    options={[
                      { value: 'compact', label: '紧凑' },
                      { value: 'standard', label: '标准' },
                      { value: 'comfortable', label: '宽松' },
                    ]}
                    onChange={(rowHeight) => { void saveAppearance({ ...appearance, rowHeight }).catch(e => message.error(errorMessage(e))); }}
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
                <Spin spinning={loading} classNames={{ root: 'workspace-table-region', container: 'workspace-table-content' }}>
                  <div
                    className="workspace-grid"
                    ref={gridRef}
                    onCopy={e=>{if(detail.access.copy===false)e.preventDefault()}}
                    onFocusCapture={(e) => {
                      const cell = (e.target as HTMLElement).closest<HTMLElement>('.workspace-cell');
                      if (cell?.dataset.recordId && cell.dataset.fieldId)
                        setAnchor({ rowId: cell.dataset.recordId, fieldId: cell.dataset.fieldId });
                    }}
                    onPaste={(e) => {
                      const cell = (e.target as HTMLElement).closest<HTMLElement>('.workspace-cell');
                      if (!cell?.dataset.recordId || !cell.dataset.fieldId) return;
                      e.preventDefault();
                      startPaste(e.clipboardData.getData('text/plain'), {
                        rowId: cell.dataset.recordId,
                        fieldId: cell.dataset.fieldId,
                      });
                    }}
                  >
                    {
                      <Table<GridRow>
                        size="small"
                        virtual
                        scroll={{
                          x: Math.max(
                            700,
                            visibleFields.reduce((n, f) => n + (config.widths?.[f.id] || 180), 220),
                          ),
                          y: bodyHeight,
                        }}
                        rowKey="id"
                        rowSelection={detail.canDeleteRecords ? { selectedRowKeys: selectedRecords, onChange: keys => setRecordSelection({ scope: selectionScope, ids: keys.map(String) }), getCheckboxProps: (row: GridRow) => ({ disabled: Boolean(row.group) || inlineDirty }) } : undefined}
                        dataSource={gridRows}
                        pagination={false}
                        locale={{ emptyText: '没有符合条件的记录，可新增记录或调整筛选。' }}
                        columns={[
                          {
                            title: '#',
                            key: 'row',
                            width: 64,
                            fixed: 'left',
                            onCell: (row) => (row.group ? { colSpan: visibleFields.length + 3 } : {}),
                            render: (_, row) =>
                              row.group ? (
                                <button
                                  className="workspace-group"
                                  disabled={inlineDirty}
                                  aria-expanded={!collapsed.has(row.group.key)}
                                  onClick={() => {
                                    const keys = new Set(collapsed);
                                    if (keys.has(row.group!.key)) keys.delete(row.group!.key);
                                    else keys.add(row.group!.key);
                                    setFolds({ scope: foldScope, keys });
                                  }}
                                >
                                  {collapsed.has(row.group.key) ? '▸' : '▾'}{' '}
                                  {groupingFields
                                    .map(
                                      (f, i) =>
                                        f.name +
                                        '：' +
                                        (displayValue(f, row.group!.keys[i], directory) || '空'),
                                    )
                                    .join(' / ')}
                                  {' · 本页 ' +
                                    row.group.loaded +
                                    ' 条' +
                                    (row.group.count === undefined ? '' : ' / 共 ' + row.group.count + ' 条')}
                                </button>
                              ) : (
                                <Button
                                  type="text"
                                  aria-label={
                                    '展开第' + (records.findIndex((r) => r.id === row.id) + 1) + '条记录'
                                  }
                                  onClick={() => {
                                    void openRecord(row);
                                  }}
                                >
                                  {(page - 1) * 50 + records.findIndex((r) => r.id === row.id) + 1}
                                </Button>
                              ),
                          },
                          ...visibleFields.map((f, index) => ({
                            title: (
                              <button
                                className="workspace-field-heading"
                                title={fieldHint(f)}
                                onClick={() =>
                                  canManage && setSettings('fields')
                                }
                              >
                                {fieldLabel(f)}
                                {f.required && f.writable ? ' *' : ''}
                              </button>
                            ),
                            key: f.id,
                            width: config.widths?.[f.id] || 180,
                            fixed: index < (config.frozen || 0) ? ('left' as const) : undefined,
                            onCell: (row: GridRow) => (row.group ? { colSpan: 0 } : {}),
                            render: (_: unknown, row: GridRow) =>
                              row.group ? null : (
                                <GridCell
                                  row={row}
                                  canBegin={!inlineDirty}
                                  field={f}
                                  businessSource={detail.table.source}
                                  onBusinessAction={() => { if (isBusinessSource(detail.table.source) && detail.table.source !== 'FOLLOWS') navigate(businessSources[detail.table.source].path + '/' + row.id); else void openRecord(row); }}
                                  directory={directory}
                                  tableId={tableId}
                                  schemaVersion={detail.table.schemaVersion}
                                  height={appearanceRowHeight(appearance)}
                                  onDirty={(dirty) => {
                                    inlineDirtyRef.current = dirty;
                                    setInlineDirty(dirty);
                                    if (!dirty) refresh();
                                  }}
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
                            key: 'record-actions',
                            title: '操作',
                            width: detail.table.lifecycleKind === 'AFTER_SALES' ? 570 : detail.table.source === 'CASES' ? 440 : 350,
                            fixed: 'right' as const,
                            onCell: (row) => (row.group ? { colSpan: 0 } : {}),
                            render: (_: unknown, row: GridRow) => row.group ? null : <Space>
                              <Button size="small" disabled={inlineDirty} onClick={() => void openRecord(row)}>{row.writable !== false && fields.some(f => f.writable) ? '编辑' : '详情'}</Button>
                              {detail.table.source === 'CASES' && <CaseRegistration tableId={tableId} caseId={row.id} disabled={inlineDirty} onChanged={refresh} />}
                              <Button size="small" onClick={() => setCommentRow(row.id)}>评论</Button>
                              <Button size="small" disabled={inlineDirty} onClick={() => navigate('/calendar?' + new URLSearchParams({table:tableId,record:row.id}))}>安排日程</Button>
                              {detail.table.lifecycleKind === 'AFTER_SALES' && <AfterSalesStatusAction fields={fields} row={row} disabled={inlineDirty} onEdit={field => void openRecord(row, field)} />}
                              {row.lifecycle && <Button size="small" onClick={()=>navigate('/cases/'+row.lifecycle!.caseId)}>关联案件</Button>}
                              {canRequestRefund && detail.table.lifecycleKind === 'CASE_REFUNDS' && row.lifecycle?.contractId && <Button size="small" onClick={()=>navigate('/refunds?'+new URLSearchParams({contract:row.lifecycle!.contractId!,case:row.lifecycle!.caseId,caseNo:row.lifecycle!.caseNo,workspace:detail.access.workspaceId}))}>查看财务退款</Button>}
                              {isBusinessSource(detail.table.source) && detail.table.source !== 'FOLLOWS' && <Button size="small" disabled={inlineDirty} onClick={() => { if (isBusinessSource(detail.table.source)) navigate(businessSources[detail.table.source].path + '/' + row.id); }}>办理</Button>}
                              {!detail.canDeleteRecords && <span className="workspace-muted" title="当前角色没有删除权限，或此业务流水须通过作废、冲销等业务操作处理">删除受限</span>}
                              {detail.canDeleteRecords && <Button size="small" danger disabled={inlineDirty || detail.access.level < 2} onClick={() => {
                                const key = crypto.randomUUID();
                                Modal.confirm({
                                  title: '删除这条记录？',
                                  content: '删除后移入记录回收站，可恢复或撤销。有关联业务或处于不允许删除状态的记录会被拒绝；关联材料和历史审计保留。',
                                  okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
                                  onOk: async () => {
                                    try {
                                      await patch('/tables/' + tableId + '/records/' + row.id, { archived: true, version: row.version, schemaVersion: detail.table.schemaVersion }, key);
                                      refresh();
                                    } catch (e) { message.error(errorMessage(e)); throw e; }
                                  },
                                });
                              }}>删除</Button>}
                            </Space>,
                          },
                          {
                            key: 'add-field',
                            onCell: (row) => (row.group ? { colSpan: 0 } : {}),
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
                  <Pagination
                    className="workspace-pagination"
                    disabled={inlineDirty}
                    current={page}
                    pageSize={50}
                    total={result?.total || 0}
                    onChange={setPage}
                    showSizeChanger={false}
                  />
                </Spin>
              )
            )}
            <footer className="workspace-status" role="status">
              <span>
                {result?.total ?? 0} 条可访问记录{' '}
                {result?.groups?.length
                  ? ' · ' + (result.groupsTruncated ? '超过 200' : result.groups.length) + ' 个分组'
                  : ''}
              </span>
              <span>
                {connection !== '实时同步已连接'
                  ? connection
                  : inlineDirty
                    ? '单元格编辑中，结束编辑后刷新协作变化'
                    : saveState || connection}
              </span>
            </footer>
          </section>
        </div>
      )}
      {paste && paste.snapshot.tableId === tableId && detail && (
        <PasteDialog
          snapshot={paste.snapshot}
          initialText={paste.text}
          onClose={() => setPaste(undefined)}
          onSaved={() => {
            setPaste(undefined);
            setSaveState('批量保存成功');
            refresh();
          }}
        />
      )}
      <Drawer title="数据表" open={mobileNav} onClose={() => setMobileNav(false)} placement="left">
        {tableNav}
      </Drawer>
      <Drawer title="记录评论" width={560} open={!!commentRecordId} onClose={() => {
        setCommentRow(undefined);
        if (commentsOnly) { const next = new URLSearchParams(params); next.delete('comments'); next.delete('record'); setParams(next, {replace:true}); }
      }}>
        {commentRecordId && <RowComments key={tableId+commentRecordId} tableId={tableId} recordId={commentRecordId}/>}
      </Drawer>
      {creatingLead && detail?.canCreateBusiness && detail.table.source === 'FOLLOWS' && (
        <CreateBusinessFollow key={tableId} tableId={tableId}
          allowedFields={fields.filter(f => !detail.access.readonly.includes(f.id)).map(f => String(f.options.businessKey))}
          onCancel={() => setCreatingLead(false)} onCreated={id => {
            setCreatingLead(false);
            message.success('跟进已保存');
            go({ base: baseId, table: tableId, record: id });
            refresh();
          }} />
      )}
      {creatingLead && detail?.canCreateBusiness && detail.table.source === 'LEADS' && (
        <CreateBusinessLead
          key={tableId}
          tableId={tableId}
          allowedFields={fields
            .filter((f) => !detail.access.readonly.includes(f.id))
            .map((f) => String(f.options.businessKey))}
          onCancel={() => setCreatingLead(false)}
          onCreated={(id, duplicates) => {
            setCreatingLead(false);
            message.success(
              duplicates ? '创建成功，有 ' + duplicates + ' 条可访问的疑似重复线索' : '线索已创建',
            );
            go({ base: baseId, table: tableId, record: id });
            refresh();
          }}
        />
      )}
      <Drawer
        title={settings === 'fields' ? '字段配置' : settings === 'filter' ? '筛选条件' : '视图配置'}
        open={!!settings}
        onClose={() => setSettings(null)}
        size={520}
      >
        {settings === 'fields' ? (
          <FieldManagement tableId={tableId!} version={detail?.table.schemaVersion ?? 0} canManage={canManage}
            onCreate={() => openDialog({ kind: 'field' })} onEdit={field => openDialog({ kind: 'field', field })} onChanged={refresh} />
        ) : settings === 'filter' ? (
          <FilterEditor
            fields={fields.filter((f) => f.queryable !== false)}
            value={config.filter}
            onChange={(filter) => updateConfig({ filter })}
          />
        ) : (
          <Form layout="vertical" disabled={inlineDirty}>
            <Form.Item label="显示字段与顺序">
              <Select
                mode="multiple"
                value={visibleFields.map((f) => f.id)}
                options={fields.map((f) => ({ value: f.id, label: f.name }))}
                onChange={(visibleFields) => updateConfig({ visibleFields })}
              />
            </Form.Item>
            <div className="workspace-column-order" aria-label="调整列顺序">
              {visibleFields.map((f, index) => (
                <div key={f.id} className="workspace-field-row">
                  <span>
                    {index + 1}. {f.name}
                  </span>
                  <Space>
                    {([-1, 1] as const).map((offset) => (
                      <Button
                        key={offset}
                        size="small"
                        aria-label={(offset < 0 ? '上移' : '下移') + f.name}
                        disabled={index + offset < 0 || index + offset >= visibleFields.length}
                        onClick={() => {
                          const order = visibleFields.map((field) => field.id);
                          [order[index], order[index + offset]] = [order[index + offset], order[index]];
                          updateConfig({ visibleFields: order });
                        }}
                      >
                        {offset < 0 ? '↑' : '↓'}
                      </Button>
                    ))}
                  </Space>
                </div>
              ))}
            </div>
            <Form.Item label="分组字段" htmlFor="workspace-group-fields">
              <Select
                mode="multiple"
                id="workspace-group-fields"
                maxCount={3}
                value={config.groupBy || []}
                options={fields
                  .filter((f) => f.queryable !== false)
                  .map((f) => ({ value: f.id, label: f.name }))}
                onChange={(groupBy) => updateConfig({ groupBy })}
              />
            </Form.Item>
            <Form.Item label="排序字段">
              {(config.sorts || []).map((sort, i) => (
                <Space key={i}>
                  <Select
                    style={{ width: 180 }}
                    value={sort.fieldId}
                    options={fields
                      .filter((f) => f.queryable !== false)
                      .map((f) => ({ value: f.id, label: f.name }))}
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
                disabled={!fields.some((f) => f.queryable !== false) || (config.sorts?.length || 0) >= 5}
                onClick={() =>
                  updateConfig({
                    sorts: [
                      ...(config.sorts || []),
                      { fieldId: fields.find((f) => f.queryable !== false)!.id, direction: 'asc' },
                    ],
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
        onClose={closeRecord}
        size={520}
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={busy}
            disabled={
              (detail?.access.level || 0) < 2 ||
              !fields.some((f) => f.writable) ||
              (editing?.detail?.record.writable ?? editing?.row?.writable) === false ||
              !!editing?.remote
            }
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
            {editing.row && (
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(window.location.href);
                    message.success('记录链接已复制，打开时仍需授权');
                  } catch {
                    message.info('可复制浏览器地址栏中的记录链接');
                  }
                }}
              >
                复制记录链接
              </Button>
            )}
            {detail?.table.source === 'CASES' && editing.row && <Alert type="info" title="可编辑已授权的案件登记信息。主办律师取自案件基本信息，可在“打开业务详情与办理”中调整。" />}
            {detail?.table.source === 'CONTRACTS' && editing.row && <Alert type="info" title="草稿合同可直接修改合同名称和金额。编号、类型、关联客户、已收金额和状态等业务关联字段只读；审批、签署和生效请通过业务详情办理。" />}
            {detail?.table.source === 'LEADS' && editing.row && (
              <BusinessRecord
                key={tableId + editing.row.id}
                tableId={tableId}
                recordId={editing.row.id}
                revision={revision}
                onSaved={refresh}
              />
            )}
            {detail?.table.source === 'LEADS' && editing.row && (
              <Button onClick={() => navigate('/leads/' + editing.row!.id)}>打开线索业务详情</Button>
            )}
            {detail &&
              [
                'CUSTOMERS',
                'CONTRACTS',
                'NEGOTIATIONS',
                'SOP_TASKS', 'QUALITY_REVIEWS', 'QUALITY_ISSUES', 'QUALITY_ANALYSES',
                'CASES',
                'INVENTORY_ITEMS',
                'INVENTORY_MOVEMENTS',
                'INVENTORY_STOCKTAKES',
                'PERFORMANCES',
                'CHANNELS',
                ...financialSources,
              ].includes(detail.table.source) &&
              editing.row && (
                <Button
                  onClick={() =>
                    navigate(
                      businessSources[detail.table.source as keyof typeof businessSources].path +
                        '/' +
                        editing.row!.id +
                        (params.size ? '?' + params.toString() : ''),
                    )
                  }
                >
                  打开业务详情与办理
                </Button>
              )}
            {detail?.table.source === 'FOLLOWS' &&
              editing.row &&
              fields.some((f) => f.options.businessKey === 'leadId') && (
                <Button
                  onClick={() =>
                    navigate(
                      '/leads/' +
                        String(editing.values[fields.find((f) => f.options.businessKey === 'leadId')!.id]),
                    )
                  }
                >
                  打开关联线索
                </Button>
              )}
            <Form layout="vertical">
              {(editing.field ? [editing.field] : fields).map((f) => (
                <Form.Item key={f.id} label={fieldLabel(f)} required={f.required && f.writable && editing.row?.writable !== false} extra={fieldHint(f)}>
                  <FieldInput
                    onPreview={values=>setEditing(old=>old?(f.options.medicalRelation?{...old,values:{...old.values,...values}}:{...old,preview:values}):old)}
                    displayText={editing.preview && f.options.lifecycleKey ? undefined : (editing.detail?.record ?? editing.row)?.displayValues?.[f.id]}
                    field={f}
                    value={
                      f.options.lifecycleKey && !f.writable && editing.preview ? editing.preview[f.options.lifecycleKey] :
                      f.options.businessKey && !f.writable
                        ? (editing.detail?.record.values[f.id] ?? editing.values[f.id])
                        : editing.values[f.id]
                    }
                    directory={directory}
                    tableId={tableId}
                    disabled={
                      !f.writable || (!!f.options.medicalAutofill&&!!editing.values[fields.find(f=>f.options.medicalRelation)?.id??'']) ||
                      ((!f.options.medicalAutofill||f.options.conditionalField)&&(editing.detail?.record ?? editing.row)?.readonlyFields?.includes(f.id)) ||
                      (editing.detail?.record.writable ?? editing.row?.writable) === false ||
                      busy
                    }
                    onChange={(value) =>
                      setEditing((old) => (old ? { ...old, values: { ...old.values,...(f.options.medicalRelation&&!value?Object.fromEntries(fields.filter(f=>f.options.medicalAutofill).map(f=>[f.id,null])):{}), [f.id]: value } } : old))
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
                share: '邀请成员到当前工作表',
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
        >
          {dialog && <DialogFormValues form={form} values={dialogValues(dialog)} />}
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
                  {
                    value: 'LEADS',
                    label: '现有 CRM · 线索表（负责人配置）',
                    disabled: baseAccess?.level !== 4,
                  },
                  {
                    value: 'FOLLOWS',
                    label: '现有 CRM · 跟进表（负责人配置）',
                    disabled: baseAccess?.level !== 4,
                  },
                  ...(
                    [
                      'CUSTOMERS',
                      'NEGOTIATIONS',
                      'CONTRACTS',
                      'CASES',
                      'PAYMENTS',
                      'INVOICES',
                      'REFUNDS',
                      'COSTS',
                      'INVENTORY_ITEMS',
                      'PERFORMANCES',
                      'CHANNELS',
                    ] as const
                  ).map((source) => ({
                    value: source,
                    label: '连接业务 · ' + sourceLabel(source),
                    disabled: (baseAccess?.level || 0) < 4,
                  })),
                  ...(base?.moduleSource === 'CASES' ? [
                    { value: 'CASE_ARCHIVE_REVIEW', label: '案件 · 案件归档审核（9个字段）' },
                    { value: 'CASE_ARCHIVE_REGISTER', label: '案件 · 案卷档案登记表（12个字段）' },
                    { value: 'CASE_ARCHIVE_OFFLINE', label: '案件 · 案卷档案登记表(不上传法网)（12个字段）' },
                  ] : []),
                  { value: 'AFTER_SALES', label: '案件关联 · 售后管理表' },
                  { value: 'CASE_REFUNDS', label: '售后关联 · 退费管理表' },
                  { value: 'BLANK', label: '空白数据表' },
                  { value: 'TASKS', label: '任务管理模板' },
                  { value: 'CONTACTS', label: '客户跟进模板' },
                  { value: 'LAWYER_PROSPECTS', label: '律师客资表（24个字段）' },
                  { value: 'INVENTORY_REGISTER', label: '物品 · 定制物品领用登记表（14个字段）' },
                  { value: 'INVENTORY_SUMMARY', label: '物品 · 定制物品领用统计（自动汇总）' },
                  { value: 'OFFICE_REGISTER', label: '物品 · 办公用品领用明细表（39个字段）' },
                  { value: 'OFFICE_SUMMARY', label: '物品 · 办公用品领用统计（自动汇总）' },
                  { value: 'OFFICE_INBOUND', label: '物品 · 入库明细表（9个字段）' },
                  { value: 'OFFICE_OUTBOUND', label: '物品 · 出库明细表（9个字段）' },
                  { value: 'OFFICE_STOCK', label: '物品 · 办公用品库存表（自动计算库存）' },
                  { value: 'OFFICE_STOCKTAKE', label: '物品 · 定期办公用品盘存记录（8个字段）' },
                  ...(base?.moduleSource === 'INVENTORY_STOCKTAKES' ? [{value:'HR_ROSTER',label:'人事 · 律所员工名册（25个字段）'},{value:'HR_INTERNS',label:'人事 · 实习律师名单（12个字段）'},{value:'HR_CONTACTS',label:'人事 · 重庆承业律师事务所员工名单及通讯录（6个字段）'},{value:'HR_HQ_LAWYERS',label:'人事 · 总所在册律师名单（11个字段）'},{value:'HR_BRANCH_LAWYERS',label:'人事 · 派驻分所律师明细（11个字段）'},{value:'HR_LEAVERS',label:'人事 · 离职人员名单（9个字段）'},{value:'HR_NEW_HIRES',label:'人事 · 新入职人员名单（56个字段）'},{value:'HR_RECRUITMENT',label:'人事 · 招聘面试（10个字段）'}] : []),
                  ...(base?.moduleSource === 'INVENTORY_MOVEMENTS' ? [{ value: 'ADMIN_EXPENSES', label: '行政 · 行政费用支出表（12个字段）' }] : []),
                  ...(base?.moduleSource === 'INVENTORY_MOVEMENTS' ? [
                    {value:'ADMIN_SEAL',label:'行政 · 用印登记（6个字段）'},
                    {value:'ADMIN_SENT',label:'行政 · 发文登记（15个字段）'},
                    {value:'ADMIN_RECEIVED',label:'行政 · 收文登记（17个字段）'},
                    {value:'ADMIN_MEETINGS',label:'行政 · 会议登记（15个字段）'},
                  ] : []),
                  { value: 'MEDICAL_ASSESSMENT', label: '跟进 · 病例评估表（21个字段）' },
                  { value: 'SIGNING_CONVERSION', label: '跟进 · 签约转化表（36个字段）' },
                ]}
              />
            </Form.Item>
          )}
          {dialog?.kind === 'field' && (
            <>
              <Form.Item name="type" label="字段类型" rules={[{ required: true }]}>
                <Select
                  disabled={!!assignmentField}
                  options={assignmentField ? [{value:form.getFieldValue("type"),label:"人员（组织员工）"}] : Object.entries(fieldNames)
                    .filter(([type]) => type !== 'FORMULA')
                    .filter(
                      ([type]) =>
                        detail?.table.source === 'CUSTOM' ||
                        !['AUTONUMBER', 'CREATED_BY', 'UPDATED_BY', 'CREATED_AT', 'UPDATED_AT'].includes(type),
                    )
                    .map(([value, label]) => ({ value, label }))}
                />
              </Form.Item>
              {assignmentField && <>
                <Alert type="info" showIcon title="跟进人关联组织员工" description="在每条客资的跟进人单元格中选择具体员工。分配组织的负责人可向本部门、下属部门及同一律所体系的其他分所员工分配，并查看汇总；普通成员只查看自己的记录。成员仍需具备本表访问权限。默认跟进人仅用于新建记录，不会批量修改已有客资。" />
                <Form.Item name="assignmentOrganizationId" label="跟进人所属组织" rules={[{required:true}]}>
                  <Select showSearch optionFilterProp="label" onChange={()=>form.setFieldValue('defaultValue',null)} options={directory.assignmentOrganizations?.map(o=>({value:o.id,label:o.label ?? o.name}))} />
                </Form.Item>
              </>}
              <Form.Item name="required" valuePropName="checked">
                <Checkbox>
                  {detail?.table.source === 'CUSTOM' ? '必填' : '必填（保存扩展信息时校验）'}
                </Checkbox>
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {() =>
                  !assignmentField && ['SINGLE_SELECT', 'MULTI_SELECT'].includes(form.getFieldValue('type')) ? (
                    <Form.Item name="choices" label="选项（每行一个，可留空后续配置）">
                      <Input.TextArea rows={4} />
                    </Form.Item>
                  ) : form.getFieldValue('type') === 'RELATION' && dialog.field?.options.targetSource ? (
                    <Form.Item label="关联业务"><Input disabled value={dialog.field.options.targetSource === 'LEADS' ? '线索表' : '渠道表'} /></Form.Item>
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
                    <Form.Item name="defaultValue" label="默认值">
                      <FieldInput
                        field={{
                          id: dialog.field?.id || 'default',
                          name: '默认值',
                          type: assignmentField ? 'USER' : form.getFieldValue('type'),
                          required: false,
                          writable: true,
                          position: 0,
                          archived: false,
                          defaultValue: null,
                          options: {
                            prospectAssignee: !!assignmentField,
                            choices: assignmentField ? directory.assignmentOrganizations?.find(o=>o.id===form.getFieldValue('assignmentOrganizationId'))?.employees ?? [] : String(form.getFieldValue('choices') || '')
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
          {dialog?.kind === 'share' && <>
            <Form.Item name="principalId" label="邀请成员" rules={[{required:true}]}>
              <Select showSearch optionFilterProp="label" onChange={id=>form.setFieldValue('role',invite?.invitations[id] || 'READER')} options={(invite?.users ?? directory.users).map(u=>({value:u.id,label:u.name}))}/>
            </Form.Item>
            <Form.Item name="role" label="工作表角色" rules={[{required:true}]}>
              <Select options={[{value:'READER',label:'阅读者'},{value:'EDITOR',label:'编辑者'},{value:'MANAGER',label:'管理员'},
                ...(invite?.roles || []).map(r=>({value:r.id,label:r.name})),{value:'REMOVE',label:'撤销本表邀请'}]}/>
            </Form.Item>
          </>}
        </Form>
      </Modal>
    </div>
  );
}
