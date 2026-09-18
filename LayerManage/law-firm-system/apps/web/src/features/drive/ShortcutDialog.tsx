import Modal from '@/components/DraggableModal';
import { useEffect, useRef, useState } from 'react';
import { Alert, Input, Pagination, Select } from 'antd';
import { errorMessage, get, post } from '../workspaces/api';

interface Resource {
  id: string;
  name: string;
  kind: string;
  path: { name: string }[];
  canRename: boolean;
}
export default function ShortcutDialog({
  workspaceId,
  folders,
  initialTarget,
  initialParentId,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  folders: Resource[];
  initialTarget?: Resource;
  initialParentId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [target, setTarget] = useState(initialTarget);
  const [destination, setDestination] = useState(initialParentId);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [options, setOptions] = useState<Resource[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const key = useRef(crypto.randomUUID());
  const targetId = target?.id;
  const validDestination =
    destination === '' || folders.some((folder) => folder.id === destination && folder.canRename);
  useEffect(() => {
    let active = true,
      inflight = false;
    const load = async () => {
      if (!active || inflight) return;
      inflight = true;
      try {
        const [list, selected] = await Promise.all([
          get<{ items: Resource[]; total: number }>(
            '/workspaces/' +
              workspaceId +
              '/drive?' +
              new URLSearchParams({
                scope: 'all',
                q: query,
                page: String(page),
                pageSize: '50',
                sort: 'name',
              }),
          ),
          targetId ? get<Resource>('/drive/nodes/' + targetId) : undefined,
        ]);
        if (!active) return;
        setOptions(list.items.filter((item) => item.kind !== 'SHORTCUT'));
        setTotal(list.total);
        if (selected) setTarget(selected);
      } catch (e) {
        if (!active) return;
        setOptions([]);
        setTotal(0);
        setTarget(undefined);
        setError(errorMessage(e));
        key.current = crypto.randomUUID();
      } finally {
        inflight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [workspaceId, query, page, targetId]);
  const submit = async () => {
    if (!target || !validDestination) return;
    setSaving(true);
    setError('');
    try {
      await post(
        '/workspaces/' + workspaceId + '/drive/shortcuts',
        { targetId: target.id, parentId: destination || null },
        key.current,
      );
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const choices = target && !options.some((item) => item.id === target.id) ? [target, ...options] : options;
  return (
    <Modal
      title="添加快捷方式"
      open
      onCancel={() => {
        if (!saving) onClose();
      }}
      onOk={() => void submit()}
      okText="添加快捷方式"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !target || !validDestination }}
      mask={{ closable: !saving }}
    >
      {error && <Alert type="error" title={error} />}
      {!validDestination && <Alert type="warning" title="存放位置已不可用，请重新选择。" />}
      <p>引用原资源，打开后继续使用原权限；移除快捷方式不会删除原资源。</p>
      <Input.Search
        aria-label="搜索快捷方式目标"
        placeholder="搜索文件夹或多维表格"
        allowClear
        onSearch={(value) => {
          setOptions([]);
          setQuery(value);
          setPage(1);
        }}
        disabled={saving}
      />
      <label htmlFor="shortcut-target">原资源</label>
      <Select
        id="shortcut-target"
        aria-label="原资源"
        style={{ width: '100%' }}
        placeholder="选择原资源"
        value={target?.id}
        disabled={saving}
        options={choices.map((item) => ({
          value: item.id,
          label: item.path.map((part) => part.name).join(' / '),
        }))}
        onChange={(id) => {
          setTarget(choices.find((item) => item.id === id));
          key.current = crypto.randomUUID();
          setError('');
        }}
      />
      {total > 50 && (
        <Pagination
          size="small"
          current={page}
          pageSize={50}
          total={total}
          showSizeChanger={false}
          onChange={setPage}
        />
      )}
      <label htmlFor="shortcut-location">存放位置</label>
      <Select
        id="shortcut-location"
        aria-label="存放位置"
        style={{ width: '100%' }}
        value={validDestination ? destination : undefined}
        disabled={saving}
        placeholder="重新选择存放位置"
        options={[
          { value: '', label: '个人根目录（仅自己可见）' },
          ...folders
            .filter((folder) => folder.canRename)
            .map((folder) => ({ value: folder.id, label: folder.path.map((part) => part.name).join(' / ') })),
        ]}
        onChange={(id) => {
          setDestination(id);
          key.current = crypto.randomUUID();
          setError('');
        }}
      />
      <p>共享目录中的入口也只向有权读取原资源的人显示。</p>
    </Modal>
  );
}
