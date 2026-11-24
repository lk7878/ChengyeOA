import { caseCustomerContext } from '../application/case/intake-customers';
import type { Context } from 'egg';
import { CollaborationService } from '../application/collaboration/collaboration-service';
import { fail } from '../application/collaboration/collaboration-policy';
import { worksheetContext } from '../application/collaboration/worksheet-business-grants';
export default () => async (ctx:Context,next:()=>Promise<unknown>) => {
  const match=/^\/api\/v1\/tables\/([^/]+)(?:\/|$)/.exec(ctx.path);
  if(match && ctx.state.authorization)
    ctx.state.authorization=await worksheetContext(ctx.prisma,ctx.state.authorization,decodeURIComponent(match[1]));
  // Only the create request may carry a worksheet-scoped grant into the case service.
  // Never add these permissions to the user's global session or other case endpoints.
  if (ctx.method === 'POST' && ['/api/v1/cases', '/api/v1/cases/conflict-screen', '/api/v1/cases/intake-customers/search', '/api/v1/cases/intake-customers'].includes(ctx.path) && ctx.request.body?.worksheetId !== undefined) {
    const tableId = ctx.request.body.worksheetId;
    if (ctx.path.endsWith('/conflict-screen') && ctx.request.body.id) fail('COLLAB_FORBIDDEN', 403);
    if (typeof tableId !== 'string' || !tableId) fail('COLLAB_INVALID_VALUE');
    const actor = await worksheetContext(ctx.prisma, ctx.state.authorization, tableId);
    const { table, access } = await new CollaborationService(ctx.prisma, actor).tableAccess(tableId, ctx.prisma, 2);
    if (table.source !== 'CASES' || access.add === false) fail('COLLAB_FORBIDDEN', 403);
    ctx.state.authorization = actor;
  }
  if (ctx.method === 'POST' && ['/api/v1/cases', '/api/v1/cases/conflict-screen'].includes(ctx.path) && !ctx.request.body?.id)
    ctx.state.authorization = caseCustomerContext(ctx.state.authorization);
  await next();
};
