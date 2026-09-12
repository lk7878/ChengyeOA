import { useEffect, useRef, useState } from 'react';
import { openWorkspace } from '../browser/client';

// A rapid close/reopen waits for the previous OPFS lock and engine teardown.
const closingWorkspaces = new Map<string, Promise<unknown>>();

export const download = (name: string, value: string | Uint8Array, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([value as any], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export function useCaseWorkspace({ userId, api }: { userId: string; api: any }) {
  const [workspace, setWorkspace] = useState<any>(); const [cases, setCases] = useState<any[]>([]); const [selected, setSelected] = useState('');
  const [events, setEvents] = useState<Record<string, any[]>>({}); const [files, setFiles] = useState<any[]>([]); const [text, setText] = useState('');
  const [bases, setBases] = useState<any[]>([]); const [refs, setRefs] = useState<string[]>([]); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [pending, setPending] = useState<any[]>([]);
  const [ocr, setOcr] = useState(false); const [statuses, setStatuses] = useState<Record<string, string>>({}); const [storage, setStorage] = useState<any>();
  const id = useRef(crypto.randomUUID()); const active = useRef(true);
  const call = (method: string, args?: any) => api.caseCall(id.current, method, args);
  useEffect(() => {
    active.current = true; const abort = new AbortController(); let local: any; let closing = false;
    const previousClose = closingWorkspaces.get(userId);
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
    const initialized = (async () => {
      try {
        await previousClose;
        if (closing) return;
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
    return () => {
      active.current = false; closing = true; abort.abort();
      const shutdown = Promise.allSettled([api.caseCall(id.current, 'close'), initialized]).then(() => local?.close());
      closingWorkspaces.set(userId, shutdown);
      void shutdown.finally(() => { if (closingWorkspaces.get(userId) === shutdown) closingWorkspaces.delete(userId); }).catch(() => {});
    };
  }, [userId, api]);
  useEffect(() => {
    if (!selected || !workspace) { setFiles([]); return; }
    void workspace.call('files', { sessionId: selected }).then(setFiles).catch((e: Error) => setError(e.message));
  }, [selected, workspace, statuses]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const choose = (session: any) => run(async () => { const value = await call('caseResume', { id: session.id, refs }); setSelected(session.id); setEvents(old => ({ ...old, [session.id]: value.events })); });
  const create = () => run(async () => { const value = await call('caseCreate', { refs }); setSelected(value.id); setEvents(old => ({ ...old, [value.id]: value.events })); setCases(await workspace.call('sessions')); });
  const send = () => run(async () => { await call('caseResume', { id: selected, refs }); await call('casePrompt', { id: selected, refs, text }); setText(''); });
  const answer = async (event: any, value: unknown, failed = false) => {
    try {
      await call('reply', { id: event.id, sessionId: event.sessionId, ...(failed ? { error: true } : { value }) });
      setPending(old => old.filter(item => item.id !== event.id));
    } catch (e) { setError((e as Error).message); throw e; }
  };
  const upload = (file: File) => run(async () => {
    if (file.size > 20 * 1024 * 1024) throw new Error('单个办案文件不能超过 20 MB');
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    await workspace.call('importFile', { sessionId: selected, fileName: file.name, base64: btoa(binary), allowOcr: ocr });
    setFiles(await workspace.call('files', { sessionId: selected }));
  });
  return { workspace, cases, selected, events, files, text, setText, bases, refs, setRefs, error, busy,
    pending, ocr, setOcr, statuses, storage, setStorage, setCases,
    run, choose, create, send, answer, upload,
    stop: () => run(async () => { await call('caseCancel', { id: selected }); setStatuses(old => ({ ...old, [selected]: 'idle' })); }),
  };
}
