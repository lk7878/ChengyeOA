import { Context } from 'egg';
import { isAuthenticationPublicPath } from '../domain/security/auth-paths';
import { SecurityError } from '../domain/security/security-errors';

export default () => async (ctx: Context, next: () => Promise<unknown>) => {
  const identitySecurity = ctx.app.config.identitySecurity as { localPasswordLogin?: boolean } | undefined;
  if (identitySecurity?.localPasswordLogin === true) {
    await next();
    return;
  }
  if (isAuthenticationPublicPath(ctx.path)) {
    await next();
    return;
  }
  const authorization = ctx.state.authorization;
  if (!authorization?.isSystemAdmin && !authorization?.isSystemSuperAdmin) {
    await next();
    return;
  }
  const factor = await ctx.prisma.mfaFactor.findFirst({
    where: {
      userId: ctx.state.user.userId,
      verifiedAt: { not: null },
      disabledAt: null,
    },
    select: { id: true },
  });
  if (!factor) throw new SecurityError('MFA_ENROLLMENT_REQUIRED', 403);
  if (ctx.state.user.assuranceLevel !== 'MFA') throw new SecurityError('MFA_REQUIRED', 403);
  await next();
};
