import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { PermissionCode } from '../../domain/authorization/authorization-types';
export async function channelScope(
  db: PrismaClient,
  context: AuthorizationContext,
  permission: PermissionCode,
): Promise<Prisma.ChannelWhereInput> {
  const auth = new AuthorizationService(new DataScopeService(db));
  auth.requireAction(context, permission);
  const scope = await auth.resolveScopeTargets(context, 'channel', permission);
  if (scope.all) return {};
  const clauses: Prisma.ChannelWhereInput[] = [];
  if (scope.employeeIds.length) {
    const users = await db.user.findMany({
      where: { employeeId: { in: scope.employeeIds } },
      select: { id: true },
    });
    if (users.length) clauses.push({ createdBy: { in: users.map((u) => u.id) } });
  }
  if (scope.organizationTargets.length) {
    const organizations = await db.organization.findMany({
      where: buildOrganizationScopeWhere(scope),
      select: { id: true },
    });
    if (organizations.length) clauses.push({ branchId: { in: organizations.map((o) => o.id) } });
  }
  return clauses.length ? { OR: clauses } : { id: { in: [] } };
}
