import { useState } from 'react';
import { Button, message } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useAppearance, useAppearanceStore } from './store';

export default function ThemeToggle() {
  const preferences = useAppearance();
  const { status, save } = useAppearanceStore();
  const [busy, setBusy] = useState(false);
  const dark = preferences.colorMode === 'dark';
  return <Button icon={dark ? <SunOutlined /> : <MoonOutlined />} loading={busy} disabled={status !== 'ready'}
    title="同步切换 OA 和智慧办案界面颜色" aria-label={dark ? '切换浅色模式' : '切换深色模式'}
    onClick={async () => {
      setBusy(true);
      try { await save({ ...preferences, colorMode: dark ? 'light' : 'dark' }); }
      catch (error) { message.error(error instanceof Error ? error.message : '主题保存失败，请重试'); }
      finally { setBusy(false); }
    }}>{dark ? '浅色' : '深色'}</Button>;
}
