import { Context } from 'egg';
import { highRiskOperation, requireHighRiskOperation } from '../application/auth/high-risk-operation';

export default () => async (ctx: Context, next: () => Promise<unknown>) => {
  const impact = highRiskOperation(ctx.method, ctx.path, ctx.request.body);
  if (impact) await requireHighRiskOperation(ctx, impact);
  await next();
};
