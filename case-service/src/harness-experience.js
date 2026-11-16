// OA identity remains authoritative; legacy public_admin is not a superadmin.
export const canManageHarness = user => user?.isSystemSuperAdmin === true

export function personalWorkspaceTitle(user) {
 const name=(String(user?.displayName||'').trim()||String(user?.username||'').trim()).slice(0,80)
 return name?`${name}的工作区`:'我的工作区'
}

export function harnessBootstrap(user) {
 return `<script>window.__oaHarness=${JSON.stringify({isSuperAdmin:canManageHarness(user)})};</script>`
}

// Native chat uses read-only configuration at startup and persists UI preferences.
// Administration writes are separate from those normal conversation operations.
export function isHarnessAdminRequest(method,args={}) {
 if (/^account\/(startSignIn|cancelSignIn|signOut)$/.test(method)) return true
 if (/^credentials\/(set|unset)$/.test(method)) return true
 if (method==='settings/openSettingsDocument') return true
 if (/^settings\/(update|replace|mutate)$/.test(method)) {
  return typeof args?.ns!=='string'||!args.ns.startsWith('ui-')
 }
 return false
}
