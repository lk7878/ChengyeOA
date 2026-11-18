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
export function isHarnessAdminRequest(method,args={},approvedPreset) {
 if(typeof method!=='string')return false
 const name=method.replace(/^\/(?:api\/)?/,'')
 if (/^(account|credentials|pluginManager|pluginMarket|plugins?|mcpManager|cordis|hostRunner|terminal)\//i.test(name)) return true
 if (/^src\//.test(name))return true
 if (/^skills?\//i.test(name)&&!/^skills?\/(list|read|search)$/.test(name))return true
 if (/^(session\/(selectModel|selectAccountModel|initializeDefaultModel)|agentPresets\/select|permissionPresets\/(select|set|update))$/.test(name)) return true
 if(name==='commands/execute' && /^\s*\/?(permission|model|provider|plugin|mcp)(?:\s|$)/i.test(String(args?.line||'')))return true
 if (name==='settings/openSettingsDocument') return true
 if (/^settings\/(update|replace|mutate)$/.test(name)) {
  return !['ui-theme','ui-locale','ui-sidebar','ui-conversation','ui-layout'].includes(args?.ns)
 }
 if(name==='session/create'&&args?.request?.agentPreset&&args.request.agentPreset!==approvedPreset)return true
 return false
}

// All transports share this guard. Unparseable/binary frames never bypass it.
export function harnessFrameAllowed(data,isBinary=false,approvedPreset) {
 if(isBinary)return false
 try {
  const frame=typeof data==='string'?JSON.parse(data):JSON.parse(data.toString('utf8'))
  if(!frame||typeof frame!=='object'||Array.isArray(frame))return false
  if(frame.type==='open')return typeof frame.endpoint==='string'&&!isHarnessAdminRequest(frame.endpoint,frame.payload?.args,approvedPreset)
  if(frame.type==='client-request')return typeof frame.method==='string'&&!isHarnessAdminRequest(frame.method,frame.payload?.args,approvedPreset)
  return ['item','end','cancel'].includes(frame.type)&&typeof frame.streamId==='string'
 }catch{return false}
}
