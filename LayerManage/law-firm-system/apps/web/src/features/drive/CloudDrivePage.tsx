import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Breadcrumb,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Spin,
  Tree,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  AppstoreOutlined,
  FolderOutlined,
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
  kind: 'BASE' | 'FOLDER';
  name: string;
  workspaceId: string;
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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [canCreateWorkspace, setCanCreateWorkspace] = useState(false);
  const workspaceId = params.get('workspace') || workspaces[0]?.id || '';
  const parentId = params.get('folder') || '';
  const scope = params.get('scope') || 'all';
  const search = params.get('q') || '';
  const sort = params.get('sort') || 'updatedAt';
  const layout = params.get('layout') === 'cards' ? 'cards' : 'list';
  const page = Number(params.get('page') || 1);
  const [listing, setListing] = useState<Listing>();
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [folderUserId, setFolderUserId] = useState('');
  const [directory, setDirectory] = useState<Directory>(emptyDirectory);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [dialog, setDialog] = useState<{
    kind: 'folder' | 'base' | 'workspace' | 'rename';
    item?: DriveItem;
  }>();
  const [name, setName] = useState('');
  const [organizationId, setOrganizationId] = useState<string>();
  const [workspaceOrganizations, setWorkspaceOrganizations] = useState<Directory['organizations']>([]);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [selected, setSelected] = useState<DriveItem>();
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
    void get<{ workspaces: Workspace[]; canCreate: boolean }>('/workspaces')
      .then((r) => {
        if (active) {
          setWorkspaces(r.workspaces);
          setCanCreateWorkspace(r.canCreate);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(errorMessage(e));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    void get<Directory>('/collaboration/options' + (workspaceId ? '?workspaceId=' + workspaceId : ''))
      .then((r) => {
        if (active) setDirectory(r);
      })
      .catch(() => {
        if (active) setDirectory(emptyDirectory);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, revision]);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true,
      inflight = false;
    // A new route must never briefly display the previous folder's resources.
    const poll = async (initial = false) => {
      if (inflight || !active) return;
      inflight = true;
      if (initial) {
        setListing(undefined);
        setFolders([]);
        setSelected(undefined);
        setLifecycle(undefined);
        setLoading(true);
      }
      const query = new URLSearchParams({ scope, q: search, sort, page: String(page) });
      if (parentId) query.set('parentId', parentId);
      try {
        const [list, tree] = await Promise.all([
          get<Listing>('/workspaces/' + workspaceId + '/drive?' + query),
          get<{ folders: DriveItem[]; userId: string }>('/workspaces/' + workspaceId + '/drive/folders'),
        ]);
        if (!active) return;
        setListing(list);
        setFolders(tree.folders);
        setFolderUserId(tree.userId);
        setError('');
        const operation = lifecycleRef.current;
        if (operation && !initial) {
          let allowed = false;
          try {
            const node = await get<DriveItem>('/drive/nodes/' + operation.item.id);
            allowed = node.canMove;
          } catch (e) {
            if (errorStatus(e) === 403) {
              try {
                const trash = await get<Listing>(
                  '/workspaces/' +
                    workspaceId +
                    '/drive?scope=trash&q=' +
                    encodeURIComponent(operation.item.name),
                );
                allowed = trash.items.some((item) => item.id === operation.item.id && item.canRestore);
              } catch {
                /* Clear the preview when authorization cannot be refreshed. */
              }
            }
          }
          if (active && lifecycleRef.current === operation && !allowed) setLifecycle(undefined);
        }
        const current = selectedRef.current;
        if (current && !initial) {
          try {
            const fresh = await get<DriveItem>('/drive/nodes/' + current.id);
            if (active && selectedRef.current?.id === current.id) setSelected(fresh);
          } catch (e) {
            if (active && selectedRef.current?.id === current.id) {
              setSelected(undefined);
              setAccessError(errorMessage(e));
            }
          }
        }
      } catch (e) {
        if (!active) return;
        setError(errorMessage(e));
        // Fail closed, including interrupted refreshes: a stale catalogue is not an authorization cache.
        setListing(undefined);
        setFolders([]);
        setSelected(undefined);
        setLifecycle(undefined);
        if ([401, 403, 404].includes(errorStatus(e) || 0)) {
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
    void poll(true);
    const timer = window.setInterval(() => void poll(), 2000);
    const focus = () => void poll();
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [workspaceId, parentId, scope, search, sort, page, revision, setParams]);
  const openDialog = (kind: 'folder' | 'base' | 'workspace' | 'rename', item?: DriveItem) => {
    setName(item?.name || '');
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
  const openItem = async (item: DriveItem) => {
    if (item.deletedAt) {
      setLifecycle({ item, action: 'RESTORE' });
      return;
    }
    if (item.kind === 'FOLDER') {
      change({ folder: item.id, scope: 'all', q: '' });
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
          { name: name.trim(), parentId: parentId || null },
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
  const navigation = (
    <>
      <Select
        aria-label="工作区"
        value={workspaceId || undefined}
        placeholder="选择工作区"
        options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
        onChange={(id) => setParams({ workspace: id })}
      />
      <Input.Search
        key={workspaceId + parentId + scope + search}
        aria-label="搜索资源"
        placeholder="搜索此工作区可访问的资源"
        defaultValue={search}
        allowClear
        onSearch={(q) => change({ q })}
      />
      <div className="drive-nav-title">资源目录</div>
      {[
        ['all', '全部资源'],
        ['mine', '我的资源'],
        ['shared', '与我共享'],
        ...(listing?.canManageAccess ? [['trash', '回收站']] : []),
      ].map(([value, label]) => (
        <Button
          key={value}
          type={scope === value && !parentId ? 'primary' : 'text'}
          block
          onClick={() => change({ scope: value, folder: '', q: '' })}
        >
          {label}
        </Button>
      ))}
      {['mine', 'shared'].map((group) => {
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
          <Button onClick={() => navigate('/')}>OA</Button>
          <h1>云盘</h1>
        </Space>
        <Space wrap>
          {canCreateWorkspace && <Button onClick={() => openDialog('workspace')}>创建工作区</Button>}
          {listing?.canManageAccess && (
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
                        {listing?.workspace.name || '工作区'}
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
            <Dropdown
              menu={{
                items: [
                  { key: 'folder', label: '新建文件夹', disabled: !listing?.canCreateFolder },
                  { key: 'base', label: '新建多维表格', disabled: !listing?.canCreateBase },
                ],
                onClick: ({ key: kind }) => openDialog(kind as 'folder' | 'base'),
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
            </Dropdown>
          </div>
          <div className="drive-toolbar">
            <span className="drive-caption">
              {search ? '搜索：' + search : scope === 'trash' ? '回收站' : '浏览资源'}
            </span>
            <Space wrap>
              <Select
                aria-label="资源排序"
                value={sort}
                options={[
                  { value: 'updatedAt', label: '最近修改' },
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
          {(error || accessError) && (
            <Alert
              type="error"
              title={error || accessError}
              action={
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
          <p className="drive-caption">
            {search
              ? '搜索结果'
              : scope === 'mine'
                ? '我的资源'
                : scope === 'trash'
                  ? '回收站'
                  : scope === 'shared'
                    ? '与我共享'
                    : '全部资源'}{' '}
            · {listing?.total ?? 0} 项
            {scope === 'trash' ? ' · 恢复后回到原目录' : parentId ? '' : ' · 新建的根目录资源默认私有'}
          </p>
          {loading ? (
            <Spin />
          ) : !listing?.items.length ? (
            <Empty
              description={
                error
                  ? '目录暂不可用，请重试或返回工作区'
                  : workspaceId
                    ? '暂无可访问的资源'
                    : '暂无工作区，请创建或联系负责人授权'
              }
            />
          ) : (
            <div className={'drive-resources drive-' + layout}>
              {listing.items.map((item) => (
                <article className="drive-resource" key={item.id} data-resource-id={item.id}>
                  <button
                    className="drive-resource-open"
                    title={item.path.map((part) => part.name).join(' / ')}
                    onClick={() => void openItem(item)}
                  >
                    <span className={'drive-icon drive-icon-' + item.kind.toLowerCase()}>
                      {item.kind === 'FOLDER' ? <FolderOutlined /> : <TableOutlined />}
                    </span>
                    <span className="drive-resource-name">
                      {item.name}
                      <small>
                        {item.kind === 'FOLDER' ? '文件夹' : '多维表格'} · {item.ownerName}
                      </small>
                    </span>
                  </button>
                  <span className="drive-date">{dateLabel(item.updatedAt)}</span>
                  <Dropdown
                    menu={{
                      items: item.deletedAt
                        ? [{ key: 'RESTORE', label: '恢复资源', disabled: !item.canRestore }]
                        : [
                            { key: 'open', label: '打开' },
                            { key: 'rename', label: '重命名', disabled: !item.canRename },
                            { key: 'access', label: '分享与权限' },
                            { key: 'MOVE', label: '移动资源', disabled: !item.canMove },
                            { key: 'TRASH', label: '移入回收站', danger: true, disabled: !item.canTrash },
                          ],
                      onClick: ({ key: action }) => {
                        if (action === 'open') void openItem(item);
                        else if (action === 'rename') openDialog('rename', item);
                        else if (action === 'access') void showAccess(item);
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
                fields={[]}
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
