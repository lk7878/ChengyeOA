import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Result,
  Select,
  Space,
  Tag,
  message,
} from 'antd';
import { Link } from 'react-router';
import Modal from '@/components/DraggableModal';
import Table from '@/components/ResizableTable';
import request from '@/api/request';
import { get } from '@/features/workspaces/api';
import { useAuthStore } from '@/stores/authStore';
import { Article } from './PortalHome';
import {
  labels,
  publicKinds,
  portalError,
  type AdminFeed,
  type Draft,
  type Item,
  type Kind,
  type Card,
} from './types';

type Fields = {
  kind: Kind;
  subject?: string;
  title: string;
  body: string;
  caption: string;
  period: string;
  priority: number;
  pinned: boolean;
  external: boolean;
  expiresAt: string;
};
const options = Object.entries(labels).map(([value, label]) => ({ value, label }));
function initial(item?: Item): Fields {
  const r = item?.draft;
  return {
    kind: item?.kind || 'NEWS',
    subject: item?.subject || undefined,
    title: r?.title || '',
    body: r?.body || '',
    caption: r?.caption || '',
    period: r?.period || '',
    priority: r?.priority || 0,
    pinned: r?.pinned || false,
    external: r?.external || false,
    expiresAt: r?.expiresAt
      ? new Date(new Date(r.expiresAt).getTime() - new Date(r.expiresAt).getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : '',
  };
}
function cardFrom(item: Item, rev: Draft): Card {
  const base = '/api/v1/portal/admin/' + item.id + '/' + rev.number + '/files/';
  return {
    ...rev,
    kind: item.kind,
    id: item.id,
    subject: item.subject,
    date: null,
    imageUrl: rev.image ? base + rev.image.id : undefined,
    fileUrl: rev.file ? base + rev.file.id : undefined,
  };
}
async function encode(file: File | null | undefined) {
  if (!file) return file;
  return new Promise<{ name: string; data: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onload = () => resolve({ name: file.name, data: String(reader.result).split(',')[1] });
    reader.readAsDataURL(file);
  });
}
function Edit({
  item,
  feed,
  close,
  saved,
}: {
  item?: Item;
  feed: AdminFeed;
  close: () => void;
  saved: () => void;
}) {
  const [f, set] = useState(() => initial(item));
  const [image, setImage] = useState<File | null>(),
    [file, setFile] = useState<File | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const put = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    set((prev) => ({ ...prev, [key]: value }));
  const person = f.kind === 'LAWYER' || f.kind === 'HONOR',
    linked = person || f.kind === 'TEAM';
  const subjects =
    f.kind === 'TEAM' ? feed.teams : feed.people.filter((p) => f.kind !== 'LAWYER' || p.lawyer);
  async function save() {
    setError('');
    setBusy(true);
    try {
      if ((image?.size || 0) + (file?.size || 0) > 10 * 1024 * 1024)
        throw Error('本次上传的文件合计须在 10 MB 以内');
      const payload = {
        ...f,
        subject: linked ? f.subject : null,
        version: item?.version || 0,
        external: publicKinds.includes(f.kind) && f.external,
        expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
        image: await encode(image),
        file: await encode(file),
      };
      if (item) await request.put('/v1/portal/admin/' + item.id, payload, { suppressGlobalError: true });
      else await request.post('/v1/portal/admin', payload, { suppressGlobalError: true });
      message.success('草稿已保存');
      saved();
    } catch (e) {
      setError(portalError(e));
    } finally {
      setBusy(false);
    }
  }
  function upload(isPhoto: boolean) {
    const setter = isPhoto ? setImage : setFile,
      prior = isPhoto ? item?.draft.image : item?.draft.file,
      selection = isPhoto ? image : file;
    return (
      <Form.Item label={isPhoto ? '展示图片' : '下载文件'}>
        <Space wrap>
          <input
            aria-label={isPhoto ? '上传展示图片' : '上传下载文件'}
            type="file"
            accept={
              isPhoto ? 'image/png,image/jpeg,image/webp' : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt'
            }
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) setter(picked);
              e.target.value = '';
            }}
          />
          {(selection || (selection === undefined && prior)) && (
            <>
              {selection?.name || prior?.name}
              <Button size="small" onClick={() => setter(null)}>
                移除
              </Button>
            </>
          )}
        </Space>
      </Form.Item>
    );
  }
  return (
    <Modal
      open
      title={item ? '编辑草稿' : '新建首页内容'}
      onCancel={() => {
        if (!busy) close();
      }}
      footer={null}
      width={720}
    >
      <Form layout="vertical" onFinish={save}>
        <Form.Item label="栏目">
          <Select
            aria-label="栏目"
            value={f.kind}
            disabled={!!item}
            options={options}
            onChange={(kind) => set({ ...f, kind, subject: undefined, external: false })}
          />
        </Form.Item>
        {linked && (
          <Form.Item label={person ? '组织员工' : '专业团队'} required>
            <Select
              aria-label="关联人员或团队"
              value={f.subject}
              disabled={!!item}
              showSearch={{ optionFilterProp: 'label' }}
              options={subjects.map((s) => ({
                value: s.id,
                label:
                  s.name + ('positions' in s && s.positions.length ? ' · ' + s.positions.join('、') : ''),
              }))}
              onChange={(value) => put('subject', value)}
            />
          </Form.Item>
        )}
        <Form.Item label="标题" required={!linked}>
          <Input
            maxLength={160}
            value={f.title}
            placeholder={linked ? '默认使用关联名称' : undefined}
            onChange={(e) => put('title', e.target.value)}
          />
        </Form.Item>
        {f.kind === 'CONTACT' && (
          <Alert
            type="info"
            title="正文可填写联系地址、电话、邮箱与办公时间，展示图片可上传位置示意图或公众号二维码。"
          />
        )}
        {f.kind === 'HONOR' && (
          <Form.Item label="评选期间" required>
            <Input value={f.period} maxLength={60} onChange={(e) => put('period', e.target.value)} />
          </Form.Item>
        )}
        <Form.Item label={f.kind === 'HONOR' ? '推荐理由' : '正文或简介'}>
          <Input.TextArea
            rows={6}
            value={f.body}
            maxLength={80000}
            onChange={(e) => put('body', e.target.value)}
          />
        </Form.Item>
        {upload(true)}
        <Form.Item label="图片说明">
          <Input value={f.caption} maxLength={400} onChange={(e) => put('caption', e.target.value)} />
        </Form.Item>
        {f.kind === 'DOWNLOAD' && upload(false)}
        <Form.Item label="展示顺序（数值大者优先）">
          <InputNumber
            min={0}
            max={9999}
            precision={0}
            value={f.priority}
            onChange={(v) => put('priority', v || 0)}
          />
        </Form.Item>
        {f.kind === 'NOTICE' && (
          <Space wrap>
            <Checkbox checked={f.pinned} onChange={(e) => put('pinned', e.target.checked)}>
              置顶公告
            </Checkbox>
            <label>
              到期时间{' '}
              <input
                type="datetime-local"
                value={f.expiresAt}
                onChange={(e) => put('expiresAt', e.target.value)}
              />
            </label>
          </Space>
        )}
        {publicKinds.includes(f.kind) && (
          <Form.Item>
            <Checkbox checked={f.external} onChange={(e) => put('external', e.target.checked)}>
              发布时同时向互联网公开此条内容及配图
            </Checkbox>
          </Form.Item>
        )}
        {error && <Alert type="error" title={error} />}
        <Space>
          <Button
            type="primary"
            htmlType="submit"
            disabled={(!linked && !f.title.trim()) || (linked && !f.subject)}
            loading={busy}
          >
            保存草稿
          </Button>
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}

function Management() {
  const userId = useAuthStore((s) => s.authorization?.userId);
  const [feed, setFeed] = useState<AdminFeed>(),
    [editing, edit] = useState<Item | null>(),
    [preview, setPreview] = useState<Card>();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState<Kind>(),
    [history, setHistory] = useState<{ item: Item; revs: Draft[] }>();
  const [revision, setRevision] = useState(0);
  const load = () => setRevision((v) => v + 1);
  useEffect(() => {
    let current = true;
    get<AdminFeed>('/portal/admin')
      .then((data) => {
        if (current) {
          setFeed(data);
          setError('');
        }
      })
      .catch((e) => {
        if (current) setError(portalError(e));
      });
    return () => {
      current = false;
    };
  }, [revision]);
  async function action(item: Item, publish: boolean | 'delete') {
    setBusy(true);
    try {
      await request.post(
        '/v1/portal/admin/' +
          item.id +
          (publish === 'delete' ? '/delete' : publish ? '/publish' : '/withdraw'),
        { version: item.version },
        { suppressGlobalError: true },
      );
      message.success(publish === 'delete' ? '已删除' : publish ? '已发布' : '已下架');
      load();
    } catch (e) {
      setError(portalError(e));
    } finally {
      setBusy(false);
    }
  }
  async function revisions(item: Item) {
    try {
      setHistory({ item, revs: await get<Draft[]>('/portal/admin/' + item.id + '/history') });
    } catch (e) {
      setError(portalError(e));
    }
  }
  return (
    <main className="unified-area-page">
      <div className="portal-heading">
        <h1>首页内容管理</h1>
        <Space wrap>
          <Link to="/">所内首页</Link>
          <a href="/showcase" target="_blank" rel="noreferrer">
            对外展示页
          </a>
        </Space>
      </div>
      <Space wrap>
        <Select
          aria-label="筛选栏目"
          placeholder="全部栏目"
          allowClear
          options={options}
          value={filter}
          onChange={setFilter}
          style={{ width: 160 }}
        />
        <Button type="primary" onClick={() => edit(null)}>
          新建内容
        </Button>
        <Button onClick={load}>刷新</Button>
      </Space>
      {error && <Alert title={error} type="error" />}
      <Table<Item>
        columnWidthsKey={`portal-admin:${userId ?? 'anonymous'}`}
        rowKey="id"
        loading={!feed && !error}
        scroll={{ x: 720 }}
        pagination={{ pageSize: 12 }}
        dataSource={feed?.entries.filter((i) => !filter || filter === i.kind)}
        columns={[
          { key: 'kind', width: 110, title: '栏目', render: (_, i) => labels[i.kind] },
          { key: 'title', width: 400, title: '标题', render: (_, i) => i.draft.title },
          {
            key: 'version',
            width: 150,
            title: '版本',
            render: (_, i) => (
              <>
                {i.liveVersion ? '已发布 v' + i.liveVersion : '未展示'}
                {i.publishedId !== i.draft.id && <Tag>草稿 v{i.draft.number}</Tag>}
              </>
            ),
          },
          {
            key: 'actions',
            width: 300,
            title: '操作',
            render: (_, i) => (
              <Space wrap size="small">
                <Button size="small" onClick={() => edit(i)}>
                  编辑
                </Button>
                <Button size="small" onClick={() => setPreview(cardFrom(i, i.draft))}>
                  预览草稿
                </Button>
                <Button size="small" onClick={() => revisions(i)}>
                  版本记录
                </Button>
                {i.publishedId !== i.draft.id && (
                  <Popconfirm
                    title={i.draft.external ? '确认向所内和互联网公开发布？' : '确认在所内发布？'}
                    description={i.draft.title}
                    okText="确认发布"
                    cancelText="取消"
                    onConfirm={() => action(i, true)}
                  >
                    <Button size="small" disabled={busy}>
                      发布
                    </Button>
                  </Popconfirm>
                )}
                {!i.publishedId && (
                  <Popconfirm
                    title={'确认删除「' + i.draft.title + '」？'}
                    description="删除后将从内容管理列表移除。"
                    okText="确认删除"
                    cancelText="取消"
                    onConfirm={() => action(i, 'delete')}
                  >
                    <Button size="small" danger disabled={busy}>
                      删除
                    </Button>
                  </Popconfirm>
                )}
                {i.publishedId && (
                  <Popconfirm
                    title={'确认下架「' + i.draft.title + '」？'}
                    okText="下架"
                    cancelText="取消"
                    onConfirm={() => action(i, false)}
                  >
                    <Button size="small" danger disabled={busy}>
                      下架
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      {editing !== undefined && feed && (
        <Edit
          item={editing ?? undefined}
          feed={feed}
          close={() => edit(undefined)}
          saved={() => {
            edit(undefined);
            void load();
          }}
        />
      )}
      {history && (
        <Modal open title="版本记录" onCancel={() => setHistory(undefined)} footer={null}>
          {history.revs.map((r) => (
            <button
              key={r.id}
              className="portal-choice"
              onClick={() => setPreview(cardFrom(history.item, r))}
            >
              v{r.number} · {r.title} · {new Date(r.createdAt).toLocaleString('zh-CN')}
              {r.id === history.item.publishedId ? ' · 当前发布' : ''}
            </button>
          ))}
        </Modal>
      )}
      {preview && (
        <Modal open title={preview.title} width={750} footer={null} onCancel={() => setPreview(undefined)}>
          <Article card={preview} />
        </Modal>
      )}
    </main>
  );
}
export default function PortalAdmin() {
  const admin = useAuthStore((s) => s.authorization?.isSystemSuperAdmin);
  return admin ? <Management /> : <Result status="403" title="仅超级管理员可以维护首页" />;
}
