import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { buildCaseScopeWhere } from '../case/case-scope';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { sopFail } from '../../domain/sop/template-content';
export async function qualityCaseScope(
  db: PrismaClient,
  ctx: AuthorizationContext,
  permission: PermissionCode,
  tx: Prisma.TransactionClient = db,
): Promise<Prisma.CaseWhereInput> {
  return {
    AND: [
      await buildCaseScopeWhere(db, ctx, 'case.read', tx),
      await buildCaseScopeWhere(db, ctx, permission, tx),
    ],
  };
}
export async function qualityPolicyScope(
  db: PrismaClient,
  ctx: AuthorizationContext,
  permission: PermissionCode,
): Promise<Prisma.QualitySamplingPolicyWhereInput> {
  const auth = new AuthorizationService(new DataScopeService(db));
  auth.requireAction(ctx, permission);
  const scope = await auth.resolveScopeTargets(ctx, 'case', permission);
  if (scope.all) return {};
  const clauses: Prisma.QualitySamplingPolicyWhereInput[] = [];
  if (scope.employeeIds.length) {
    const users = await db.user.findMany({
      where: { employeeId: { in: scope.employeeIds } },
      select: { id: true },
    });
    clauses.push({ createdBy: { in: users.map((u) => u.id) } });
  }
  if (scope.organizationTargets.length) clauses.push({ organization: buildOrganizationScopeWhere(scope) });
  if (scope.professionalTeamIds.length)
    clauses.push({
      professionalTeamId: { in: scope.professionalTeamIds },
      professionalTeam: { status: 'ENABLED' },
    });
  return { OR: clauses.length ? clauses : [{ id: { in: [] } }] };
}
export async function qualityActor(db: Prisma.TransactionClient, id: string) {
  const ctx = await new AuthorizationContextLoader(db).load(id);
  const user = await db.user.findUnique({ where: { id }, include: { employee: true } });
  if (
    !user ||
    user.status !== 'ENABLED' ||
    (user.employee && (user.employee.status === 'LEAVED' || user.employee.deletedAt))
  )
    sopFail('QUALITY_ACTOR_INACTIVE', 403);
  return ctx;
}
