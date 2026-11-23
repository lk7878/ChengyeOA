import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Select, Space, Spin, Table, Tag, message } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import Modal from '@/components/DraggableModal';
import request from '@/api/request';
import { useAuthStore } from '@/stores/authStore';
import { get, post, errorMessage } from '../workspaces/api';

type Grant = {
  principalType: string;
  principalId: string;
  role: string;
  rowScope: string;
  canCreate: boolean;
  hiddenFields: string[];
  readonlyFields: string[];
};
type Source = {
  id: string;
  name: string;
  ownerId: string;
  restricted: boolean;
  inherited: boolean;
  grants: Grant[];
};
type Person = {
  userId: string;
  name: string;
  username: string;
  level: number;
  matches: { sourceId: string; principalType: string; principalId: string; role: string }[];
};
type Sharing = {
  id: string;
  name: string;
  kind: string;
  version: number;
  ownerId: string;
  labels: Record<string, string>;
  path: { id: string; name: string }[];
  policy: { restricted: boolean; grants: Grant[] };
  sources: Source[];
  audience: Person[];
};
const roles = [
  { value: 'READER', label: '只读' },
  { value: 'EDITOR', label: '编辑' },
  { value: 'MANAGER', label: '管理' },
  { value: 'DENY', label: '禁止访问' },
];
const keyOf = (g: Pick<Grant, 'principalType' | 'principalId'>) => g.principalType + ':' + g.principalId;
export default function FileSharing({
  fileId,
  onClose,
  onChanged,
}: {
  fileId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const userId = useAuthStore((s) => s.authorization?.userId);
  const [id, setId] = useState(fileId),
    [saved, setSaved] = useState<Sharing>(),
    [draft, setDraft] = useState<Sharing['policy']>();
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [discard, setDiscard] = useState(false);
  const [revoke, setRevoke] = useState<Grant>(),
    [members, setMembers] = useState<{ source: Source; grant: Grant }>();
  const dirty = Boolean(saved && draft && JSON.stringify(saved.policy) !== JSON.stringify(draft));
  async function load(target: string) {
    const data = await get<Sharing>('/personal-files/' + target + '/access');
    setSaved(data);
    setDraft(data.policy);
    setError('');
  }
  function navigate(target: string) {
    setId(target);
    setSaved(undefined);
    setDraft(undefined);
    setError('');
    setNotice('');
    setFilter('');
  }
  useEffect(() => {
    let active = true;
    void get<Sharing>('/personal-files/' + id + '/access')
      .then((data) => {
        if (active) {
          setSaved(data);
          setDraft(data.policy);
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void get<typeof options>('/personal-files/people?keyword=' + encodeURIComponent(query))
        .then((data) => {
          if (active) setOptions(data);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  const label = (g: Pick<Grant, 'principalType' | 'principalId'>) =>
    saved?.labels[keyOf(g)] || options.find((p) => p.value === keyOf(g))?.label || '已授权对象';
  const matchesFilter = (text: string) =>
    text.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
  const memberList = members
    ? saved?.audience.filter((p) =>
        p.matches.some((m) => m.sourceId === members.source.id && keyOf(m) === keyOf(members.grant)),
      ) || []
    : [];
  function close() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  async function save() {
    if (!saved || !draft || !dirty) return;
    setBusy(true);
    setError('');
    try {
      await request.put(
        '/v1/personal-files/' + id + '/access',
        { version: saved.version, policy: draft },
        { suppressGlobalError: true },
      );
      onChanged();
      setNotice('分享已保存并生效。');
      try {
        await load(id);
      } catch {
        message.success('分享已保存；暂时无法刷新名单，请重新打开查看。');
        onClose();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmRevoke() {
    if (!saved || !revoke) return;
    setBusy(true);
    setError('');
    try {
      const result = await post<{ retained: (Person & { sources: string[] })[] }>(
        '/personal-files/' + id + '/access/revoke',
        { version: saved.version, principalType: revoke.principalType, principalId: revoke.principalId },
      );
      setRevoke(undefined);
      onChanged();
      setNotice(
        result.retained.length
          ? '已撤销本项直接授权；以下人员仍有其他访问来源：' +
              result.retained.map((p) => `${p.name}（${p.username}）：${p.sources.join('；')}`).join('。')
          : '已撤销本项直接授权。受影响人员的后续访问将按最新权限校验。',
      );
      try {
        await load(id);
      } catch {
        message.success('已撤销分享，请重新打开查看当前权限。');
        onClose();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const inherited = saved?.sources.filter((s) => s.inherited) || [];
  return (
    <>
      <Drawer
        open
        title={'分享管理 · ' + (saved?.name || '加载中')}
        width={760}
        onClose={close}
        extra={
          <Space>
            <Tag color={dirty ? 'orange' : 'green'}>{dirty ? '尚未保存' : '已保存'}</Tag>
            {dirty && (
              <Button
                disabled={busy}
                onClick={() => {
                  setDraft(saved?.policy);
                  setError('');
                }}
              >
                放弃修改
              </Button>
            )}
            <Button type="primary" disabled={!dirty} loading={busy} onClick={() => void save()}>
              确认分享
            </Button>
          </Space>
        }
      >
        {error && (
          <Alert
            type="error"
            title={error}
            description="如权限已被其他管理者修改，请放弃当前修改并刷新。"
            action={
              <Button
                disabled={busy}
                onClick={() => {
                  if (dirty) {
                    setError('请先点击“放弃修改”，再刷新。');
                    return;
                  }
                  void load(id).catch((e) => setError(errorMessage(e)));
                }}
              >
                刷新
              </Button>
            }
          />
        )}
        {notice && <Alert type="success" title={notice} style={{ marginBottom: 12 }} />}
        {!saved || !draft ? (
          <Spin />
        ) : (
          <>
            <p>{saved.path.map((p) => p.name).join(' / ')}</p>
            {id !== fileId && (
              <Button disabled={dirty || busy} onClick={() => navigate(fileId)}>
                返回原文件 / 文件夹
              </Button>
            )}
            <Alert
              type="info"
              title="撤销直接分享不会自动移除部门、角色或上级文件夹赋予的权限。"
              description="文件夹撤销会影响依赖该授权的下级内容；已下载的副本无法收回。人员名单按当前有效账号、角色和部门关系计算。"
            />
            <h3>添加分享对象</h3>
            <Select
              aria-label="搜索分享对象"
              style={{ width: '100%' }}
              disabled={busy}
              showSearch={{ filterOption: false, onSearch: setQuery }}
              value={null}
              placeholder="搜索姓名、账号、部门或角色"
              options={options}
              onChange={(value: string) => {
                const [principalType, principalId] = value.split(':');
                if (draft.grants.some((g) => keyOf(g) === value)) {
                  message.info('该对象已在直接分享名单中');
                  return;
                }
                const option = options.find((o) => o.value === value);
                if (option) setSaved({ ...saved, labels: { ...saved.labels, [value]: option.label } });
                setDraft({
                  ...draft,
                  grants: [
                    ...draft.grants,
                    {
                      principalType,
                      principalId,
                      role: 'READER',
                      rowScope: 'ALL',
                      canCreate: false,
                      hiddenFields: [],
                      readonlyFields: [],
                    },
                  ],
                });
                setNotice('');
              }}
            />
            <h3>本项直接分享</h3>
            <Input
              aria-label="筛选分享名单"
              allowClear
              placeholder="搜索已分享的姓名、账号或对象名称"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {dirty && <p>修改尚未保存。请确认分享或放弃修改后，再撤销已有分享。</p>}
            <Table<Grant>
              size="small"
              rowKey={keyOf}
              pagination={{ pageSize: 8 }}
              dataSource={draft.grants.filter((g) => matchesFilter(label(g)))}
              scroll={{ x: 560 }}
              columns={[
                {
                  title: '人员或对象',
                  key: 'person',
                  render: (_, g) => (
                    <>
                      {label(g)}
                      {g.principalType === 'USER' && g.principalId === saved.ownerId && <Tag>所有者</Tag>}
                      {!saved.policy.grants.some((p) => keyOf(p) === keyOf(g)) && (
                        <Tag color="orange">待分享</Tag>
                      )}
                    </>
                  ),
                },
                {
                  title: '权限',
                  key: 'role',
                  width: 125,
                  render: (_, g) => (
                    <Select
                      aria-label={label(g) + '的权限'}
                      style={{ width: 112 }}
                      disabled={busy || (g.principalType === 'USER' && g.principalId === saved.ownerId)}
                      value={g.role}
                      options={roles}
                      onChange={(role) => {
                        setDraft({
                          ...draft,
                          grants: draft.grants.map((p) =>
                            keyOf(p) === keyOf(g)
                              ? { ...p, role, canCreate: ['EDITOR', 'MANAGER'].includes(role) }
                              : p,
                          ),
                        });
                        setNotice('');
                      }}
                    />
                  ),
                },
                {
                  title: '操作',
                  key: 'actions',
                  render: (_, g) => (
                    <Space wrap>
                      {g.principalType !== 'USER' && (
                        <Button
                          size="small"
                          disabled={dirty}
                          onClick={() =>
                            setMembers({ source: saved.sources.find((s) => s.id === id)!, grant: g })
                          }
                        >
                          查看成员
                        </Button>
                      )}
                      {!(g.principalType === 'USER' && g.principalId === saved.ownerId) &&
                        (saved.policy.grants.some((p) => keyOf(p) === keyOf(g)) ? (
                          <Button size="small" danger disabled={busy || dirty} onClick={() => setRevoke(g)}>
                            {g.role === 'DENY' ? '解除禁止' : '撤销分享'}
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            disabled={busy}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                grants: draft.grants.filter((p) => keyOf(p) !== keyOf(g)),
                              })
                            }
                          >
                            取消添加
                          </Button>
                        ))}
                    </Space>
                  ),
                },
              ]}
            />
            {inherited.length > 0 && (
              <>
                <h3>上级文件夹权限来源</h3>
                <p>
                  {draft.restricted
                    ? '本项已限制分享对象：上级授权仅是访问前提，仍须同时符合本项授权。'
                    : '本项继承上级权限；直接授权不能超过上级允许的权限。'}
                </p>
                {inherited.map((source) => (
                  <section key={source.id} style={{ borderTop: '1px solid #ddd', padding: '10px 0' }}>
                    <Space wrap>
                      <strong>{source.name}</strong>
                      <Button size="small" disabled={dirty || busy} onClick={() => navigate(source.id)}>
                        查看来源并管理
                      </Button>
                    </Space>
                    <p>
                      {source.grants
                        .filter((g) => !(g.principalType === 'USER' && g.principalId === source.ownerId))
                        .map((g) => (
                          <Tag key={keyOf(g)}>
                            {label(g)} · {roles.find((r) => r.value === g.role)?.label}
                          </Tag>
                        ))}
                    </p>
                    {source.grants
                      .filter((g) => g.principalType !== 'USER')
                      .map((g) => (
                        <Button key={keyOf(g)} size="small" onClick={() => setMembers({ source, grant: g })}>
                          查看{label(g)}成员
                        </Button>
                      ))}
                  </section>
                ))}
              </>
            )}
            <h3>实际访问人员（已保存的权限）</h3>
            <Table<Person>
              size="small"
              rowKey="userId"
              pagination={{ pageSize: 8 }}
              scroll={{ x: 560 }}
              dataSource={saved.audience.filter((p) => matchesFilter(p.name + ' ' + p.username))}
              columns={[
                { title: '人员', key: 'person', render: (_, p) => p.name + '（' + p.username + '）' },
                {
                  title: '当前权限',
                  key: 'level',
                  render: (_, p) => ['当前无法访问', '只读', '编辑', '管理'][p.level],
                },
                {
                  title: '授权来源',
                  key: 'sources',
                  render: (_, p) =>
                    p.matches.map((m) => (
                      <div key={m.sourceId + keyOf(m)}>
                        {saved.sources.find((s) => s.id === m.sourceId)?.name} · {label(m)}
                        {m.role === 'DENY' ? ' · 禁止访问' : ''}
                      </div>
                    )),
                },
              ]}
            />
            <details>
              <summary>高级设置</summary>
              <p>
                <Checkbox
                  disabled={busy || saved.path.length === 1}
                  checked={draft.restricted || saved.path.length === 1}
                  onChange={(e) => setDraft({ ...draft, restricted: e.target.checked })}
                >
                  仅限本项已列出的分享对象（仍需上级目录权限）
                </Checkbox>
              </p>
              <p>“禁止访问”优先于其他分享授权；解除禁止后，原有其他授权可能恢复生效。</p>
              {userId === saved.ownerId &&
                saved.kind === 'FILE' &&
                saved.policy.grants
                  .filter((g) => g.principalType === 'USER' && g.principalId !== saved.ownerId)
                  .map((g) => (
                    <p key={keyOf(g)}>
                      {label(g)}{' '}
                      <Button
                        size="small"
                        onClick={async () => {
                          try {
                            await request.put('/v1/personal-files/' + id + '/publication', {
                              userId: g.principalId,
                              allowed: true,
                            });
                            message.success('已授权投稿和正式归档，仍须文件阅读权');
                          } catch (e) {
                            message.error(errorMessage(e));
                          }
                        }}
                      >
                        授予发布权
                      </Button>{' '}
                      <Button
                        size="small"
                        onClick={async () => {
                          try {
                            await request.put('/v1/personal-files/' + id + '/publication', {
                              userId: g.principalId,
                              allowed: false,
                            });
                            message.success('发布权已撤销');
                          } catch (e) {
                            message.error(errorMessage(e));
                          }
                        }}
                      >
                        撤销发布权
                      </Button>
                    </p>
                  ))}
            </details>
          </>
        )}
      </Drawer>
      <Modal
        title={revoke?.role === 'DENY' ? '确认解除禁止访问' : '确认撤销分享'}
        open={!!revoke}
        confirmLoading={busy}
        okText="确认并立即生效"
        onCancel={() => {
          if (!busy) setRevoke(undefined);
        }}
        onOk={() => void confirmRevoke()}
      >
        <p>
          {revoke?.role === 'DENY' ? '解除禁止访问' : '撤销直接分享'}：{revoke && label(revoke)} ·{' '}
          {saved?.name}
        </p>
        <p>
          {saved?.kind === 'FOLDER'
            ? '此操作会影响依赖这条授权访问本文件夹及下级内容的人员。'
            : '此操作仅修改当前文件的直接授权。'}
          若仍有其他授权，保存后会列出剩余来源。
        </p>
        {error && <Alert type="error" title={error} />}
      </Modal>
      <Modal
        title="放弃未保存的分享修改？"
        open={discard}
        okText="放弃并关闭"
        onCancel={() => setDiscard(false)}
        onOk={onClose}
      >
        <p>本次尚未保存的修改将丢弃，已生效的分享不受影响。</p>
      </Modal>
      <Modal
        title={members ? '分享覆盖人员 · ' + label(members.grant) : ''}
        open={!!members}
        footer={null}
        onCancel={() => setMembers(undefined)}
        width={650}
      >
        <Table<Person>
          size="small"
          rowKey="userId"
          dataSource={memberList}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '姓名', dataIndex: 'name' },
            { title: '账号', dataIndex: 'username' },
            {
              title: '当前文件访问权',
              key: 'level',
              render: (_, p) => ['当前无法访问', '只读', '编辑', '管理'][p.level],
            },
          ]}
        />
      </Modal>
    </>
  );
}
