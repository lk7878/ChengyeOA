import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Mentions, Popconfirm, Space, Typography, message } from 'antd';
import { errorMessage, errorStatus, get, patch, post } from './api';

type Person = { id: string; name: string; username: string };
type Comment = { id: string; author: string; content: string; version: number; createdAt: string; updatedAt: string;
  canEdit: boolean; mentionedUsers: Person[] };
export default function RowComments({ tableId, recordId }: { tableId: string; recordId: string }) {
  const [rows, setRows] = useState<Comment[]>([]), [people, setPeople] = useState<Person[]>([]);
  const [before, setBefore] = useState<string>();
  const [content, setContent] = useState(''), [editing, setEditing] = useState<Comment>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [allowed, setAllowed] = useState(true);
  const [loadError, setLoadError] = useState('');
  const selected = useRef<Record<string, Person>>({}), sequence = useRef(0), searchSequence = useRef(0);
  const requestKey = useRef(crypto.randomUUID());
  const endpoint = '/tables/' + tableId + '/records/' + recordId;
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const data = await get<Comment[]>(endpoint + '/comments' + (before ? '?before=' + before : ''));
      if (seq === sequence.current) { setRows(data); setAllowed(true); setLoadError(''); }
    } catch (e) { if (seq === sequence.current) { setLoadError(errorMessage(e));
      if ([401,403,404].includes(errorStatus(e) || 0)) { setAllowed(false); setRows([]); setPeople([]); } } }
  }, [endpoint, before]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const currentSequence = sequence, currentSearch = searchSequence;
    const timer = setInterval(() => void refresh(), 5000);
    return () => { currentSequence.current++; currentSearch.current++; clearTimeout(initial); clearInterval(timer); };
  }, [refresh]);
  const search = async (keyword: string) => {
    const seq = ++searchSequence.current;
    try { const data = await get<Person[]>(endpoint + '/comment-people?' + new URLSearchParams({ keyword }));
      if (seq === searchSequence.current) setPeople(data);
    } catch (e) { if (seq === searchSequence.current) { setPeople([]); setError(errorMessage(e)); } }
  };
  const save = async () => {
    if (!content.trim() || busy || !allowed) return;
    setBusy(true);
    setError('');
    try {
      const names = Mentions.getMentions(content).map(m => m.value);
      const candidates = [...people, ...Object.values(selected.current), ...(editing?.mentionedUsers || [])];
      const mentions = names.map(name => candidates.find(p => p.username === name)?.id);
      if (mentions.some(id => !id)) { message.warning('请从 @ 人员列表选择有权查看本行的成员。'); return; }
      const payload = { content, mentions: [...new Set(mentions)], ...(editing ? { version: editing.version } : {}) };
      if (editing) await patch(endpoint + '/comments/' + editing.id, payload, requestKey.current);
      else await post(endpoint + '/comments', payload, requestKey.current);
      setContent(''); setEditing(undefined); selected.current = {}; requestKey.current = crypto.randomUUID();
      await refresh();
    } catch (e) { setError(errorMessage(e)); if (errorStatus(e)) requestKey.current = crypto.randomUUID(); }
    finally { setBusy(false); }
  };
  return <section aria-label="行级评论">
    <Typography.Title level={4}>评论与协作</Typography.Title>
    <p>输入 @ 选择可查看本行的同事，通知会直接链接到这条记录。</p>
    {before && <Button onClick={() => setBefore(undefined)}>返回最新评论</Button>}
    {(loadError || error) && <Alert type="error" title={loadError || error} />}
    <Mentions aria-label="评论内容" rows={3} maxLength={5000} filterOption={false} disabled={busy || !allowed} value={content}
      onChange={v => { setContent(v); requestKey.current = crypto.randomUUID(); }} onSearch={keyword => void search(keyword)}
      onSelect={option => { const person = people.find(p => p.username === option.value); if (person) selected.current[person.username] = person; }}
      options={people.map(p => ({ value: p.username, label: `${p.name} (${p.username})` }))} placeholder="填写评论，输入 @ 提及同事" />
    <Space style={{ marginTop: 8 }}><Button type="primary" loading={busy} disabled={!content.trim() || !allowed} onClick={() => void save()}>{editing ? '保存评论' : '发表评论'}</Button>
      {editing && <Button onClick={() => { setEditing(undefined); setContent(''); requestKey.current = crypto.randomUUID(); }}>取消修改</Button>}</Space>
    {rows.map(row => <article key={row.id} style={{ borderBottom: '1px solid #eee', padding: '12px 0' }}>
      <b>{row.author}</b> · {new Date(row.createdAt).toLocaleString('zh-CN')} {row.version > 1 && '（已编辑）'}
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.content}</p>
      {row.canEdit && <Space><Button size="small" disabled={busy} onClick={() => { setEditing(row); setContent(row.content); requestKey.current = crypto.randomUUID(); }}>修改评论</Button>
        <Popconfirm title="删除这条评论？历史审计将保留。" onConfirm={async () => {
          try { await patch(endpoint + '/comments/' + row.id, { remove: true, version: row.version });
            if (editing?.id === row.id) { setEditing(undefined); setContent(''); } await refresh();
          } catch (e) { setError(errorMessage(e)); }
        }}><Button size="small" danger disabled={busy}>删除评论</Button></Popconfirm></Space>}
    </article>)}
    {rows.length >= 50 && <Button onClick={() => setBefore(rows[rows.length - 1].id)}>查看更早评论</Button>}
    {!rows.length && !error && <p>暂无评论。</p>}
  </section>;
}
