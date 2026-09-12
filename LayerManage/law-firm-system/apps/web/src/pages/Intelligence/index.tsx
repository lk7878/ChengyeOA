import { useEffect, useRef, useState } from 'react';
import { Alert, Spin } from 'antd';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { intelligenceRequest, knowledgeCall } from '@/api/intelligence';

const api = {
  knowledge: knowledgeCall,
  caseCall: async (clientId: string, method: string, args?: unknown, signal?: AbortSignal) => (await intelligenceRequest('case', { clientId, method, args }, signal)).value,
  events: (clientId: string, cursor: number, signal: AbortSignal) => intelligenceRequest('events', { clientId, cursor }, signal),
};
type ViewModule = {
  mountKnowledge(container: HTMLElement, service: { call: typeof knowledgeCall }, close: () => void, readOnly: boolean): () => void;
  mountCase(container: HTMLElement, userId: string, adapterApi: typeof api): () => void;
};
export default function IntelligencePage({ feature }: { feature: 'knowledge' | 'smart-case' }) {
  const element = useRef<HTMLDivElement>(null); const navigate = useNavigate();
  const userId = useAuthStore(state => state.userInfo?.id);
  const admin = useAuthStore(state => !!(state.authorization?.isSystemAdmin || state.authorization?.isSystemSuperAdmin));
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false; let cleanup: (() => void) | undefined;
    // An absolute same-origin URL keeps Vite from transforming the separately
    // built React 18 module as an OA source import during development.
    const url = new URL(feature === 'knowledge' ? '/intelligence/knowledge-view.js' : '/intelligence/case-view.js', window.location.origin).href;
    void import(/* @vite-ignore */ url).then((module: ViewModule) => {
      if (disposed || !element.current || !userId) return;
      setError('');
      cleanup = feature === 'knowledge'
        ? module.mountKnowledge(element.current, { call: knowledgeCall }, () => navigate('/'), !admin)
        : module.mountCase(element.current, userId, api);
      setLoading(false);
    }).catch(() => { if (!disposed) { setLoading(false); setError('智能模块加载失败，请刷新页面；持续失败请联系管理员检查构建和部署'); } });
    return () => { disposed = true; cleanup?.(); };
  }, [feature, userId, admin, navigate]);
  return <>{error && <Alert type="error" title={error} />}{loading && <Spin description="加载智能模块…" />}<div ref={element} style={{ minHeight: 680, height: feature === 'knowledge' ? 'calc(100vh - 170px)' : undefined }} /></>;
}
