import React, { useEffect, useRef, useState } from 'react';
import { openWorkspace } from '../browser/client';
import { MarkdownText } from '../../../third_party/deepseek-harness/packages/client/ui-primitives/src/markdown/MarkdownText';

const download = (name: string, value: string | Uint8Array, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([value as any], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function messages(events: any[]) {
  const result: { role: string; text: string }[] = []; let assistant: { role: string; text: string } | undefined;
  for (const event of events) {
    if (event.type === 'user/message') { assistant = undefined; result.push({ role: '律师', text: (event.data.content || []).filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n') }); }
    if (event.type === 'assistant/chunk' && event.data.chunk?.type === 'text-delta') {
      if (!assistant) { assistant = { role: '法律助手', text: '' }; result.push(assistant); }
      assistant.text += event.data.chunk.text;
    }
  }
  return result;
}

export function CaseCenter({ userId, api }: { userId: string; api: any }) {
  const [workspace, setWorkspace] = useState<any>(); const [cases, setCases] = useState<any[]>([]); const [selected, setSelected] = useState('');
  const [events, setEvents] = useState<Record<string, any[]>>({}); const [files, setFiles] = useState<any[]>([]); const [text, setText] = useState('');
  const [bases, setBases] = useState<any[]>([]); const [refs, setRefs] = useState<string[]>([]); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [pending, setPending] = useState<any[]>([]); const [answers, setAnswers] = useState<Record<string, string>>({});
  const [ocr, setOcr] = useState(false); const [statuses, setStatuses] = useState<Record<string, string>>({}); const [storage, setStorage] = useState<any>();
  const id = useRef(crypto.randomUUID()); const active = useRef(true);
  const call = (method: string, args?: any) => api.caseCall(id.current, method, args);
  useEffect(() => {
    active.current = true; const abort = new AbortController(); let local: any; let closing = false;
    const refresh = async () => { const value = await local.call('sessions'); if (active.current) setCases(value); };
    const respond = (event: any, value?: any, failed = false) => api.caseCall(id.current, 'reply', { id: event.id, sessionId: event.sessionId, ...(failed ? { error: true } : { value }) });
    async function handle(event: any) {
      if (event.kind === 'session-event') setEvents(old => {
        const rows = new Map((old[event.sessionId] || []).map(row => [row.seq, row])); rows.set(event.event.seq, event.event);
        return { ...old, [event.sessionId]: [...rows.values()].sort((a, b) => a.seq - b.seq) };
      });
      if (event.kind === 'session-status') setStatuses(old => ({ ...old, [event.sessionId]: event.status }));
      if (event.kind === 'session-error') setError(event.error.message);
      if (event.kind === 'withdraw') setPending(old => old.filter(value => value.id !== event.id));
      if (event.kind !== 'browser-request') return;
      if (event.type === 'approval' || event.type === 'question') { setPending(old => [...old.filter(value => value.id !== event.id), event]); return; }
      try {
        const value = event.type === 'persistence'
          ? await local.call('persistence', event.request)
          : await local.call(event.request.method, event.request.args);
        await respond(event, value); if (event.type === 'persistence') await refresh();
      } catch (e) { setError((e as Error).message); await respond(event, undefined, true).catch(() => {}); }
    }
    void (async () => {
      try {
        local = await openWorkspace(userId, async (method, args, signal) => {
          if (method !== 'ocr') throw new Error('不支持的云端操作');
          return api.caseCall(id.current, 'ocr', args, signal);
        });
        if (closing) { await local.close(); return; }
        setWorkspace(local); setStorage(await local.storage()); await refresh();
        try { const knowledge = await api.knowledge('list'); setBases(knowledge.knowledgeBases); setRefs(knowledge.knowledgeBases.slice(0, 1).map((base: any) => base.id)); }
        catch { setError('云端知识库暂不可用；您仍可使用本机办案工作区'); }
        let cursor = 0;
        while (!abort.signal.aborted) {
          try {
            const reply = await api.events(id.current, cursor, abort.signal); cursor = reply.cursor;
            for (const event of reply.events) await handle(event);
          } catch (e) {
            if (abort.signal.aborted) break;
            setError('连接已中断，正在重试；没有收到本机保存确认的操作不会继续');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      } catch (e) { if (!closing) setError((e as Error).message); }
    })();
    return () => { active.current = false; closing = true; abort.abort(); void api.caseCall(id.current, 'close').catch(() => {}).finally(() => local?.close()); };
  }, [userId, api]);
  useEffect(() => {
    if (!selected || !workspace) { setFiles([]); return; }
    void workspace.call('files', { sessionId: selected }).then(setFiles).catch((e: Error) => setError(e.message));
  }, [selected, workspace, statuses]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const choose = (session: any) => run(async () => { const value = await call('caseResume', { id: session.id, refs }); setSelected(session.id); setEvents(old => ({ ...old, [session.id]: value.events })); });
  const create = () => run(async () => { const value = await call('caseCreate', { refs }); setSelected(value.id); setEvents(old => ({ ...old, [value.id]: value.events })); setCases(await workspace.call('sessions')); });
  const send = () => run(async () => { await call('caseResume', { id: selected, refs }); await call('casePrompt', { id: selected, refs, text }); setText(''); });
  const reply = (event: any, approved: boolean) => run(async () => {
    const value = event.type === 'approval' ? (approved ? 'allowed-once' : 'rejected') : { answers: event.request.questions.map((question: any) => ({ id: question.id, selected: [], custom: answers[question.id] || '' })) };
    await call('reply', { id: event.id, sessionId: event.sessionId, value }); setPending(old => old.filter(item => item.id !== event.id));
  });
  const upload = (file: File) => run(async () => {
    if (file.size > 20 * 1024 * 1024) throw new Error('单个办案文件不能超过 20 MB');
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    await workspace.call('importFile', { sessionId: selected, fileName: file.name, base64: btoa(binary), allowOcr: ocr });
    setFiles(await workspace.call('files', { sessionId: selected }));
  });
  return <div className="case-center">
    <header><h2>智慧办案</h2><p>云端知识库统一维护 · 办案材料、会话和工作成果保存在这台电脑</p></header>
    <details className="storage"><summary>本地 Harness 工作区 · 备份与存储设置</summary><p>工作区与当前账号、浏览器和 OA 网址绑定。清除站点数据会删除本地资料；换电脑请先导出备份。模型分析和 OCR 只临时发送本次处理需要的材料。</p>
      <p>{storage?.persisted ? '已启用持久化存储' : '尚未获得浏览器持久化授权'} {storage?.usage ? `· 已用 ${(storage.usage / 1048576).toFixed(1)} MB` : ''}</p>
      <button disabled={!workspace} onClick={() => void run(async () => { await workspace.persist(); setStorage(await workspace.storage()); })}>请求持久化存储</button>
      <button disabled={!workspace} onClick={() => void run(async () => { download('办案工作区备份.json', JSON.stringify(await workspace.call('backup'))); })}>导出完整备份</button>
      <label className="file-button">恢复备份<input type="file" accept=".json" disabled={!workspace} onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { if (file.size > 256 * 1024 * 1024) throw new Error('备份超过 256 MB'); await workspace.call('restore', { backup: JSON.parse(await file.text()) }); setCases(await workspace.call('sessions')); }); e.target.value = ''; }} /></label>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="case-grid"><aside><button disabled={!workspace || busy} onClick={() => void create()}>新建办案会话</button>
      <h3>本机办案会话</h3>{cases.map(item => <button data-active={selected === item.id || undefined} key={item.id} onClick={() => void choose(item)} disabled={busy}>{new Date(item.createdAt).toLocaleDateString()} · {item.id.slice(-8)}</button>)}
      <h3>引用云端知识库</h3>{bases.map(base => <label key={base.id}><input type="checkbox" checked={refs.includes(base.id)} onChange={e => setRefs(old => e.target.checked ? [...old, base.id] : old.filter(id => id !== base.id))} />{base.name}</label>)}
      <p><a href="/knowledge">前往知识库</a></p></aside>
      <main>{!selected ? <p className="empty">新建或打开本机办案会话，导入材料后可以开始阅卷、证据分析和法律文书草拟。</p> : <>
        <div className="conversation">{messages(events[selected] || []).map((message, index) => <section key={index}><strong>{message.role}</strong><MarkdownText text={message.text} /></section>)}
          {statuses[selected] === 'running' && <p aria-live="polite">法律助手正在处理…</p>}</div>
        {pending.filter(event => event.sessionId === selected).map(event => <div className="decision" key={event.id}>
          <h3>{event.type === 'approval' ? '请审核本次文书保存' : '请补充办案信息'}</h3>
          {event.type === 'approval' ? <pre>{event.request.reason}</pre> : event.request.questions.map((question: any) => <label key={question.id}>{question.question}{question.detail && <pre>{question.detail}</pre>}<textarea value={answers[question.id] || ''} onChange={e => setAnswers(old => ({ ...old, [question.id]: e.target.value }))} placeholder={question.options?.map((option: any) => option.label).join(' / ')} /></label>)}
          <button onClick={() => void reply(event, true)}>{event.type === 'approval' ? '批准本次保存' : '提交回答'}</button>{event.type === 'approval' && <button onClick={() => void reply(event, false)}>拒绝</button>}
        </div>)}
        <form onSubmit={e => { e.preventDefault(); void send(); }}><textarea aria-label="办案需求" placeholder="例如：先阅读本机材料，整理事实时间线和证据对应关系，并标记缺失材料。" value={text} onChange={e => setText(e.target.value)} rows={4} />
          <button disabled={busy || !text.trim()}>发送办案需求</button><button type="button" disabled={busy} onClick={() => void run(async () => { await call('caseCancel', { id: selected }); setStatuses(old => ({ ...old, [selected]: 'idle' })); })}>停止处理</button></form>
      </>}</main>
      <aside><h3>本机办案材料与成果</h3><label><input type="checkbox" checked={ocr} onChange={e => setOcr(e.target.checked)} />允许将需识别的图片或扫描页临时发送到云端 OCR</label>
        <label className="file-button">导入办案材料<input type="file" disabled={!selected || busy} accept=".md,.txt,.pdf,.docx,.xlsx,.html,.png,.jpg,.jpeg,.webp" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ''; }} /></label>
        {files.map(file => <div key={file.name}><span>{file.name}</span><button onClick={() => void run(async () => { const value = await workspace.call('downloadFile', { sessionId: selected, fileName: file.name }); download(file.name, Uint8Array.from(atob(value.base64), character => character.charCodeAt(0)), 'application/octet-stream'); })}>下载</button></div>)}
      </aside></div>
  </div>;
}
