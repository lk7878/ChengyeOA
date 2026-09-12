import { runtimeSession } from '@/features/auth/runtime-session';

export interface IntelligenceReply { value?: unknown; frames?: unknown[]; events?: unknown[]; cursor?: number }
export async function intelligenceRequest(path: 'knowledge' | 'case' | 'events', body: unknown, signal?: AbortSignal): Promise<IntelligenceReply> {
  const send = () => fetch(`/api/v1/intelligence/${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${runtimeSession.getAccessToken() || ''}`, 'X-CSRF-Token': runtimeSession.getCsrfToken() || '' }, body: JSON.stringify(body) });
  let response = await send();
  if (response.status === 401 && !signal?.aborted) { await runtimeSession.refreshOnce(); response = await send(); }
  const result = await response.json();
  if (!response.ok || result.code !== 200) throw new Error(result.message === 'PERMISSION_DENIED' ? '没有此操作权限' : result.message || '智能服务请求失败');
  return result.data;
}
export async function knowledgeCall(method: string, args?: unknown, signal?: AbortSignal, onFrame?: (frame: unknown) => void) {
  const result = await intelligenceRequest('knowledge', { method, args }, signal);
  for (const frame of result.frames || []) onFrame?.(frame);
  return result.value;
}
