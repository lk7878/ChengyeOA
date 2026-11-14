import type { Context } from 'egg';
import { fail } from '../application/collaboration/collaboration-policy';

export default () => async (ctx: Context, next: () => Promise<unknown>) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(ctx.method) &&
      (/^\/api\/v1\/(sop|quality)(\/|$)/.test(ctx.path) ||
       /^\/api\/v1\/cases\/[^/]+\/assessments/.test(ctx.path) ||
       ['SOP_TEMPLATE_PUBLISH','SOP_TEMPLATE_DISABLE'].includes(ctx.request.body?.operationType))) {
    fail('MODULE_RETIRED', 409);
  }
  await next();
};
