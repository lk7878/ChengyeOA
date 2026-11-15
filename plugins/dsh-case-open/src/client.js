/** Task authorization and isolation are enforced by the OA gateway. */
export const inject = ['uiWorkspace', 'sessions', 'workspaces', 'layout']
export function apply(ctx) {
  ctx.effect(() => {
    const sessionId = new URLSearchParams(window.location.hash.slice(1)).get('session')
    if (!sessionId) return
    let opened = false, alive = true
    const open = () => {
      const snapshot = ctx.sessions.list.getSnapshot()
      if (opened || snapshot.phase !== 'ready' || ctx.workspaces.list.getSnapshot().phase !== 'ready' || !snapshot.byId?.[sessionId]) return
      opened = true
      queueMicrotask(() => { if (alive) { ctx.layout.beginNavigation(); ctx.uiWorkspace.openSession(sessionId) } })
    }
    const unsubscribe = ctx.sessions.list.subscribe(open)
    const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(open)
    open()
    return () => { alive = false; unsubscribe(); unsubscribeWorkspaces() }
  }, 'oa-task-session-deeplink')
}
