/* OA is authoritative. Only the current account's confirmed appearance is shared. */
(() => {
  if (window.__oaThemeSync) return;
  window.__oaThemeSync = true;
  let accountId = null, mode = 'light', revision = 0;
  const apply = () => {
    const dark = mode === 'dark', root = document.documentElement;
    if (root.getAttribute('theme-mode') !== mode) root.setAttribute('theme-mode', mode);
    root.style.colorScheme = mode;
    if (document.body?.hasAttribute('data-ds-dark-theme') !== dark) document.body?.toggleAttribute('data-ds-dark-theme', dark);
  };
  const update = value => {
    mode = value === 'dark' ? 'dark' : 'light';
    window.__oaTheme = mode;
    apply();
    window.dispatchEvent(new CustomEvent('oa-theme-change', { detail: mode }));
  };
  const refresh = async () => {
    const current = ++revision;
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (current !== revision) return;
      if (response.status === 401) { accountId = null; update('light'); return; }
      if (!response.ok) return;
      const { user } = await response.json();
      if (current !== revision) return;
      accountId = user.oaUserId;
      update(user.appearance?.colorMode);
    } catch { /* Retain the last confirmed mode during a temporary outage. */ }
  };
  window.addEventListener('storage', event => {
    if (!accountId || event.key !== `oa-appearance:${accountId}` || !event.newValue) return;
    try { const value = JSON.parse(event.newValue); if (!value || !['light', 'dark'].includes(value.colorMode)) return; revision++; update(value.colorMode); } catch { return; }
    void refresh();
  });
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  // Native knowledge pages may restore their own preference during mounting.
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['theme-mode'] });
  document.addEventListener('DOMContentLoaded', apply, { once: true });
  void refresh();
  setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
})();
