import { create } from 'zustand';
import { get, patch } from '@/features/workspaces/api';
import { useAuthStore } from '@/stores/authStore';

export type Appearance = {
  fontSize: 'standard' | 'large' | 'extraLarge';
  background: 'default' | 'beige' | 'green';
  rowHeight: 'compact' | 'standard' | 'comfortable';
};
export const defaultAppearance: Appearance = { fontSize: 'standard', background: 'default', rowHeight: 'standard' };
export const fontPixels = { standard: 14, large: 16, extraLarge: 18 };
export const rowPixels = { compact: 32, standard: 40, comfortable: 64 };
export function normalizeAppearance(value: Partial<Appearance>): Appearance {
  return {
    fontSize: Object.hasOwn(fontPixels, value.fontSize || '') ? value.fontSize! : 'standard',
    background: ['default', 'beige', 'green'].includes(value.background || '') ? value.background! : 'default',
    rowHeight: Object.hasOwn(rowPixels, value.rowHeight || '') ? value.rowHeight! : 'standard',
  };
}
let generation = 0;
export const useAppearanceStore = create<{
  accountId?: string; preferences: Appearance; status: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  load(accountId: string): Promise<void>;
  save(value: Appearance): Promise<void>;
}>((set, state) => ({
  preferences: defaultAppearance, status: 'idle',
  load: async (accountId) => {
    const current = ++generation;
    set({ accountId, preferences: defaultAppearance, status: 'loading' });
    try {
      const value = await get<Appearance>('/auth/appearance');
      if (current === generation && useAuthStore.getState().userInfo?.id === accountId)
        set({ accountId, preferences: normalizeAppearance(value), status: 'ready' });
    } catch {
      if (current === generation && useAuthStore.getState().userInfo?.id === accountId) set({ status: 'error' });
    }
  },
  save: async (value) => {
    const accountId = useAuthStore.getState().userInfo?.id;
    if (!accountId) throw new Error('请先登录后再保存外观设置。');
    if (state().accountId !== accountId || state().status !== 'ready') throw new Error('个人设置正在读取或保存，请稍后重试。');
    const current = ++generation;
    set({ status: 'saving' });
    try {
      const saved = await patch<Appearance>('/auth/appearance', value);
      if (current !== generation || useAuthStore.getState().userInfo?.id !== accountId)
        throw new Error('账号已切换，请在当前账号下重新打开外观设置。');
      set({ accountId, preferences: normalizeAppearance(saved), status: 'ready' });
    } finally {
      if (current === generation && useAuthStore.getState().userInfo?.id === accountId) set({ status: 'ready' });
    }
  },
}));

export function useAppearance() {
  const accountId = useAuthStore(state => state.userInfo?.id);
  return useAppearanceStore(state => accountId && state.accountId === accountId ? state.preferences : defaultAppearance);
}

export function appearanceRowHeight(value: Appearance) {
  return rowPixels[value.rowHeight] + (fontPixels[value.fontSize] - 14) * 2;
}
