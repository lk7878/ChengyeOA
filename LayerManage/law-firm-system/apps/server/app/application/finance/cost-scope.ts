import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { PermissionCode } from '../../domain/authorization/authorization-types';

export { creatorIdsInOrganizations as costCreatorIds } from '../authorization/creator-organization';
import { creatorIdsInOrganizations as costCreatorIds } from '../authorization/creator-organization';
export async function buildCostScopeWhere(
  db: PrismaClient,
  actor: AuthorizationContext,
  permission: PermissionCode,
  reader: Prisma.TransactionClient = db,
): Promise<Prisma.CostEntryWhereInput> {
  const authorization = new AuthorizationService(new DataScopeService(db));
  authorization.requireAction(actor, permission);
  const resolved = await authorization.resolveScopeTargets(actor, 'cost', permission);
  if (resolved.all) return {};
  const clauses: Prisma.CostEntryWhereInput[] = [];
  if (resolved.employeeIds.length) {
    const users = await reader.user.findMany({
      where: { employeeId: { in: resolved.employeeIds } },
      select: { id: true },
    });
    if (users.length) clauses.push({ createdBy: { in: users.map((user) => user.id) } });
  }
  if (resolved.organizationTargets.length) {
    const organizations = await reader.organization.findMany({
      where: buildOrganizationScopeWhere(resolved),
      select: { id: true },
    });
    const ids = organizations.map((org) => org.id);
    if (ids.length) {
      clauses.push({ case: { branchId: { in: ids } } });
      const creators = await costCreatorIds(reader, ids);
      if (creators.length) clauses.push({ caseId: null, createdBy: { in: creators } });
    }
  }
  // No reliable cost team identity exists; team-only grants match no rows.
  return clauses.length ? { OR: clauses } : { id: { in: [] } };
}
