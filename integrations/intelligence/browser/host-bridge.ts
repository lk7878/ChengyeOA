type Pending = { frames: unknown[]; wake?: () => void; done: boolean; error?: Error };
const pending = new Map<string, Pending>();

export function receiveHostMessage(data: any) {
  if (data.kind !== 'host-result') return false;
  const state = pending.get(data.id);
  if (state) {
    if ('frame' in data) state.frames.push(data.frame);
    if (data.error) state.error = Object.assign(new Error(data.error.message), { code: data.error.code });
    if (data.done || data.error) state.done = true;
    state.wake?.();
  }
  return true;
}

export async function* hostStream(method: string, args: unknown, signal?: AbortSignal): AsyncGenerator<any> {
  signal?.throwIfAborted();
  const id = crypto.randomUUID(); const state: Pending = { frames: [], done: false };
  pending.set(id, state);
  const abort = () => { state.error = new Error('操作已取消'); state.done = true; state.wake?.(); self.postMessage({ kind: 'host-cancel', id }); };
  signal?.addEventListener('abort', abort, { once: true });
  self.postMessage({ kind: 'host-request', id, method, args });
  try {
    while (true) {
      if (state.error) throw state.error;
      if (state.frames.length) { yield state.frames.shift(); continue; }
      if (state.done) break;
      await new Promise<void>(resolve => { state.wake = resolve; }); state.wake = undefined;
    }
  } finally { signal?.removeEventListener('abort', abort); pending.delete(id); }
}
export async function hostCall(method: string, args: unknown, signal?: AbortSignal) {
  let result: any;
  for await (const frame of hostStream(method, args, signal)) result = frame;
  return result;
}

export class LocalPaddleOcrClient {
  private abort = new AbortController();
  constructor(_config: unknown) {}
  recognize(image: Uint8Array, pageNumber: number) {
    return hostCall('ocr', { imageBase64: Buffer.from(image).toString('base64'), pageNumber }, this.abort.signal);
  }
  close() { this.abort.abort(); }
}
