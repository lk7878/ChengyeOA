export type CloudHandler = (method: string, args: any, signal: AbortSignal, onFrame: (frame: any) => void) => Promise<any>;

/** One active local database owner per OA account. */
export async function openWorkspace(userId: string, cloud: CloudHandler) {
  if (!isSecureContext || !navigator.storage?.getDirectory || !navigator.locks) throw new Error('本机工作区需要 HTTPS 和支持本地存储的现代浏览器');
  const partition = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.origin + '\0' + userId))))
    .map(value => value.toString(16).padStart(2, '0')).join('');
  let release!: () => void;
  let acquired!: (value: boolean) => void;
  const ready = new Promise<boolean>(resolve => { acquired = resolve; });
  const holding = navigator.locks.request(`chengye-workspace-${partition}`, { ifAvailable: true }, async lock => {
    acquired(!!lock); if (lock) await new Promise<void>(resolve => { release = resolve; });
  });
  if (!await ready) throw new Error('此账号的办案工作区已在另一个标签页打开，请关闭该页面后重试');
  const worker = new Worker(new URL('./workspace-worker.js', import.meta.url), { type: 'module', name: 'Chengye personal workspace' });
  const pending = new Map<string, any>(); const cloudCalls = new Map<string, AbortController>();
  const pdfs = new Map<string, any>();
  async function localPdf(method: string, args: any) {
    if (method === 'pdf.open') {
      const module = await import(new URL('./pdf-main.js', import.meta.url).href);
      pdfs.set(args.id, new module.PDFParse({ data: args.data })); return null;
    }
    const pdf = pdfs.get(args.id);
    if (method === 'pdf.close') { pdfs.delete(args.id); await pdf?.destroy(); return null; }
    if (!pdf) throw new Error('PDF 解析任务已结束');
    if (method === 'pdf.text') return pdf.getText();
    if (method === 'pdf.screenshot') return pdf.getScreenshot(args.options);
    throw new Error('不支持的本机 PDF 操作');
  }
  let closed = false;
  function rejectAll(message: string) { for (const value of pending.values()) { value.cleanup(); value.reject(new Error(message)); } pending.clear(); }
  worker.onerror = () => { closed = true; rejectAll('本机工作区意外停止，请刷新重试；已保存资料仍在本机'); worker.terminate(); for (const abort of cloudCalls.values()) abort.abort(); release(); };
  worker.onmessage = async ({ data }) => {
    if (data.kind === 'host-cancel') { cloudCalls.get(data.id)?.abort(); return; }
    if (data.kind === 'host-request') {
      const abort = new AbortController(); cloudCalls.set(data.id, abort);
      try {
        const result = data.method.startsWith('pdf.') ? await localPdf(data.method, data.args) : await cloud(data.method, data.args, abort.signal, frame => worker.postMessage({ kind: 'host-result', id: data.id, frame }));
        worker.postMessage({ kind: 'host-result', id: data.id, ...(result === undefined ? {} : { frame: result }), done: true });
      } catch (error) { worker.postMessage({ kind: 'host-result', id: data.id, error: { message: error instanceof Error ? error.message : String(error), code: (error as any)?.code }, done: true }); }
      finally { cloudCalls.delete(data.id); }
      return;
    }
    if (data.kind !== 'result') return;
    const value = pending.get(data.id); if (!value) return;
    if ('frame' in data) value.onFrame?.(data.frame);
    if (data.done) {
      pending.delete(data.id); value.cleanup();
      if (data.error) value.reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
      else value.resolve(data.result);
    }
  };
  function call(method: string, args?: any, signal?: AbortSignal, onFrame?: (frame: any) => void): Promise<any> {
    if (closed) return Promise.reject(new Error('本机工作区已关闭'));
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID(); const abort = () => { pending.delete(id); signal?.removeEventListener('abort', abort); reject(new Error('操作已取消')); };
      pending.set(id, { resolve, reject, onFrame, cleanup: () => signal?.removeEventListener('abort', abort) });
      signal?.addEventListener('abort', abort, { once: true });
      worker.postMessage({ kind: 'request', id, method, args });
    });
  }
  async function close() {
    if (closed) return;
    try { await Promise.race([call('close'), new Promise((_, reject) => setTimeout(() => reject(new Error('关闭超时')), 5000))]); }
    finally {
      closed = true; for (const abort of cloudCalls.values()) abort.abort();
      await Promise.allSettled([...pdfs.values()].map(pdf => pdf.destroy())); pdfs.clear();
      worker.terminate(); rejectAll('本机工作区已关闭'); release(); await holding;
    }
  }
  try { await call('initialize', { partition }); } catch (error) { await close(); throw error; }
  return { call, close, storage: async () => ({ ...(await navigator.storage.estimate()), persisted: await navigator.storage.persisted() }), persist: () => navigator.storage.persist() };
}
