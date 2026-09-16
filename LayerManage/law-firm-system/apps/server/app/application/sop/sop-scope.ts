import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { PermissionCode } from '../../domain/authorization/authorization-types';
export type SopDatabase = PrismaClient | Prisma.TransactionClient;
export async function sopTemplateScope(
  db: SopDatabase,
  context: AuthorizationContext,
  permission: PermissionCode,
): Promise<Prisma.SopTemplateWhereInput> {
  const auth = new AuthorizationService(new DataScopeService(db));
  auth.requireAction(context, permission);
  const scope = await auth.resolveScopeTargets(context, 'sop_template', permission);
  if (scope.all) return {};
  const clauses: Prisma.SopTemplateWhereInput[] = [];
  if (scope.employeeIds.length) {
    const users = await db.user.findMany({
      where: { employeeId: { in: scope.employeeIds } },
      select: { id: true },
    });
    clauses.push({ createdBy: { in: users.map((user) => user.id) } });
  }
  if (scope.organizationTargets.length) clauses.push({ organization: buildOrganizationScopeWhere(scope) });
  if (scope.professionalTeamIds.length)
    clauses.push({
      professionalTeamId: { in: scope.professionalTeamIds },
      professionalTeam: { status: 'ENABLED' },
    });
  return clauses.length ? { OR: clauses } : { id: { in: [] } };
}
