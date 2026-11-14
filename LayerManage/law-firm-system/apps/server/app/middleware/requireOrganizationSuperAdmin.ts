import { Context } from 'egg';
import { MasterDataError } from '../domain/master-data/master-data-errors';

export async function requireOrganizationSuperAdmin(ctx: Context, next: () => Promise<void>): Promise<void> {
  if (!ctx.state.authorization?.isSystemSuperAdmin) throw new MasterDataError('SUPER_ADMIN_REQUIRED', 403);
  await next();
}
