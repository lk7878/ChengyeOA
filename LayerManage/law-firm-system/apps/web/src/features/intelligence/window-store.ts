import { create } from 'zustand';

/** Only window visibility lives here; private case data stays in OPFS. */
export const useCaseWindow = create<{ open: boolean; minimized: boolean; show(): void; minimize(): void; close(): void }>(set => ({
  open: false, minimized: false,
  show: () => set({ open: true, minimized: false }),
  minimize: () => set({ minimized: true }),
  close: () => set({ open: false, minimized: false }),
}));
