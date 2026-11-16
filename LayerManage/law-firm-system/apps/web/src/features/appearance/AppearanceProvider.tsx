import { useEffect, useLayoutEffect, useMemo, type PropsWithChildren } from 'react';
import { ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { appearanceKey, fontPixels, normalizeAppearance, useAppearance, useAppearanceStore } from './store';
import './appearance.css';

const colors = {
  default: { page: '#ffffff', panel: '#ffffff', rail: '#f3f5fa' },
  beige: { page: '#f7f2e8', panel: '#fffcf5', rail: '#f0e9da' },
  green: { page: '#eff6ef', panel: '#f8fcf8', rail: '#e4efe4' },
};
const darkColors = {
  default: { page: '#14171c', panel: '#1c2027', rail: '#181c23' },
  beige: { page: '#1d1b18', panel: '#25221e', rail: '#211e1a' },
  green: { page: '#151d19', panel: '#1d2721', rail: '#18221c' },
};
export default function AppearanceProvider({ children }: PropsWithChildren) {
  const accountId = useAuthStore(state => state.userInfo?.id);
  const preferences = useAppearance();
  const load = useAppearanceStore(state => state.load);
  useEffect(() => { if (accountId) void load(accountId); }, [accountId, load]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (!accountId || event.key !== appearanceKey(accountId) || !event.newValue) return;
      const state = useAppearanceStore.getState();
      if (state.accountId !== accountId || state.status !== 'ready') return;
      try { const value = JSON.parse(event.newValue); if (value && typeof value === 'object') useAppearanceStore.setState({ preferences: normalizeAppearance(value) }); } catch { /* Ignore malformed browser cache. */ }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [accountId]);
  const dark = preferences.colorMode === 'dark';
  const fontSize = fontPixels[preferences.fontSize], palette = dark ? darkColors[preferences.background] : colors[preferences.background];
  const padding = { compact: 4, standard: 8, comfortable: 16 }[preferences.rowHeight];
  const theme = useMemo<ThemeConfig>(() => ({
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: { fontSize, controlHeight: 32 + (fontSize - 14) * 2, colorBgLayout: palette.page, colorBgContainer: palette.panel },
    components: { Table: { cellPaddingBlock: padding, cellPaddingBlockMD: padding, cellPaddingBlockSM: padding,
      cellFontSize: fontSize, cellFontSizeMD: fontSize, cellFontSizeSM: fontSize } },
  }), [dark, fontSize, palette, padding]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.oaAppearance = preferences.fontSize;
    root.dataset.oaColorMode = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.style.setProperty('--oa-font-size', fontSize + 'px');
    root.style.setProperty('--oa-font-small', (fontSize - 2) + 'px');
    root.style.setProperty('--oa-page-bg', palette.page);
    root.style.setProperty('--oa-panel-bg', palette.panel);
    root.style.setProperty('--oa-rail-bg', palette.rail);
    root.style.setProperty('--oa-row-padding', padding + 'px');
    return () => {
      delete root.dataset.oaAppearance;
      delete root.dataset.oaColorMode;
      root.style.removeProperty('color-scheme');
      for (const name of ['font-size', 'font-small', 'page-bg', 'panel-bg', 'rail-bg', 'row-padding']) root.style.removeProperty('--oa-' + name);
    };
  }, [dark, fontSize, preferences.fontSize, palette, padding]);
  // Keep this provider and its children mounted: changing the theme must not reset form drafts.
  return <ConfigProvider theme={theme}>{children}</ConfigProvider>;
}
