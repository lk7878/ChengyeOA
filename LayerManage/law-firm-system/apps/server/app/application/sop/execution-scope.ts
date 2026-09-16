import { employmentStamp } from './employment-stamp';
import { Prisma } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { SopDatabase } from './sop-scope';
import { sopFail } from '../../domain/sop/template-content';

async function scopeParts(
  db: SopDatabase,
  ctx: AuthorizationContext,
  permission: PermissionCode,
  resource: 'sop_task' | 'sop_instance',
) {
  if(ctx.employeeId&&!(await db.employee.count({where:{id:ctx.employeeId,status:{not:'LEAVED'},deletedAt:null}})))sopFail('QUALITY_ACTOR_INACTIVE',403);
  const auth = new AuthorizationService(new DataScopeService(db));
  auth.requireAction(ctx, permission);
  const scope = await auth.resolveScopeTargets(ctx, resource, permission);
  const creators = scope.employeeIds.length
    ? (
        await db.user.findMany({ where: { employeeId: { in: scope.employeeIds } }, select: { id: true } })
      ).map((u) => u.id)
    : [];
  const templates: Prisma.SopTemplateWhereInput[] = [];
  if (scope.organizationTargets.length) templates.push({ organization: buildOrganizationScopeWhere(scope) });
  if (scope.professionalTeamIds.length)
    templates.push({
      professionalTeamId: { in: scope.professionalTeamIds },
      professionalTeam: { status: 'ENABLED' },
    });
  return { all: scope.all, creators, templates };
}
export async function sopInstanceScope(
  db: SopDatabase,
  ctx: AuthorizationContext,
  permission: PermissionCode,
): Promise<Prisma.SopInstanceWhereInput> {
  const p = await scopeParts(db, ctx, permission, 'sop_instance');
  if (p.all) return {};
  const clauses: Prisma.SopInstanceWhereInput[] = [];
  if (p.creators.length) clauses.push({ createdBy: { in: p.creators } });
  if (p.templates.length) clauses.push({ templateVersion: { template: { OR: p.templates } } });
  return clauses.length ? { OR: clauses } : { id: { in: [] } };
}
export async function sopTaskScope(
  db: SopDatabase,
  ctx: AuthorizationContext,
  permission: PermissionCode,
): Promise<Prisma.CaseTaskWhereInput> {
  const p = await scopeParts(db, ctx, permission, 'sop_task');
  if (p.all) return { sopInstanceId: { not: null } };
  const clauses: Prisma.CaseTaskWhereInput[] = [];
  if (p.creators.length) clauses.push({ createdBy: { in: p.creators } });
  if (p.templates.length)
    clauses.push({ sopInstance: { templateVersion: { template: { OR: p.templates } } } });
  if (['sop.task.read', 'sop.task.execute', 'sop.report.read', 'sop.report.submit', 'sop.guidance.read', 'sop.guidance.create', 'sop.material.read', 'sop.material.manage'].includes(permission)) {
    const now = new Date();
    const stamp=await employmentStamp(db,ctx.userId,now);
    clauses.push({
      sopAccesses: {
        some: {
          principalUserId: ctx.userId,
          employmentStamp:stamp??'INVALID',
          revokedAt: null,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          ...(['sop.task.execute','sop.report.submit','sop.guidance.create','sop.material.manage'].includes(permission) ? { canExecute: true } : {}),
        },
      },
    });
  }
  return { sopInstanceId: { not: null }, OR: clauses.length ? clauses : [{ id: { in: [] } }] };
}
export async function requireSopTask(
  db: SopDatabase,
  ctx: AuthorizationContext,
  id: string,
  permission: PermissionCode,
) {
  const row = await db.caseTask.findFirst({
    where: { AND: [{ id }, await sopTaskScope(db, ctx, permission)] },
    include: { sopInstance: { include: { templateVersion: { include: { template: true } } } } },
  });
  if (!row || !row.sopInstance) sopFail('SOP_TASK_NOT_FOUND', 404);
  return row!;
}
export async function requireSopInstance(
  db: SopDatabase,
  ctx: AuthorizationContext,
  id: string,
  permission: PermissionCode,
) {
  const row = await db.sopInstance.findFirst({
    where: { AND: [{ id }, await sopInstanceScope(db, ctx, permission)] },
    include: { templateVersion: { include: { template: true } } },
  });
  if (!row) sopFail('SOP_INSTANCE_NOT_FOUND', 404);
  return row!;
}
