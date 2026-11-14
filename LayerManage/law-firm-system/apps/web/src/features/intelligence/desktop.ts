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

/** Every OA host uses the same authenticated server workspace. */
export async function openCaseAssistant() {
  useCaseWindow.getState().show();
}
