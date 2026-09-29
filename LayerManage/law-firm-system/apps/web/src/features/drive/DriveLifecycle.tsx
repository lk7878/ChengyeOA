import Modal from '@/components/DraggableModal';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Space } from 'antd';
import { errorMessage, errorStatus, post } from '../workspaces/api';
import type { Directory } from '../workspaces/types';

export type LifecycleAction = 'MOVE' | 'TRASH' | 'RESTORE' | 'PURGE';
export interface LifecycleItem {
  id: string;
  name: string;
  parentId: string | null;
  path: { id: string; name: string }[];
}
interface Rule {
  id: string;
  name: string;
  policy: {
    restricted: boolean;
    grants: {
      principalType: string;
      principalId: string;
      role: string;
      rowScope: string;
      canCreate: boolean;
      hiddenFields: string[];
      readonlyFields: string[];
    }[];
  };
}
interface Preview {
  previewToken: string;
  fromPath: { name: string }[];
  toPath: { name: string }[];
  beforeRules: Rule[];
  afterRules: Rule[];
  beforeAccess: { level: number; selfOnly: boolean } | null;
  afterAccess: { level: number; selfOnly: boolean } | null;
  affected: { folders: number; bases: number; independentlyTrashed: number; shortcuts?: number };
  workspace: { name: string };
}
const labels = { MOVE: '移动资源', TRASH: '移入回收站', RESTORE: '恢复资源', PURGE: '彻底删除' };
const roles: Record<string, string> = { DENY: '禁止访问', READER: '阅读', EDITOR: '编辑', MANAGER: '管理' };
const accessLabel = (access: Preview['afterAccess']) =>
  access
    ? ['', '阅读', '编辑', '管理', '工作区负责人'][access.level] +
      (access.selfOnly ? ' · 仅本人记录' : ' · 授权范围内全部记录')
    : '不可访问';

export default function DriveLifecycle({
  item,
  action,
  folders,
  directory,
  onClose,
  onSaved,
}: {
  item: LifecycleItem;
  action: LifecycleAction;
  folders: (LifecycleItem & { canMove: boolean })[];
  directory: Directory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [parentId, setParentId] = useState<string | null>(item.parentId);
  const [name, setName] = useState(item.name);
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const attempted = useRef(false);
  const hasPreview = !!preview;
  // The destination and hidden descendants can be revoked while the source stays manageable.
  // Recheck the complete operation, not only the source's catalogue entry.
  useEffect(() => {
    if (!hasPreview || busy) return;
    let active = true,
      inflight = false;
    const verify = async () => {
      if (action === 'PURGE' && attempted.current) return;
      if (!active || inflight) return;
      inflight = true;
      try {
        await post('/drive/nodes/' + item.id + '/lifecycle/preview', {
          action,
          ...(action === 'MOVE' ? { parentId } : {}),
          ...(action === 'RESTORE' ? { name: name.trim() } : {}),
        });
      } catch (e) {
        if (!active) return;
        if ([401, 403, 404].includes(errorStatus(e) || 0)) onClose();
        else if (!attempted.current) {
          setPreview(undefined);
          setError(errorMessage(e));
        }
        // A committed operation may now return a state conflict. Keep its receipt key for retry.
      } finally {
        inflight = false;
      }
    };
    void verify();
    const timer = window.setInterval(() => void verify(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [action, parentId, name, item.id, hasPreview, busy, onClose]);
  const reset = () => {
    setPreview(undefined);
    setError('');
    key.current = crypto.randomUUID();
    attempted.current = false;
  };
  const body = {
    action,
    ...(action === 'MOVE' ? { parentId } : {}),
    ...(action === 'RESTORE' ? { name: name.trim() } : {}),
  };
  const loadPreview = async () => {
    attempted.current = false;
    setBusy(true);
    setError('');
    setPreview(undefined);
    key.current = crypto.randomUUID();
    try {
      setPreview(await post<Preview>('/drive/nodes/' + item.id + '/lifecycle/preview', body));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview) return;
    attempted.current = true;
    setBusy(true);
    setError('');
    try {
      await post(
        '/drive/nodes/' + item.id + '/lifecycle',
        { ...body, previewToken: preview.previewToken },
        key.current,
      );
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      if ([401, 403, 404, 409].includes(errorStatus(e) || 0)) {
        attempted.current = false;
        setPreview(undefined);
      }
    } finally {
      setBusy(false);
    }
  };
  const principalLabel = (type: string, id: string) => {
    const options =
      type === 'USER'
        ? directory.users
        : type === 'POSITION'
          ? directory.positions
          : type === 'ORG'
            ? directory.organizations
            : directory.teams;
    const prefix = ({ USER: '成员', POSITION: '岗位', ORG: '组织', TEAM: '团队' } as Record<string, string>)[
      type
    ];
    return prefix + '：' + (options?.find((option) => option.id === id)?.name || id);
  };
  const rules = (items: Rule[]) =>
    items.length ? (
      items.map((rule) => (
        <div key={rule.id} className="drive-rule">
          <strong>{rule.name}</strong> · {rule.policy.restricted ? '仅指定授权主体可访问' : '继承上级权限'}
          {rule.policy.grants.map((grant) => (
            <p key={grant.principalType + grant.principalId}>
              {principalLabel(grant.principalType, grant.principalId)} · {roles[grant.role]}
              {grant.role !== 'DENY' && (
                <>
                  {' '}
                  · {grant.rowScope === 'SELF' ? '仅本人记录' : '全部记录'} ·{' '}
                  {grant.canCreate || grant.role === 'MANAGER' ? '可新增' : '不可新增'} · 隐藏{' '}
                  {grant.hiddenFields.length} 字段 / 只读 {grant.readonlyFields.length} 字段
                </>
              )}
            </p>
          ))}
        </div>
      ))
    ) : (
      <p>资源处于回收站，内容不可访问。</p>
    );
  return (
    <Modal
      title={labels[action]}
      open
      onCancel={() => {
        if (!busy) onClose();
      }}
      width={860}
      closable={!busy}
      mask={{ closable: !busy }}
      style={{ top: 32 }}
      styles={{ body: { maxHeight: 'calc(100dvh - 240px)', overflowY: 'auto' } }}
      footer={
        <Space wrap>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            aria-label="预览权限影响"
            loading={busy && !preview}
            disabled={
              busy ||
              (action === 'PURGE' && !!error && !!preview) ||
              (action === 'MOVE' && parentId === item.parentId) ||
              (action === 'RESTORE' && !name.trim())
            }
            onClick={() => void loadPreview()}
          >
            预览权限影响
          </Button>
          <Button
            type="primary"
            danger={action === 'TRASH' || action === 'PURGE'}
            aria-label={'确认' + labels[action]}
            disabled={!preview || busy}
            loading={busy && !!preview}
            onClick={() => void commit()}
          >
            确认{labels[action]}
          </Button>
        </Space>
      }
    >
      <p>{item.path.map((part) => part.name).join(' / ')}</p>
      {error && <Alert type="error" title={error} />}
      {action === 'MOVE' && (
        <>
          <label htmlFor="drive-destination">移动到</label>
          <Select
            id="drive-destination"
            aria-label="移动到"
            style={{ width: '100%' }}
            disabled={busy}
            value={parentId ?? ''}
            onChange={(id) => {
              setParentId(id || null);
              reset();
            }}
            options={[
              { value: '', label: '工作区根目录', disabled: item.parentId === null },
              ...folders
                .filter((folder) => folder.canMove && !folder.path.some((part) => part.id === item.id))
                .map((folder) => ({
                  value: folder.id,
                  label: folder.path.map((part) => part.name).join(' / '),
                  disabled: folder.id === item.parentId,
                })),
            ]}
          />
        </>
      )}
      {action === 'RESTORE' && (
        <>
          <label htmlFor="drive-restore-name">恢复名称</label>
          <Input
            id="drive-restore-name"
            maxLength={120}
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              reset();
            }}
          />
          <p>恢复到原目录；如原目录仍在回收站，请先恢复上级文件夹。同名时可修改恢复名称。</p>
        </>
      )}
      {action === 'TRASH' && (
        <Alert
          type="warning"
          title="文件夹内的资源将一起停止访问"
          description="内容会保留，可从回收站恢复。所有成员（包括工作区负责人）的旧链接和已打开的表格将停止访问。"
        />
      )}
      {action === 'PURGE' && <Alert type="error" title="彻底删除后无法恢复" description="将永久删除该资源及文件夹内所有文档、附件和相关快捷方式（包含已独立回收的子项）。若被其他数据表引用，请先解除关联。请先预览删除范围，再确认。" />}
      {preview && action === 'PURGE' && <section aria-label="删除范围预览"><p>将彻底删除 {preview.affected.folders} 个文件夹、{preview.affected.bases} 个文档，以及相关快捷方式。</p><p>位置：{preview.workspace.name} / {preview.fromPath.map(part => part.name).join(' / ')}</p></section>}
      {preview && action !== 'PURGE' && (
        <section aria-label="权限影响预览" className="drive-lifecycle-preview">
          <p>
            影响 {preview.affected.folders} 个文件夹、{preview.affected.bases} 个多维表格、
            {preview.affected.shortcuts ?? 0} 个可见快捷方式；其中 {preview.affected.independentlyTrashed}{' '}
            项已独立回收，恢复上级时仍留在回收站。
          </p>
          <p>
            原位置：{preview.workspace.name} / {preview.fromPath.map((part) => part.name).join(' / ')}
            <br />
            新位置：
            {action === 'TRASH'
              ? '回收站'
              : preview.workspace.name + ' / ' + preview.toPath.map((part) => part.name).join(' / ')}
          </p>
          <p>
            你当前的访问权限：{accessLabel(preview.beforeAccess)} → {accessLabel(preview.afterAccess)}
          </p>
          <Alert
            type="info"
            title="以下比较授权规则，不代表受影响人数"
            description="移动后继承目标目录权限，资源自身权限保持不变。实际访问仍受当前岗位、工作区成员授权、数据表权限和业务数据范围限制；工作区负责人保留授权管理能力，回收状态统一禁止访问。"
          />
          <div className="drive-rule-columns">
            <section>
              <h3>操作前</h3>
              {action === 'RESTORE' ? <p>资源处于回收站，内容不可访问。</p> : rules(preview.beforeRules)}
            </section>
            <section>
              <h3>操作后</h3>
              {rules(preview.afterRules)}
            </section>
          </div>
        </section>
      )}
    </Modal>
  );
}
