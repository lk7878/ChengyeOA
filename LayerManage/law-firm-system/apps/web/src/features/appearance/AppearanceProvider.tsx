import { useEffect, useLayoutEffect, useMemo, type PropsWithChildren } from 'react';
import { ConfigProvider, type ThemeConfig } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { fontPixels, useAppearance, useAppearanceStore } from './store';
import './appearance.css';

const colors = {
  default: { page: '#ffffff', panel: '#ffffff', rail: '#f3f5fa' },
  beige: { page: '#f7f2e8', panel: '#fffcf5', rail: '#f0e9da' },
  green: { page: '#eff6ef', panel: '#f8fcf8', rail: '#e4efe4' },
};
export default function AppearanceProvider({ children }: PropsWithChildren) {
  const accountId = useAuthStore(state => state.userInfo?.id);
  const preferences = useAppearance();
  const load = useAppearanceStore(state => state.load);
  useEffect(() => { if (accountId) void load(accountId); }, [accountId, load]);
  const fontSize = fontPixels[preferences.fontSize], palette = colors[preferences.background];
  const padding = { compact: 4, standard: 8, comfortable: 16 }[preferences.rowHeight];
  const theme = useMemo<ThemeConfig>(() => ({
    token: { fontSize, controlHeight: 32 + (fontSize - 14) * 2, colorBgLayout: palette.page, colorBgContainer: palette.panel },
    components: { Table: { cellPaddingBlock: padding, cellPaddingBlockMD: padding, cellPaddingBlockSM: padding,
      cellFontSize: fontSize, cellFontSizeMD: fontSize, cellFontSizeSM: fontSize } },
  }), [fontSize, palette, padding]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.oaAppearance = preferences.fontSize;
    root.style.setProperty('--oa-font-size', fontSize + 'px');
    root.style.setProperty('--oa-font-small', (fontSize - 2) + 'px');
    root.style.setProperty('--oa-page-bg', palette.page);
    root.style.setProperty('--oa-panel-bg', palette.panel);
    root.style.setProperty('--oa-rail-bg', palette.rail);
    root.style.setProperty('--oa-row-padding', padding + 'px');
    return () => {
      delete root.dataset.oaAppearance;
      for (const name of ['font-size', 'font-small', 'page-bg', 'panel-bg', 'rail-bg', 'row-padding']) root.style.removeProperty('--oa-' + name);
    };
  }, [fontSize, preferences.fontSize, palette, padding]);
  // Keep this provider and its children mounted: changing the theme must not reset form drafts.
  return <ConfigProvider theme={theme}>{children}</ConfigProvider>;
}
