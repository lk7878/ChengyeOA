import { message } from 'antd';
import { useCaseWindow } from './window-store';

declare global {
  interface Window {
    chengyeDesktop?: { readonly version: 1; openAssistant(): Promise<void> };
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
