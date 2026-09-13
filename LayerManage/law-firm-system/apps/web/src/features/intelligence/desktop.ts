import { message } from 'antd';
import { useCaseWindow } from './window-store';
export type KnowledgeEvent = { kind: 'query' | 'cancel'; id: string; userId: string; method: string; args: Record<string, unknown> };

declare global {
  interface Window {
    chengyeDesktop?: { readonly version: 1; openAssistant(): Promise<void>;
      setKnowledgeIdentity?(value: string | null): void;
      replyKnowledge?(value: { id: string; value?: unknown; error?: boolean | 'AUTH' | 'PERMISSION' | 'NETWORK' | 'TIMEOUT' | 'INVALID' | 'UNAVAILABLE' }): void;
      onKnowledgeRequest?(callback: (event: KnowledgeEvent) => void): () => void;
    };
  }
}

/** A desktop host opens the native agent; ordinary browsers retain their existing workspace. */
export async function openCaseAssistant() {
  if (window.chengyeDesktop?.version !== 1) {
    useCaseWindow.getState().show();
    return;
  }
  try { await window.chengyeDesktop.openAssistant(); }
  catch { message.error('本机智慧办案启动失败，请检查客户端配置后重试'); }
}
