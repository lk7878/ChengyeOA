import type { Context } from 'egg';
import { createAuthorizationContextLoader } from '../application/authorization/authorization-factory';
import { fail } from '../application/collaboration/collaboration-policy';

// Dispatch only audited read routes after authenticating the real administrator and checking MFA.
// No target session is issued. These paths cannot invoke mutations or credential endpoints.
const prefix = '/api/v1/permission-preview/read';
export function previewReadAllowed(method:string, path:string) {
  if (method==='POST') return /^\/tables\/[\w-]+\/records\/query$/.test(path) || path==='/analytics/query';
  if (method!=='GET') return false;
  return [
    /^\/authorization\/me$/, /^\/collaboration\/(options|business-tables)$/,
    /^\/workspaces$/, /^\/workspaces\/[\w-]+\/drive(?:\/folders)?$/,
    /^\/bases\/[\w-]+\/tables$/, /^\/tables\/[\w-]+(?:\/records\/[\w-]+)?$/,
    /^\/(home|dashboard)(?:\/(summary|metrics|alerts|overview|todo|todos|workbench))?$/,
    /^\/(customers|leads|cases|contracts|negotiations|channels|payments|invoices|refunds|costs|appointments|employees|positions|professional-teams|roles|users)(?:\/[\w-]+)?$/,
    /^\/organizations\/(options|tree)$/, /^\/permissions\/(catalog|fields|data-scopes)$/,
    /^\/analytics\/(dashboards|sources)$/, /^\/inventory\/(items|movements|stocktakes|statistics|summary)$/,
    /^\/workflows\/(definitions|instances|tasks|templates)$/, /^\/calendar\/events$/,
  ].some(re=>re.test(path));
}
export default () => async (ctx:Context,next:()=>Promise<unknown>) => {
  if (!ctx.path.startsWith(prefix+'/')) { await next(); return; }
  if (!ctx.state.authorization?.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN',403);
  const path=ctx.path.slice(prefix.length);
  if (!previewReadAllowed(ctx.method,path)) fail('WORKSHEET_PREVIEW_READONLY',403);
  const kind=ctx.get('x-oa-preview-kind'), id=ctx.get('x-oa-preview-id');
  if (!['MEMBER','ROLE'].includes(kind) || !/^[\w-]{1,120}$/.test(id)) fail('COLLAB_INVALID_ACCESS');
  const loader=createAuthorizationContextLoader(ctx);
  const target=kind==='ROLE' ? await loader.previewRole(id) : await loader.load(id);
  const previous=ctx.path, originalUser=ctx.state.user, originalAuth=ctx.state.authorization;
  ctx.state.authorization=target;
  ctx.state.user={userId:target.userId};
  if (kind==='ROLE') target.previewRoleId=id;
  ctx.path='/api/v1'+path;
  try {await next();} finally {ctx.path=previous;ctx.state.user=originalUser;ctx.state.authorization=originalAuth;}
};
