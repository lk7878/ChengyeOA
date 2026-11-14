import { useEffect, useRef, useState } from 'react';

export const download = (name: string, value: string | Uint8Array | Blob, type = 'application/json') => {
  const url = URL.createObjectURL(value instanceof Blob ? value : new Blob([value as any], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export function useCaseWorkspace({ userId, api }: { userId: string; api: any }) {
  const [cases, setCases] = useState<any[]>([]); const [selected, setSelected] = useState('');
  const [events, setEvents] = useState<Record<string, any[]>>({}); const [files, setFiles] = useState<any[]>([]); const [text, setText] = useState('');
  const [bases, setBases] = useState<any[]>([]); const [refs, setRefs] = useState<string[]>([]); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [pending, setPending] = useState<any[]>([]); const [ready, setReady] = useState(false);
  const [ocr, setOcr] = useState(false); const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('active'); const [settings, setSettings] = useState<any>({}); const [uploadProgress, setUploadProgress] = useState('');
  const id = useRef(crypto.randomUUID()); const active = useRef(true); const selection = useRef(''); const revisions = useRef<Record<string, string>>({});
  const currentFilter = useRef(filter); currentFilter.current = filter;
  const request = useRef<any>(); const uploading = useRef<AbortController>();
  const call = (method: string, args?: any, signal?: AbortSignal) => api.caseCall(id.current, method, args, signal);
  const refresh = async () => { const list = await call('sessions', { filter: currentFilter.current }); if (active.current) setCases(list); return list; };
  const refreshState = async (sessionId: string) => {
    const value = await call('state', { id: sessionId }); if (!active.current) return;
    revisions.current[sessionId] = value.revision;
    setEvents(old => ({ ...old, [sessionId]: value.events })); setStatuses(old => ({ ...old, [sessionId]: value.status }));
    setPending(old => [...old.filter(item => item.sessionId !== sessionId), ...value.pending]);
    const rows = await call('files', { sessionId }); if (active.current && selection.current === sessionId) setFiles(rows);
  };
  useEffect(() => {
    active.current = true; const abort = new AbortController();
    void (async () => {
      try {
        const [list, config] = await Promise.all([refresh(), call('settings')]);
        if (abort.signal.aborted) return;
        setSettings(config); setReady(true);
        if (list.length) { selection.current = list[0].id; setSelected(list[0].id); await refreshState(list[0].id); }
        try { const knowledge = await api.knowledge('list'); if (!abort.signal.aborted) { setBases(knowledge.knowledgeBases); setRefs(knowledge.knowledgeBases.slice(0, 1).map((base: any) => base.id)); } } catch { /* Knowledge permission is separate; private case materials remain usable. */ }
        let cursor = 0;
        while (!abort.signal.aborted) {
          try {
            const reply = await api.events(id.current, cursor, abort.signal); if (abort.signal.aborted) break; cursor = reply.cursor;
            let reload = !!reply.reset;
            for (const event of reply.events) {
              if (event.kind === 'session-event') setEvents(old => {
                const rows = new Map((old[event.sessionId] || []).map(row => [row.seq, row])); rows.set(event.event.seq, event.event);
                return { ...old, [event.sessionId]: [...rows.values()].sort((a, b) => a.seq - b.seq) };
              });
              if (event.kind === 'session-status') { setStatuses(old => ({ ...old, [event.sessionId]: event.status })); reload = true; }
              if (event.kind === 'session-error') { setError(event.error.message); reload = true; }
              if (event.kind === 'withdraw') setPending(old => old.filter(value => value.id !== event.id));
              if (event.kind === 'browser-request' && ['approval', 'question'].includes(event.type)) setPending(old => [...old.filter(value => value.id !== event.id), event]);
              if (event.kind === 'files-changed') reload = true;
            }
            if (reload) { await refresh(); if (selection.current) await refreshState(selection.current); }
          } catch (e) { if (abort.signal.aborted) break; setError('连接暂时中断，正在重连；已保存的会话和文件保留在服务器'); await new Promise(resolve => setTimeout(resolve, 2000)); }
        }
      } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    })();
    return () => { active.current = false; abort.abort(); uploading.current?.abort(); };
  }, [userId, api]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { if (active.current) setError((e as Error).message); } finally { if (active.current) setBusy(false); } };
  const choose = (session: any) => run(async () => { request.current = undefined; selection.current = session.id; setSelected(session.id); setText(''); await refreshState(session.id); });
  const ensureSession = async () => {
    if (selection.current) return selection.current;
    const value = await call('caseCreate', { requestId: crypto.randomUUID() }); selection.current = value.id; setSelected(value.id);
    currentFilter.current = 'active'; setFilter('active'); await refresh(); await refreshState(value.id); return value.id;
  };
  const create = () => run(async () => { request.current = undefined; selection.current = ''; setSelected(''); setText(''); setFiles([]); await ensureSession(); });
  const send = () => run(async () => {
    const sessionId = await ensureSession();
    if (!request.current || request.current.id !== sessionId || request.current.text !== text) request.current = { id: sessionId, text, refs, revision: revisions.current[sessionId], requestId: crypto.randomUUID() };
    await call('casePrompt', request.current); request.current = undefined; setText(''); setStatuses(old => ({ ...old, [sessionId]: 'running' })); await refreshState(sessionId);
  });
  const answer = async (event: any, value: unknown, failed = false) => {
    try { await call('reply', { id: event.id, sessionId: event.sessionId, ...(failed ? { error: true } : { value }) }); setPending(old => old.filter(item => item.id !== event.id)); }
    catch (e) { setError((e as Error).message); throw e; }
  };
  const upload = (file: File) => run(async () => {
    if (!file.size || file.size > 200 * 1024 ** 2) throw new Error('单个材料须大于0且不超过200MB');
    const sessionId = await ensureSession(); const uploadId = crypto.randomUUID(); const abort = new AbortController(); uploading.current = abort;
    const args = { sessionId, uploadId, fileName: file.name, size: file.size, allowOcr: ocr };
    const retry = async (method: string, values: any) => {
      for (let attempt = 0;; attempt++) { abort.signal.throwIfAborted(); try { return await call(method, values, abort.signal); } catch (e) { if (attempt >= 2 || abort.signal.aborted) throw e; } }
    };
    try {
      await retry('uploadBegin', args);
      for (let offset = 0; offset < file.size; offset += 4 * 1024 ** 2) {
        abort.signal.throwIfAborted(); setUploadProgress(`正在上传 ${file.name} · ${Math.floor(offset / file.size * 100)}%`);
        const bytes = new Uint8Array(await file.slice(offset, offset + 4 * 1024 ** 2).arrayBuffer()); let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        await retry('uploadChunk', { uploadId, offset, base64: btoa(binary) });
      }
      await retry('uploadFinish', { uploadId }); setFiles(await call('files', { sessionId }));
    } catch (e) { await call('uploadAbort', { uploadId }).catch(() => {}); throw e; }
    finally { uploading.current = undefined; setUploadProgress(''); }
  });
  const changeSession = (sessionId: string, action: string, title?: string) => run(async () => {
    await call('sessionChange', { id: sessionId, action, title });
    if (['delete', 'archive', 'restore', 'unarchive'].includes(action) && selection.current === sessionId) { selection.current = ''; setSelected(''); setFiles([]); setText(''); }
    await refresh();
  });
  const changeFilter = (value: string) => run(async () => { currentFilter.current = value; setFilter(value); selection.current = ''; setSelected(''); setFiles([]); await refresh(); });
  const downloadFile = (file: any) => run(async () => {
    const parts: Uint8Array[] = []; let offset = 0;
    while (offset < file.size) { const value = await call('downloadChunk', { sessionId: selected, fileName: file.name, offset }); if (value.next <= offset) throw new Error('下载中断，请重试'); parts.push(Uint8Array.from(atob(value.base64), char => char.charCodeAt(0))); offset = value.next; }
    download(file.name, new Blob(parts as any, { type: 'application/octet-stream' }));
  });
  return { workspace: ready, cases, selected, events, files, text, setText, bases, refs, setRefs, error, busy, pending, ocr, setOcr, statuses,
    filter, changeFilter, changeSession, settings, uploadProgress, cancelUpload: () => uploading.current?.abort(), downloadFile,
    saveSettings: async (value: any) => { const saved = await call('saveSettings', value); setSettings(saved); return saved; },
    testSettings: (value: any) => call('testSettings', value),
    clearSettings: async () => { setSettings(await call('clearSettings')); },
    retryParse: (file: any) => run(async () => { await call('retryParse', { sessionId: selected, fileName: file.name, allowOcr: ocr }); setFiles(await call('files', { sessionId: selected })); }),
    run, choose, create, send, answer, upload,
    stop: () => run(async () => { await call('caseCancel', { id: selected }); await refreshState(selected); }),
  };
}
