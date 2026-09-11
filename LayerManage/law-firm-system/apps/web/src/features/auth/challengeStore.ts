import { create } from 'zustand';

export type ChallengeKind = 'PASSWORD_CHANGE' | 'MFA_ENROLLMENT' | 'MFA_VERIFY';

interface ChallengeState {
  kind: ChallengeKind | null;
  token: string | null;
  expiresAt: number | null;
  begin: (kind: ChallengeKind, token: string, expiresIn: number) => void;
  clear: () => void;
  isCurrent: (kind?: ChallengeKind) => boolean;
}

export const useChallengeStore = create<ChallengeState>()((set, get) => ({
  kind: null,
  token: null,
  expiresAt: null,
  begin: (kind, token, expiresIn) => set({ kind, token, expiresAt: Date.now() + expiresIn * 1000 }),
  clear: () => set({ kind: null, token: null, expiresAt: null }),
  isCurrent: kind => {
    const state = get();
    return Boolean(
      state.token
      && state.expiresAt
      && state.expiresAt > Date.now()
      && (!kind || state.kind === kind),
    );
  },
}));
