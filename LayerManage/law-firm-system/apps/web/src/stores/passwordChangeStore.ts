import { create } from 'zustand';

interface PasswordChangeState {
  token: string | null;
  expiresAt: number | null;
  begin: (token: string, expiresIn: number) => void;
  clear: () => void;
}

export const usePasswordChangeStore = create<PasswordChangeState>()((set) => ({
  token: null,
  expiresAt: null,
  begin: (token, expiresIn) => {
    set({ token, expiresAt: Date.now() + expiresIn * 1000 });
  },
  clear: () => {
    set({ token: null, expiresAt: null });
  },
}));
