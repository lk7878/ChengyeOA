import { isTransientRequestError } from '@/api/transient-error';
import StorageManager from './StorageManager';
import PersonalFiles from './PersonalFiles';
import Modal from '@/components/DraggableModal';
import { moduleOptions, isBusinessSource } from '../crm/business-sources';
import { useUnifiedShell } from '../navigation/shell-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Breadcrumb, Button, Dropdown, Empty, Input, Pagination, Select, Space, Spin, Tree } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import type { DataNode } from 'antd/es/tree';
import {
  AppstoreOutlined,
  FolderOutlined,
  LinkOutlined,
  MenuOutlined,
  PlusOutlined,
  TableOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { errorMessage, errorStatus, get, patch, post } from '../workspaces/api';
import { ResourceAccess } from '../workspaces/ResourceAccess';
import type { Directory, Workspace } from '../workspaces/types';
import WorkspaceMembers from './WorkspaceMembers';
import DriveLifecycle, { type LifecycleAction } from './DriveLifecycle';
import ShortcutDialog from './ShortcutDialog';
import './drive.css';

interface Location {
  id: string;
  name: string;
  kind: string;
  level: number;
  selfOnly: boolean;
}
interface DriveItem {
  id: string;
  kind: 'BASE' | 'FOLDER' | 'SHORTCUT';
  targetId?: string;
  targetKind?: string;
  canRemove?: boolean;
  visitedAt?: string;
  name: string;
  workspaceId: string;
  workspaceName?: string;
  parentId: string | null;
  baseId: string | null;
  ownerId: string;
  ownerName: string;
  createdAt: string | null;
  updatedAt: string;
  version: number;
  path: Location[];
  deletedAt: string | null;
  canMove: boolean;
  canTrash: boolean;
  canRestore: boolean;
  canRename: boolean;
  canShare: boolean;
  access: {
    level: number;
    selfOnly: boolean;
    canCreate: boolean;
    hiddenFieldCount: number;
    readonlyFieldCount: number;
  };
  sources?: Location[];
}
interface Listing {
  items: DriveItem[];
  total: number;
  page: number;
  pageSize: number;
  path: Location[];
  workspace: { id: string; name: string };
  canCreateFolder: boolean;
  canCreateBase: boolean;
  canManageAccess: boolean;
  workspaceLevel: number;
}
const emptyDirectory: Directory = { organizations: [], employees: [], users: [], teams: [] };
const roleName = (level: number) => ['', '阅读', '编辑', '管理', '工作区负责人'][level] || '无权限';
const dateLabel = (date: string | null) =>
  date ? new Date(date).toLocaleString('zh-CN', { hour12: false }) : '原系统未记录';

export default function CloudDrivePage() {
  const unifiedShell = useUnifiedShell();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [canCreateWorkspace, setCanCreateWorkspace] = useState(false);
  const workspaceId = params.get('workspace') || workspaces[0]?.id || '';
  const allWorkspaces = workspaceId === '__all__';
  const [chooseWorkspace, setChooseWorkspace] = useState(false);
  const [destination, setDestination] = useState<string>();
  const parentId = params.get('folder') || '';
  const scope = params.get('scope') || 'all';
  const search = params.get('q') || '';
  const currentWorkspace = workspaces.find(w => w.id === workspaceId);
  const tableOnly = currentWorkspace?.tableLinks !== undefined;
  const personalScope = !parentId && ['mine', 'shared'].includes(scope);
  const linkedTables = scope === 'all' && !parentId
    ? (allWorkspaces ? workspaces : currentWorkspace ? [currentWorkspace] : []).flatMap(w =>
        (w.tableLinks ?? []).filter(t => (t.baseName + ' ' + t.name).toLocaleLowerCase().includes(search.toLocaleLowerCase())))
    : [];
  const sort =
    scope === 'recent'
      ? params.get('sort') === 'name'
        ? 'name'
        : 'visitedAt'
      : params.get('sort') === 'name'
        ? 'name'
        : 'updatedAt';
  const layout = params.get('layout') === 'cards' ? 'cards' : 'list';
  const page = Number(params.get('page') || 1);
  const directoryKey = JSON.stringify([workspaceId, tableOnly, parentId, scope, search, sort, page]);
  const [snapshot, setListing] = useState<{ key: string; value: Listing }>();
  const listing = !tableOnly && snapshot?.key === directoryKey ? snapshot.value : undefined;
  const [loadedFolders, setFolders] = useState<DriveItem[]>([]);
  const folders = listing ? loadedFolders : [];
  const [folderUserId, setFolderUserId] = useState('');
  const [directory, setDirectory] = useState<Directory>(emptyDirectory);
  const [directoryDenied, setDirectoryDenied] = useState(false);
  const [workspacesDenied, setWorkspacesDenied] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [dialog, setDialog] = useState<{
    kind: 'folder' | 'base' | 'workspace' | 'rename';
    item?: DriveItem;
  }>();
  const [name, setName] = useState('');
  const [moduleSource, setModuleSource] = useState<string>();
  const [organizationId, setOrganizationId] = useState<string>();
  const [workspaceOrganizations, setWorkspaceOrganizations] = useState<Directory['organizations']>([]);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [selected, setSelected] = useState<DriveItem>();
  const [shortcutDialog, setShortcutDialog] = useState<{ target?: DriveItem }>();
  const [personalAction, setPersonalAction] = useState<{ kind: 'remove' | 'clear'; id?: string }>();
  const [personalError, setPersonalError] = useState('');
  const [personalSaving, setPersonalSaving] = useState(false);
  const personalKey = useRef(crypto.randomUUID());
  const visitedFolder = useRef('');
  const [lifecycle, setLifecycle] = useState<{ item: DriveItem; action: LifecycleAction }>();
  const lifecycleRef = useRef(lifecycle);
  useEffect(() => {
    lifecycleRef.current = lifecycle;
  }, [lifecycle]);
  const [accessError, setAccessError] = useState('');
  const key = useRef(crypto.randomUUID());
  const selectedRef = useRef<DriveItem | undefined>(undefined);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  const change = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    next.set('workspace', workspaceId);
    next.delete('page');
    for (const [k, v] of Object.entries(values)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next);
    setMobile(false);
  };
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = () => {
      const current = ++request;
      return get<{ workspaces: Workspace[]; canCreate: boolean }>('/workspaces?driveLinks=1')
      .then((r) => {
        if (active && current === request) {
          setWorkspaceError('');
          setWorkspacesDenied(false);
          setWorkspaces(r.workspaces);
          setCanCreateWorkspace(r.canCreate);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active && current === request) {
          if (!isTransientRequestError(e)) {
            setWorkspaces([]);
            setCanCreateWorkspace(false);
            setWorkspacesDenied([401, 403].includes(errorStatus(e) ?? 0));
          }
          setWorkspaceError(errorStatus(e) === 403 ? '' : errorMessage(e));
          setLoading(false);
        }
      });
    };
    void load();
    window.addEventListener('focus', load);
    window.addEventListener('online', load);
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
      window.removeEventListener('online', load);
      clearInterval(timer);
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    void get<Directory>('/collaboration/options' + (workspaceId && !allWorkspaces ? '?workspaceId=' + workspaceId : ''))
      .then((r) => {
        if (active) setDirectory(r);
      })
      .catch(() => {
        if (active) setDirectory(emptyDirectory);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, allWorkspaces, revision]);
  const lastDirectory = useRef('');
  const hasDirectory = useRef(false);
  useEffect(() => {
    if (lastDirectory.current !== directoryKey || workspacesDenied) {
      lastDirectory.current = directoryKey;
      hasDirectory.current = false;
      setDirectoryDenied(false);
      setAccessError('');
      setError('');
      setListing(undefined);
      setFolders([]);
      setSelected(undefined);
      setLifecycle(undefined);
      setShortcutDialog(undefined);
      setPersonalAction(undefined);
      setDialog(undefined);
      if (!parentId) visitedFolder.current = '';
    }
    if (!workspaceId || scope === 'storage' || tableOnly || workspacesDenied) return;
    let active = true, inflight = false;
    if (!hasDirectory.current) setLoading(true);
    const poll = async () => {
      if (inflight || !active) return;
      inflight = true;
      const query = new URLSearchParams({ scope, q: search, sort, page: String(page) });
      if (parentId) query.set('parentId', parentId);
      try {
        const [listingResult, folderResult] = await Promise.allSettled([
          get<Listing>('/workspaces/' + workspaceId + '/drive?' + query),
          get<{ folders: DriveItem[]; userId: string }>('/workspaces/' + workspaceId + '/drive/folders'),
        ]);
        if (!active) return;
        setDirectoryDenied(false);
        // A transport failure on one request must not mask a denial on the other.
        for (const result of [listingResult, folderResult]) {
          if (result.status === 'rejected' && !isTransientRequestError(result.reason)) throw result.reason;
        }
        if (listingResult.status === 'rejected') throw listingResult.reason;
        if (folderResult.status === 'rejected') throw folderResult.reason;
        const list = listingResult.value, tree = folderResult.value;
        hasDirectory.current = true;
        setListing({ key: directoryKey, value: list });
        setFolders(tree.folders);
        setFolderUserId(tree.userId);
        setError('');
        if (parentId && visitedFolder.current !== workspaceId + ':' + parentId) {
          visitedFolder.current = workspaceId + ':' + parentId;
          void post('/drive/nodes/' + parentId + '/visit', {}).catch(() => undefined);
        }
      } catch (e) {
        if (!active) return;
        if (isTransientRequestError(e)) {
          setError(hasDirectory.current ? '目录刷新暂时失败，已保留上次加载的内容。' : errorMessage(e));
          return;
        }
        hasDirectory.current = false;
        setDirectoryDenied(errorStatus(e) === 403);
        setError(errorStatus(e) === 403 ? '' : errorMessage(e));
        setListing(undefined);
        setFolders([]);
        setSelected(undefined);
        setLifecycle(undefined);
        setShortcutDialog(undefined);
        if ([401, 403, 404, 410].includes(errorStatus(e) || 0)) {
          setDialog(undefined);
          if (parentId) {
            setAccessError('原目录已不可访问，已返回工作区。');
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.delete('folder');
                next.delete('page');
                next.delete('q');
                next.set('scope', 'all');
                return next;
              },
              { replace: true },
            );
          }
        }
      } finally {
        inflight = false;
        if (active) setLoading(false);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), allWorkspaces ? 30000 : 15000);
    const focus = () => void poll();
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', focus);
    };
  }, [directoryKey, workspacesDenied, workspaceId, allWorkspaces, tableOnly, parentId, scope, search, sort, page, revision, setParams]);
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId && !lifecycle) return;
    let active = true, inflight = false;
    const verify = async () => {
      if (inflight || !active) return;
      inflight = true;
      try {
        const operation = lifecycleRef.current;
        if (operation && operation.action !== 'PURGE') {
          let allowed = false;
          try {
            const node = await get<DriveItem>('/drive/nodes/' + operation.item.id);
            allowed = node.canMove;
          } catch (e) {
            if (isTransientRequestError(e)) return;
            if (errorStatus(e) === 403) {
              try {
                const trash = await get<Listing>(
                  '/workspaces/' +
                    workspaceId +
                    '/drive?scope=trash&q=' +
                    encodeURIComponent(operation.item.name),
                );
                allowed = trash.items.some((item) => item.id === operation.item.id && item.canRestore);
              } catch (trashError) {
                if (isTransientRequestError(trashError)) return;
              }
            }
          }
          if (active && lifecycleRef.current === operation && !allowed) setLifecycle(undefined);
        }
        const current = selectedRef.current;
        if (current) {
          try {
            const fresh = await get<DriveItem>('/drive/nodes/' + current.id);
            if (active && selectedRef.current?.id === current.id) setSelected(fresh);
          } catch (e) {
            if (!isTransientRequestError(e) && active && selectedRef.current?.id === current.id) {
              setSelected(undefined);
              setAccessError(errorMessage(e));
              refresh();
            }
          }
        }
      } finally {
        inflight = false;
      }
    };
    const timer = window.setInterval(verify, 2000);
    window.addEventListener('focus', verify);
    window.addEventListener('online', verify);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', verify);
      window.removeEventListener('online', verify);
    };
  }, [selectedId, lifecycle, workspaceId, refresh]);
  const openDialog = (kind: 'folder' | 'base' | 'workspace' | 'rename', item?: DriveItem) => {
    setName(item?.name || '');
    const source = params.get('module') || '';
    setModuleSource(isBusinessSource(source) ? source : undefined);
    setDialogError('');
    setOrganizationId(undefined);
    key.current = crypto.randomUUID();
    setDialog({ kind, item });
    if (kind === 'workspace') {
      setWorkspaceOrganizations([]);
      void get<Directory>('/collaboration/options')
        .then((value) => setWorkspaceOrganizations(value.organizations))
        .catch((e) => setDialogError(errorMessage(e)));
    }
  };
  const openItem = async (entry: DriveItem) => {
    let item = entry;
    if (entry.kind === 'SHORTCUT') {
      try {
        item = (await get<{ target: DriveItem }>('/drive/shortcuts/' + entry.id)).target;
      } catch (e) {
        setError(errorMessage(e));
        refresh();
        return;
      }
    }
    if (item.deletedAt) {
      setLifecycle({ item, action: 'RESTORE' });
      return;
    }
    if (item.kind === 'FOLDER') {
      change({ workspace: item.workspaceId, folder: item.id, scope: 'all', q: '' });
      return;
    }
    try {
      const data = await get<{ tables: { id: string }[] }>('/bases/' + item.id + '/tables');
      const returning = new URLSearchParams(params);
      returning.set('workspace', workspaceId);
      const next = new URLSearchParams({ base: item.id, driveReturn: returning.toString() });
      if (data.tables[0]) next.set('table', data.tables[0].id);
      setParams(next);
    } catch (e) {
      setError(errorMessage(e));
      refresh();
    }
  };
  const openPersonal = (kind: 'remove' | 'clear', id?: string) => {
    personalKey.current = crypto.randomUUID();
    setPersonalError('');
    setPersonalAction({ kind, id });
  };
  const submitPersonal = async () => {
    if (!personalAction) return;
    setPersonalSaving(true);
    setPersonalError('');
    try {
      await post(
        '/workspaces/' +
          workspaceId +
          '/drive/' +
          (personalAction.kind === 'clear' ? 'recent/clear' : 'shortcuts/' + personalAction.id + '/remove'),
        {},
        personalKey.current,
      );
      setPersonalAction(undefined);
      refresh();
    } catch (e) {
      setPersonalError(errorMessage(e));
    } finally {
      setPersonalSaving(false);
    }
  };
  const showAccess = async (item: DriveItem) => {
    setAccessError('');
    try {
      setSelected(await get<DriveItem>('/drive/nodes/' + item.id));
    } catch (e) {
      setAccessError(errorMessage(e));
    }
  };
  const submit = async () => {
    if (!dialog || !name.trim() || (dialog.kind === 'workspace' && !organizationId)) {
      setDialogError('请填写名称并选择必要信息。');
      return;
    }
    setSaving(true);
    setDialogError('');
    try {
      if (dialog.kind === 'workspace') {
        const created = await post<{ id: string }>(
          '/workspaces',
          { name: name.trim(), organizationId },
          key.current,
        );
        setParams({ workspace: created.id });
      } else if (dialog.kind === 'rename' && dialog.item) {
        await patch(
          '/drive/nodes/' + dialog.item.id,
          { name: name.trim(), version: dialog.item.version },
          key.current,
        );
      } else {
        const created = await post<{ id: string; tableId?: string; viewId?: string }>(
          '/workspaces/' + workspaceId + '/drive/' + (dialog.kind === 'folder' ? 'folders' : 'bases'),
          { name: name.trim(), parentId: parentId || null, ...(dialog.kind === 'base' ? { moduleSource: moduleSource || null } : {}) },
          key.current,
        );
        if (dialog.kind === 'base') {
          const returning = new URLSearchParams(params);
          returning.set('workspace', workspaceId);
          setParams({
            base: created.id,
            table: created.tableId!,
            view: created.viewId!,
            driveReturn: returning.toString(),
          });
        }
      }
      setDialog(undefined);
      refresh();
    } catch (e) {
      setDialogError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const tree = (parent: string | null, nodes: DriveItem[]): DataNode[] =>
    nodes
      .filter((f) => f.parentId === parent)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      .map((f) => ({ key: f.id, title: f.name, icon: <FolderOutlined />, children: tree(f.id, nodes) }));
  const emptyActions = (
    <Space>
      <Button onClick={() => change({scope: 'mine', folder: '', q: ''})}>进入我的资源</Button>
      <Button onClick={() => setMobile(true)}>切换工作区</Button>
    </Space>
  );
  const navigation = (
    <>
      {scope !== 'storage' && <><Select
        aria-label="工作区"
        value={workspaceId || undefined}
        placeholder="选择工作区"
        options={[{value:'__all__',label:'全部工作区'}, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]}
        onChange={(id) => setParams({ workspace: id })}
      />
      <Input.Search
        key={workspaceId + parentId + scope + search}
        aria-label="搜索资源"
        placeholder={allWorkspaces ? '搜索全部工作区可访问的资源' : '搜索此工作区可访问的资源'}
        defaultValue={search}
        allowClear
        onSearch={(q) => change({ q })}
      />
      </>}
      <div className="drive-nav-title">资源目录</div>
      {[
        ['all', allWorkspaces ? '跨工作区可访问资源' : '当前工作区资源'],
        ['mine', '我的资源'],
        ['shared', '与我共享'],
        ['shortcuts', '快捷方式'],
        ['recent', '最近访问'],
        ['storage', '存储管理'],
        ...(listing?.canManageAccess && !allWorkspaces && scope !== 'storage' ? [['trash', '回收站']] : []),
      ].map(([value, label]) => (
        <Button
          key={value}
          type={scope === value && !parentId ? 'primary' : 'text'}
          block
          onClick={() => change({ workspace: !workspaces.some(w=>w.id===workspaceId) ? '__all__' : workspaceId, scope: value, folder: '', q: '' })}
        >
          {label}
        </Button>
      ))}
      {scope !== 'storage' && ['mine', 'shared'].map((group) => {
        const ids = new Set(
          folders
            .filter((f) => (f.ownerId === folderUserId) === (group === 'mine'))
            .flatMap((f) => f.path.map((p) => p.id)),
        );
        const nodes = folders.filter((f) => ids.has(f.id));
        return (
          <section key={group}>
            <div className="drive-nav-title">{group === 'mine' ? '我的文件夹' : '共享文件夹'}</div>
            <Tree
              showIcon
              blockNode
              selectedKeys={parentId ? [parentId] : []}
              treeData={tree(null, nodes)}
              onSelect={(ids) => {
                if (ids[0]) change({ folder: String(ids[0]), scope: 'all', q: '' });
              }}
            />
          </section>
        );
      })}
    </>
  );
  return (
    <div className="cloud-drive">
      <header className="drive-header">
        <Space>
          {!unifiedShell && <Button onClick={() => navigate('/')}>OA</Button>}
          <h1>承业空间</h1>
        </Space>
        <Space wrap>
          {canCreateWorkspace && <Button onClick={() => openDialog('workspace')}>创建工作区</Button>}
          {scope !== 'storage' && !allWorkspaces && listing?.canManageAccess && (
            <WorkspaceMembers
              key={workspaceId}
              workspaceId={workspaceId}
              directory={directory}
              level={listing.workspaceLevel}
              onSaved={refresh}
            />
          )}
        </Space>
      </header>
      <div className="drive-body">
        <aside className="drive-sidebar">{navigation}</aside>
        <main className="drive-main">
          {scope === 'storage' ? <StorageManager onWorkspaceChange={id => change({workspace:id,scope:'storage'})} workspace={workspaceId || '__all__'} onMine={()=>change({workspace:'__all__',scope:'mine',folder:'',q:''})}/> : <>
          <div className="drive-toolbar">
            <Space wrap>
              <Button
                aria-label="目录"
                className="drive-mobile-nav"
                icon={<MenuOutlined />}
                onClick={() => setMobile(true)}
              >
                目录
              </Button>
              <Breadcrumb
                items={[
                  {
                    title: (
                      <button onClick={() => change({ folder: '', scope: 'all', q: '' })}>
                        {listing?.workspace.name || currentWorkspace?.name || '工作区'}
                      </button>
                    ),
                  },
                  ...(listing?.path || []).map((p) => ({
                    title: (
                      <button onClick={() => change({ folder: p.id, scope: 'all', q: '' })}>{p.name}</button>
                    ),
                  })),
                ]}
              />
            </Space>
            {allWorkspaces ? <Button type="primary" onClick={()=>{setDestination(undefined);setChooseWorkspace(true);}}>选择工作区后新建</Button> : <Dropdown
              menu={{
                items: [
                  { key: 'folder', label: '新建文件夹', disabled: !listing?.canCreateFolder },
                  { key: 'base', label: '新建多维表格', disabled: !listing?.canCreateBase },
                  { key: 'shortcut', label: '添加快捷方式', disabled: !listing || scope === 'trash' },
                ],
                onClick: ({ key: kind }) =>
                  kind === 'shortcut' ? setShortcutDialog({}) : openDialog(kind as 'folder' | 'base'),
              }}
            >
              <Button
                type="primary"
                aria-label="新建"
                icon={<PlusOutlined />}
                disabled={!listing?.canCreateFolder && !listing?.canCreateBase}
              >
                新建
              </Button>
            </Dropdown>}
          </div>
          <div className="drive-toolbar">
            <span className="drive-caption">
              {search
                ? '搜索：' + search
                : ({ trash: '回收站', shortcuts: '快捷方式', recent: '最近访问' } as Record<string, string>)[
                    scope
                  ] || '浏览资源'}
            </span>
            <Space wrap>
              {!allWorkspaces && listing && scope !== 'trash' && (
                <Button
                  aria-label="添加快捷方式"
                  icon={<LinkOutlined />}
                  onClick={() => setShortcutDialog({})}
                >
                  添加快捷方式
                </Button>
              )}
              {!allWorkspaces && listing && scope === 'recent' && (
                <Button onClick={() => openPersonal('clear')}>清空最近访问</Button>
              )}
              <Select
                aria-label="资源排序"
                value={sort}
                options={[
                  scope === 'recent'
                    ? { value: 'visitedAt', label: '最近访问时间' }
                    : { value: 'updatedAt', label: '最近修改' },
                  { value: 'name', label: '名称升序' },
                ]}
                onChange={(value) => change({ sort: value })}
              />
              <Button
                aria-label="列表布局"
                aria-pressed={layout === 'list'}
                icon={<UnorderedListOutlined />}
                onClick={() => change({ layout: 'list' })}
              />
              <Button
                aria-label="卡片布局"
                aria-pressed={layout === 'cards'}
                icon={<AppstoreOutlined />}
                onClick={() => change({ layout: 'cards' })}
              />
            </Space>
          </div>
          {personalScope && <PersonalFiles key={scope} scope={scope as 'mine'|'shared'} />}
          {(workspaceError || (!tableOnly && workspaceId && (error || accessError))) && (
            <Alert
              type="error"
              title={workspaceError || error || accessError}
              action={!accessError &&
                <Button
                  aria-label="重试"
                  onClick={() => {
                    setAccessError('');
                    refresh();
                  }}
                >
                  重试
                </Button>
              }
            />
          )}
          {scope === 'all' && !tableOnly && !directoryDenied && !workspacesDenied && <Alert type="info" showIcon title="个人上传文件与已同步的智慧办案成果，请到「我的资源」查看。" action={<Button onClick={() => change({ workspace: '__all__', scope: 'mine', folder: '', q: '' })}>我的资源</Button>} />}
          {linkedTables.length > 0 && (
            <section aria-label="已授权表格">
              <h3>已授权表格</h3>
              {linkedTables.map(t => <Button key={t.id} type="link" icon={<TableOutlined />}
                onClick={() => setParams({ base: t.baseId, table: t.id, driveReturn: params.toString() || 'workspace=' + workspaceId })}>
                {t.baseName === t.name ? t.name : t.baseName + ' / ' + t.name}
              </Button>)}
            </section>
          )}
          {(tableOnly || directoryDenied || workspacesDenied || !workspaceId) && !personalScope && !linkedTables.length && !workspaceError && !loading && (
            <Empty description={search ? '未找到匹配的已授权资源' : '暂无获授权的工作区资源'}>
              {emptyActions}
            </Empty>
          )}
          {!tableOnly && !directoryDenied && !workspacesDenied && workspaceId && <>
          <p className="drive-caption">
            {allWorkspaces ? '全部工作区 · 可访问资源 · ' : `${listing?.workspace.name || '当前工作区'} · 当前工作区资源 · `}
            {search
              ? '搜索结果'
              : scope === 'mine'
                ? '我的资源'
                : scope === 'recent'
                  ? '最近访问（仅自己可见）'
                  : scope === 'shortcuts'
                    ? '快捷方式'
                    : scope === 'trash'
                      ? '回收站'
                      : scope === 'shared'
                        ? '与我共享'
                        : allWorkspaces ? '跨工作区可访问资源' : '当前工作区资源'}{' '}
            · {listing?.total ?? 0} 项
            {scope === 'trash'
              ? ' · 恢复后回到原目录'
              : scope === 'recent'
                ? ' · 保留最近 100 个原资源'
                : scope === 'shortcuts'
                  ? ' · 引用原资源，不授予权限'
                  : parentId
                    ? ''
                    : ' · 新建的根目录资源默认私有'}
          </p>
          {loading ? (
            <Spin />
          ) : !listing?.items.length && linkedTables.length ? null : !listing?.items.length ? (
            <Empty
              description={
                error
                  ? '目录暂不可用，请重试或返回工作区'
                  : scope === 'all' && !parentId && !search
                    ? '暂无获授权的工作区资源'
                    : workspaceId
                    ? '暂无可访问的资源'
                    : '暂无工作区，请创建或联系负责人授权'
              }
            >{!error && scope === 'all' && !parentId && !search && emptyActions}</Empty>
          ) : (
            <div className={'drive-resources drive-' + layout + (scope === 'recent' ? ' drive-recent' : '')}>
              {listing.items.map((item) => (
                <article className="drive-resource" key={item.id} data-resource-id={item.id}>
                  <button
                    className="drive-resource-open"
                    title={item.path.map((part) => part.name).join(' / ')}
                    onClick={() => void openItem(item)}
                  >
                    <span className={'drive-icon drive-icon-' + item.kind.toLowerCase()}>
                      {item.kind === 'SHORTCUT' ? (
                        <LinkOutlined />
                      ) : item.kind === 'FOLDER' ? (
                        <FolderOutlined />
                      ) : (
                        <TableOutlined />
                      )}
                    </span>
                    <span className="drive-resource-name">
                      {item.name}
                      <small>
                        {item.kind === 'SHORTCUT'
                          ? '快捷方式'
                          : item.kind === 'FOLDER'
                            ? '文件夹'
                            : '多维表格'}{' '}
                        · {item.ownerName}{allWorkspaces && <span> · 所属工作区：{item.workspaceName}</span>}
                      </small>
                    </span>
                  </button>
                  <span className="drive-date">
                    {scope === 'recent'
                      ? '访问：' + dateLabel(item.visitedAt || null)
                      : dateLabel(item.updatedAt)}
                  </span>
                  <Dropdown
                    menu={{
                      items: allWorkspaces ? [{key:'workspace',label:'打开所在工作区'},{key:'open',label:'打开'}] :
                        item.kind === 'SHORTCUT'
                          ? [
                              { key: 'open', label: '打开原资源' },
                              { key: 'remove', label: '移除快捷方式', disabled: !item.canRemove },
                            ]
                          : item.deletedAt
                            ? [{ key: 'RESTORE', label: '恢复资源', disabled: !item.canRestore }, { key: 'PURGE', label: '彻底删除', danger: true, disabled: !item.canRestore }]
                            : [
                                { key: 'open', label: '打开' },
                                { key: 'rename', label: '重命名', disabled: !item.canRename },
                                { key: 'access', label: '分享与权限' },
                                { key: 'shortcut', label: '添加快捷方式' },
                                { key: 'MOVE', label: '移动资源', disabled: !item.canMove },
                                { key: 'TRASH', label: '移入回收站', danger: true, disabled: !item.canTrash },
                              ],
                      onClick: ({ key: action }) => {
                        if (action === 'workspace') change({workspace:item.workspaceId,scope:'all',folder:'',q:''});
                        else if (action === 'open') void openItem(item);
                        else if (action === 'rename') openDialog('rename', item);
                        else if (action === 'access') void showAccess(item);
                        else if (action === 'shortcut') setShortcutDialog({ target: item });
                        else if (action === 'remove') openPersonal('remove', item.id);
                        else setLifecycle({ item, action: action as LifecycleAction });
                      },
                    }}
                  >
                    <Button aria-label={item.name + '操作'}>···</Button>
                  </Dropdown>
                </article>
              ))}
            </div>
          )}
          {listing && (
            <Pagination
              current={listing.page}
              pageSize={listing.pageSize}
              total={listing.total}
              showSizeChanger={false}
              onChange={(value) => change({ page: String(value) })}
            />
          )}
          </>}
          </>}
        </main>
      </div>
      <Drawer
        rootClassName="drive-navigation-drawer"
        title="资源目录"
        open={mobile}
        onClose={() => setMobile(false)}
        placement="left"
      >
        {navigation}
      </Drawer>
      <Modal title="选择目标工作区" open={chooseWorkspace} onCancel={()=>setChooseWorkspace(false)} okText="进入工作区" okButtonProps={{disabled:!destination}} onOk={()=>{if(destination){setParams({workspace:destination});setChooseWorkspace(false);}}}>
        <p>请先选择文件夹或多维表格的目标工作区，再进行新建。个人上传文件目前不归属工作区，可在“我的资源”上传。</p>
        <Select aria-label="新建目标工作区" style={{width:'100%'}} value={destination} onChange={setDestination} options={workspaces.map(w=>({value:w.id,label:w.name}))}/>
      </Modal>
      <Modal
        title={
          dialog?.kind === 'rename'
            ? '重命名资源'
            : dialog?.kind === 'workspace'
              ? '创建工作区'
              : dialog?.kind === 'folder'
                ? '新建文件夹'
                : '新建多维表格'
        }
        open={!!dialog}
        onCancel={() => setDialog(undefined)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
      >
        {dialogError && <Alert type="error" title={dialogError} />}
        <label htmlFor="drive-resource-name">名称</label>
        {dialog?.kind === 'base' && <Select aria-label="所属业务模块" allowClear placeholder="所属业务模块（可选）" style={{ width: '100%', marginBottom: 12 }} value={moduleSource} onChange={(v) => { key.current = crypto.randomUUID(); setModuleSource(v); }} options={moduleOptions} />}
        <Input
          id="drive-resource-name"
          maxLength={120}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            key.current = crypto.randomUUID();
          }}
          onPressEnter={() => {
            if (!saving) void submit();
          }}
        />
        {dialog?.kind === 'workspace' && (
          <Select
            aria-label="所属组织"
            placeholder="所属组织"
            value={organizationId}
            options={workspaceOrganizations.map((o) => ({ value: o.id, label: o.name }))}
            onChange={(id) => {
              setOrganizationId(id);
              key.current = crypto.randomUUID();
            }}
          />
        )}
        {(dialog?.kind === 'base' || dialog?.kind === 'folder') && (
          <p>
            {parentId ? '继承当前文件夹权限。' : '默认仅创建者和工作区负责人可访问，可通过分享与权限调整。'}
          </p>
        )}
      </Modal>
      {shortcutDialog && (
        <ShortcutDialog
          workspaceId={workspaceId}
          folders={folders}
          initialTarget={shortcutDialog.target}
          initialParentId={
            folders.some((folder) => folder.id === parentId && folder.canRename) ? parentId : ''
          }
          onClose={() => setShortcutDialog(undefined)}
          onSaved={() => {
            setShortcutDialog(undefined);
            refresh();
          }}
        />
      )}
      <Modal
        title={personalAction?.kind === 'clear' ? '清空最近访问' : '移除快捷方式'}
        open={!!personalAction}
        onCancel={() => {
          if (!personalSaving) setPersonalAction(undefined);
        }}
        onOk={() => void submitPersonal()}
        okText="确认"
        cancelText="取消"
        confirmLoading={personalSaving}
      >
        {personalError && <Alert type="error" title={personalError} />}
        <p>
          {personalAction?.kind === 'clear'
            ? '只清空你在当前工作区的最近访问记录，原资源保持不变。'
            : '只移除此快捷方式，原资源及其中的数据保持不变。'}
        </p>
      </Modal>
      {lifecycle && (
        <DriveLifecycle
          key={lifecycle.item.id + lifecycle.action}
          item={lifecycle.item}
          action={lifecycle.action}
          folders={folders}
          directory={directory}
          onClose={() => setLifecycle(undefined)}
          onSaved={() => {
            setLifecycle(undefined);
            refresh();
          }}
        />
      )}
      <Drawer title="分享与权限" open={!!selected} onClose={() => setSelected(undefined)} size={480}>
        {selected && (
          <>
            <h2>{selected.name}</h2>
            <p>{selected.path.map((p) => p.name).join(' / ')}</p>
            <p>
              创建者：{selected.ownerName} · 创建时间：{dateLabel(selected.createdAt)}
            </p>
            <Alert
              type="info"
              title={'当前权限：' + roleName(selected.access.level)}
              description={
                selected.access.selfOnly ? '仅可查看本人录入的记录。' : '可查看授权范围内全部记录。'
              }
            />
            <p>权限逐级取交集，禁止访问优先；工作区负责人保留管理权限。链接不会授予权限。</p>
            {selected.sources?.map((source) => (
              <p key={source.id}>
                {source.name}：{roleName(source.level)}
                {source.selfOnly ? ' · 仅本人记录' : ''}
              </p>
            ))}
            {selected.canShare && (
              <ResourceAccess
                key={selected.id}
                baseId={selected.baseId || undefined}
                folderId={selected.kind === 'FOLDER' ? selected.id : undefined}
                directory={directory}
                onSaved={() => {
                  setSelected(undefined);
                  refresh();
                }}
              />
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
