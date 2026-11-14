import request from '@/api/request';
import { runtimeSession } from '@/features/auth/runtime-session';
import { useAuthStore } from '@/stores/authStore';
import type { KnowledgeEvent } from './desktop';

/** Keep authenticated HTTP exclusively inside OA; only bounded results cross to Harness. */
export function mountDesktopKnowledgeBridge() {
  const bridge = window.chengyeDesktop;
  if (!bridge?.onKnowledgeRequest || !bridge.replyKnowledge || !bridge.setKnowledgeIdentity) return () => {};
  let identity: string | null = null, disposed = false, expiry: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, AbortController>();
  const clear = () => { for (const controller of pending.values()) controller.abort(); pending.clear(); };
  const update = () => {
    clearTimeout(expiry);
    const state = useAuthStore.getState();
    const next = runtimeSession.getAccessToken() && state.isAuthenticated && state.hasPermission('menu.knowledge') && state.hasPermission('menu.smart_case') ? state.userInfo?.id ?? null : null;
    if (identity !== next) { clear(); identity = next; }
    bridge.setKnowledgeIdentity!(identity);
    const until = state.authorization?.validUntil;
    if (identity && until) expiry = setTimeout(update, Math.min(2147483647, Math.max(1, Date.parse(until) - Date.now())));
  };
  const unsubscribe = bridge.onKnowledgeRequest((event: KnowledgeEvent) => {
    if (event.kind === 'cancel') { pending.get(event.id)?.abort(); pending.delete(event.id); return; }
    update();
    if (disposed || event.kind !== 'query' || !identity || event.userId !== identity) {
      bridge.replyKnowledge!({ id: event.id, error: true }); return;
    }
    const controller = new AbortController(), owner = identity;
    pending.set(event.id, controller);
    void request.post<{ data: { value: { userId: string; result: unknown } } }>('/v1/intelligence/desktop-knowledge',
      { userId: owner, method: event.method, args: event.args }, { signal: controller.signal, timeout: 40000, suppressGlobalError: true })
      .then(response => {
        if (!disposed && !controller.signal.aborted && identity === owner) bridge.replyKnowledge!({ id: event.id, value: response.data.value });
      }).catch((error: { response?: { status?: number }; code?: string }) => {
        // Never forward HTTP headers, credentials or raw Axios errors over IPC.
        const status = error.response?.status;
        const code = status === 401 ? 'AUTH' : status === 403 ? 'PERMISSION' : status === 400 || status === 404 || status === 413 ? 'INVALID'
          : error.code === 'ECONNABORTED' ? 'TIMEOUT' : !error.response ? 'NETWORK' : 'UNAVAILABLE';
        if (!disposed && !controller.signal.aborted) bridge.replyKnowledge!({ id: event.id, error: code });
      }).finally(() => { if (pending.get(event.id) === controller) pending.delete(event.id); });
  });
  const offAuth = useAuthStore.subscribe(update), offSession = runtimeSession.subscribe(update);
  const unload = () => { clearTimeout(expiry); identity = null; clear(); bridge.setKnowledgeIdentity!(null); };
  window.addEventListener('pagehide', unload); update();
  return () => { disposed = true; unsubscribe(); offAuth(); offSession(); window.removeEventListener('pagehide', unload); unload(); };
}
