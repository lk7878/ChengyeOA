/** Retire only this signed-in account's obsolete smart-case OPFS database. */
export async function removeLegacyWorkspace(userId, environment = globalThis) {
  if (typeof userId !== 'string' || !userId) throw new Error('缺少当前智慧办案账号');
  const { navigator, crypto, location } = environment;
  if (!navigator?.storage?.getDirectory || !navigator?.locks) return 'unavailable';
  const partition = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.origin + '\0' + userId))))
    .map(value => value.toString(16).padStart(2, '0')).join('');
  // Same lock and exact directory used by browser/client.ts + sqlite.ts. Never clear site storage.
  return navigator.locks.request(`chengye-workspace-${partition}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('请关闭其他页面中的旧版智慧办案后重试清理');
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry(`chengye-workspace-${partition}`, { recursive: true }); return 'removed'; }
    catch (error) { if (error.name === 'NotFoundError') return 'absent'; throw error; }
  });
}
