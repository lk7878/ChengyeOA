import { afterEach, expect, it, vi } from 'vitest';
import request from '@/api/request';
import { runtimeSession } from '@/features/auth/runtime-session';
import { useAuthStore } from '@/stores/authStore';
import { mountDesktopKnowledgeBridge } from './desktop-knowledge-bridge';
import type { KnowledgeEvent } from './desktop';

let stop = () => {};
afterEach(() => { stop(); runtimeSession.clear(); useAuthStore.setState({ isAuthenticated: false, userInfo: null, authorization: null }); delete window.chengyeDesktop; vi.restoreAllMocks(); });
function setup() {
  let receive!: (event: KnowledgeEvent) => void;
  const reply = vi.fn(), identity = vi.fn();
  window.chengyeDesktop = { version: 1, openAssistant: vi.fn(), setKnowledgeIdentity: identity, replyKnowledge: reply, onKnowledgeRequest: fn => { receive = fn; return () => {}; } };
  runtimeSession.setAuthenticated({ token: 'test-renderer-only', csrfToken: 'test-csrf-only', expiresIn: 600 });
  useAuthStore.setState({ isAuthenticated: true, userInfo: { id: 'a', username: 'a', name: 'a' }, authorization: { userId: 'a', employeeId: null, isSystemSuperAdmin: false, isSystemAdmin: false, permissions: [], menus: ['menu.knowledge', 'menu.smart_case'], fieldCapabilities: {}, evaluatedAt: new Date().toISOString(), validUntil: null }, authorizationStatus: 'ready' });
  useAuthStore.setState({ authorization: { ...useAuthStore.getState().authorization!, permissions: ['menu.knowledge', 'menu.smart_case'] } });
  stop = mountDesktopKnowledgeBridge();
  return { reply, identity, query: () => receive({ kind: 'query', id: 'q', userId: 'a', method: 'list', args: {} }), cancel: () => receive({ kind: 'cancel', id: 'q', userId: 'a', method: 'list', args: {} }) };
}
it('relays through the authenticated fixed API and sends no credentials to native IPC', async () => {
  const post = vi.spyOn(request, 'post').mockResolvedValue({ data: { value: { userId: 'a', result: { knowledgeBases: [] } } } });
  const bridge = setup(); bridge.query(); await vi.waitFor(() => expect(bridge.reply).toHaveBeenCalledOnce());
  expect(post.mock.calls[0].slice(0, 2)).toEqual(['/v1/intelligence/desktop-knowledge', { userId: 'a', method: 'list', args: {} }]);
  expect(JSON.stringify(bridge.reply.mock.calls)).not.toContain('test-renderer-only');
  expect(JSON.stringify(bridge.identity.mock.calls)).not.toContain('test-csrf-only');
});
it.each(['logout', 'account', 'permission', 'cancel', 'unload'])('discards in-flight and late responses on %s', async reason => {
  let complete!: (value: unknown) => void;
  const post = vi.spyOn(request, 'post').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const bridge = setup(); bridge.query();
  if (reason === 'logout') runtimeSession.clear();
  if (reason === 'account') useAuthStore.setState({ userInfo: { id: 'b', username: 'b', name: 'b' } });
  if (reason === 'permission') useAuthStore.setState({ authorization: null });
  if (reason === 'cancel') bridge.cancel();
  if (reason === 'unload') window.dispatchEvent(new Event('pagehide'));
  expect(post.mock.calls[0][2]?.signal?.aborted).toBe(true);
  complete({ data: { value: { userId: 'a', result: 'late evidence' } } });
  await new Promise(resolve => setTimeout(resolve, 0)); expect(bridge.reply).not.toHaveBeenCalled();
});
it('reports a fixed permission code without leaking provider response or request headers', async () => {
  vi.spyOn(request, 'post').mockRejectedValue({ response: { status: 403, data: 'private response' }, config: { headers: { Authorization: 'private token' } } });
  const bridge = setup(); bridge.query();
  await vi.waitFor(() => expect(bridge.reply).toHaveBeenCalledWith({ id: 'q', error: 'PERMISSION' }));
});
