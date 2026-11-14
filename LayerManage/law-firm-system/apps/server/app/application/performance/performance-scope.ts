import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import {
  buildOrganizationScopeWhere,
  buildEmployeeScopeWhere,
} from '../authorization/resource-scope-resolvers';
import { PermissionCode } from '../../domain/authorization/authorization-types';

export async function performanceScope(
  db: PrismaClient,
  context: AuthorizationContext,
  permission: PermissionCode,
): Promise<Prisma.PerformanceWhereInput> {
  const auth = new AuthorizationService(new DataScopeService(db));
  auth.requireAction(context, permission);
  const resolved = await auth.resolveScopeTargets(context, 'performance', permission);
  if (resolved.all) return {};
  const clauses: Prisma.PerformanceWhereInput[] = [];
  const ownEmployee=context.grants.some(g=>g.permissionCode===permission&&g.resource==='performance'&&g.scopeIds.includes('worksheet:self'));
  if(ownEmployee&&context.employeeId) clauses.push({employeeId:context.employeeId});
  const creatorScope = ownEmployee ? await auth.resolveScopeTargets({...context,
    grants:context.grants.map(g=>({...g,scopeIds:g.scopeIds.filter(id=>id!=='worksheet:self')}))},'performance',permission) : resolved;
  if (creatorScope.employeeIds.length) {
    const users = await db.user.findMany({
      where: { employeeId: { in: creatorScope.employeeIds } },
      select: { id: true },
    });
    if (users.length) clauses.push({ createdBy: { in: users.map((u) => u.id) } });
  }
  if (resolved.organizationTargets.length) {
    const people = await db.employee.findMany({
      where: {
        deletedAt: null,
        status: { not: 'LEAVED' },
        assignments: {
          some: {
            organization: buildOrganizationScopeWhere(resolved),
            position: { status: 'ENABLED' },
            startedAt: { lte: resolved.evaluatedAt },
            OR: [{ endedAt: null }, { endedAt: { gt: resolved.evaluatedAt } }],
          },
        },
      },
      select: { id: true },
    });
    if (people.length) clauses.push({ employeeId: { in: people.map((p) => p.id) } });
  }
  if (resolved.professionalTeamIds.length) {
    const people = await db.employee.findMany({
      where: {
        AND: [
          { deletedAt: null, status: { not: 'LEAVED' } },
          buildEmployeeScopeWhere({ ...resolved, organizationTargets: [], employeeIds: [] }),
        ],
      },
      select: { id: true },
    });
    if (people.length) clauses.push({ employeeId: { in: people.map((p) => p.id) } });
  }
  return clauses.length ? { OR: clauses } : { id: { in: [] } };
}
