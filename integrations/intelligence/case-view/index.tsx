import React from 'react';
import { createRoot } from 'react-dom/client';
import { CaseCenter } from './CaseCenter';
import '../knowledge-view/theme.css';
export { openWorkspace } from '../browser/client';

export function mountCase(container: HTMLElement, userId: string, api: any) {
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
  const styles = document.createElement('link'); styles.rel = 'stylesheet'; styles.href = new URL('./case-view.css', import.meta.url).href;
  const host = document.createElement('div'); shadow.replaceChildren(styles, host); const root = createRoot(host);
  root.render(<CaseCenter userId={userId} api={api} />);
  return () => { root.unmount(); shadow.replaceChildren(); };
}
