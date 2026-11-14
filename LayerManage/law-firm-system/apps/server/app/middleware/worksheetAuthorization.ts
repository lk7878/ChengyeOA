import type { Context } from 'egg';
import { worksheetContext } from '../application/collaboration/worksheet-business-grants';
export default () => async (ctx:Context,next:()=>Promise<unknown>) => {
  const match=/^\/api\/v1\/tables\/([^/]+)(?:\/|$)/.exec(ctx.path);
  if(match && ctx.state.authorization)
    ctx.state.authorization=await worksheetContext(ctx.prisma,ctx.state.authorization,decodeURIComponent(match[1]));
  await next();
};
