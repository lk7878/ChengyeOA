import { Context } from 'egg';
import { MasterDataError } from '../domain/master-data/master-data-errors';

const MASTER_DATA_ROOTS = [
  '/api/v1/organizations',
  '/api/v1/positions',
  '/api/v1/employees',
  '/api/v1/professional-teams',
];

export function isMasterDataPath(path: string): boolean {
  return MASTER_DATA_ROOTS.some(root => path === root || path.startsWith(`${root}/`));
}

export default () => async (ctx: Context, next: () => Promise<unknown>) => {
  if (!isMasterDataPath(ctx.path)) {
    await next();
    return;
  }

  const allowed = await ctx.prisma.userRole.findFirst({
    where: {
      userId: ctx.state.user.userId,
      role: {
        code: 'SYSTEM_SUPER_ADMIN',
        type: 'SYSTEM',
        status: 'ENABLED',
      },
    },
    select: { id: true },
  });
  if (!allowed) throw new MasterDataError('SYSTEM_SUPER_ADMIN_REQUIRED', 403);

  await next();
};
