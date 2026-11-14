import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationError, AUTHORIZATION_CODES } from '../../domain/authorization/authorization-errors';
import { PermissionCode, ResourceCode } from '../../domain/authorization/authorization-types';
import { AuthorizationContext } from './authorization-service';
import {
  RESOURCE_SCOPE_RESOLVERS,
  ResourceWhereMap,
  ScopeResolutionInput,
  ScopeableResourceCode,
  buildEmployeeScopeWhere,
  buildProfessionalTeamScopeWhere,
  buildOrganizationScopeWhere,
} from './resource-scope-resolvers';

export class DataScopeService {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async buildScopeWhere<R extends ScopeableResourceCode>(
    context: AuthorizationContext,
    resource: R,
    permissionCode: PermissionCode,
  ): Promise<ResourceWhereMap[R]> {
    const input = await this.resolve(context, resource, permissionCode);
    return RESOURCE_SCOPE_RESOLVERS[resource].buildWhere(input);
  }

  async requireRecord<R extends ScopeableResourceCode>(
    context: AuthorizationContext,
    resource: R,
    permissionCode: PermissionCode,
    id: string,
  ): Promise<string> {
    const where = await this.buildScopeWhere(context, resource, permissionCode);
    const recordId = await RESOURCE_SCOPE_RESOLVERS[resource].findAuthorizedId(this.prisma, where, id);
    if (!recordId) throw new AuthorizationError(AUTHORIZATION_CODES.hidden, 404);
    return recordId;
  }

  async buildOrganizationTargetWhere(
    context: AuthorizationContext,
    resource: ResourceCode,
    permissionCode: PermissionCode,
  ): Promise<Prisma.OrganizationWhereInput> {
    return buildOrganizationScopeWhere(await this.resolve(context, resource, permissionCode));
  }

  async buildEmployeeTargetWhere(
    context: AuthorizationContext,
    resource: ResourceCode,
    permissionCode: PermissionCode,
  ): Promise<Prisma.EmployeeWhereInput> {
    return buildEmployeeScopeWhere(await this.resolve(context, resource, permissionCode));
  }

  async buildProfessionalTeamTargetWhere(
    context: AuthorizationContext,
    resource: ResourceCode,
    permissionCode: PermissionCode,
  ): Promise<Prisma.ProfessionalTeamWhereInput> {
    return buildProfessionalTeamScopeWhere(await this.resolve(context, resource, permissionCode));
  }

  /**
   * 原始范围解析结果（组织目标/团队 id/员工 id 三分量）。
   * 供无法套用 RESOURCE_SCOPE_RESOLVERS 锚定模式的资源（如 lead 锚定自身
   * branchId/professionalTeamId/assignedTo 列）按分量自行组装 where；
   * 语义与 combine() 一致：all=true 表示不过滤，空分量表示该维度无授权目标。
   */
  async resolveScopeTargets(
    context: AuthorizationContext,
    resource: ResourceCode,
    permissionCode: PermissionCode,
  ): Promise<ScopeResolutionInput> {
    return this.resolve(context, resource, permissionCode);
  }

  private async resolve(
    context: AuthorizationContext,
    resource: ResourceCode,
    permissionCode: PermissionCode,
  ): Promise<ScopeResolutionInput> {
    const grants = context.grants.filter(grant => (
      grant.resource === resource && grant.permissionCode === permissionCode
    ));
    const scopeIds = [...new Set(grants.flatMap(grant => grant.scopeIds))];
    if (scopeIds.includes('ALL')) return emptyResolution(context, true);
    if (scopeIds.length === 0) return emptyResolution(context, false);

    const scopes = await this.prisma.dataScope.findMany({
      where: { id: { in: scopeIds }, status: 'ENABLED' },
      select: {
        scopeType: true,
        includeDescendants: true,
        organization: { select: { id: true, path: true, type: true, status: true } },
        professionalTeam: { select: { id: true, status: true } },
        targets: {
          select: {
            organization: { select: { id: true, path: true, status: true } },
            professionalTeam: { select: { id: true, status: true } },
            employee: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (scopes.some(scope => scope.scopeType === 'ALL')) return emptyResolution(context, true);
    const hqRequested = scopes.some(scope => scope.scopeType === 'HQ_SCOPE');
    const subordinateRequested = scopes.some(scope => scope.scopeType === 'SELF_AND_SUBORDINATES');
    const [hqTargets, subordinateIds] = await Promise.all([
      hqRequested ? this.resolveHqTargets() : Promise.resolve([]),
      subordinateRequested && context.employeeId
        ? this.resolveSubordinates(context.employeeId, context.evaluatedAt)
        : Promise.resolve([]),
    ]);

    const resolution = emptyResolution(context, false);
    resolution.organizationTargets.push(...hqTargets);
    if(scopeIds.includes('worksheet:self') && context.employeeId) resolution.employeeIds.push(context.employeeId);
    if(scopeIds.includes('worksheet:department') && context.employeeId) {
      const assignments=await this.prisma.employeeAssignment.findMany({where:{employeeId:context.employeeId,startedAt:{lte:context.evaluatedAt},
        OR:[{endedAt:null},{endedAt:{gt:context.evaluatedAt}}],organization:{status:'ENABLED'}},select:{organization:{select:{path:true}}}});
      resolution.organizationTargets.push(...assignments.map(a=>({path:a.organization.path,includeDescendants:false})));
    }
    for (const scope of scopes) {
      if ((scope.scopeType === 'ORG' || scope.scopeType === 'BRANCH')
        && scope.organization?.status === 'ENABLED') {
        resolution.organizationTargets.push({
          path: scope.organization.path,
          includeDescendants: scope.scopeType === 'BRANCH' || scope.includeDescendants,
        });
      } else if (scope.scopeType === 'TEAM' && scope.professionalTeam?.status === 'ENABLED') {
        resolution.professionalTeamIds.push(scope.professionalTeam.id);
      } else if (scope.scopeType === 'SELF' && context.employeeId) {
        resolution.employeeIds.push(context.employeeId);
      } else if (scope.scopeType === 'SELF_AND_SUBORDINATES' && context.employeeId) {
        resolution.employeeIds.push(context.employeeId, ...subordinateIds);
      } else if (scope.scopeType === 'CUSTOM') {
        for (const target of scope.targets) {
          if (target.organization?.status === 'ENABLED') {
            resolution.organizationTargets.push({ path: target.organization.path, includeDescendants: false });
          } else if (target.professionalTeam?.status === 'ENABLED') {
            resolution.professionalTeamIds.push(target.professionalTeam.id);
          } else if (target.employee && target.employee.status !== 'LEAVED') {
            resolution.employeeIds.push(target.employee.id);
          }
        }
      }
    }
    resolution.professionalTeamIds = unique(resolution.professionalTeamIds);
    resolution.employeeIds = unique(resolution.employeeIds);
    resolution.organizationTargets = uniqueBy(
      resolution.organizationTargets,
      target => `${target.path}:${target.includeDescendants}:${(target.excludedDescendantPaths ?? []).join(',')}`,
    );
    return resolution;
  }

  private async resolveHqTargets(): Promise<ScopeResolutionInput['organizationTargets']> {
    const centers = await this.prisma.organization.findMany({
      where: { type: 'HQ_CENTER', status: 'ENABLED' },
      select: { path: true },
    });
    if (centers.length === 0) return [];
    const branches = await this.prisma.organization.findMany({
      where: {
        type: 'BRANCH',
        status: 'ENABLED',
        OR: centers.map(center => ({ path: { startsWith: `${center.path}/` } })),
      },
      select: { path: true },
    });
    return centers.map(center => ({
      path: center.path,
      includeDescendants: true,
      excludedDescendantPaths: branches
        .filter(branch => branch.path.startsWith(`${center.path}/`))
        .map(branch => branch.path),
    }));
  }

  private async resolveSubordinates(managerEmployeeId: string, evaluatedAt: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ employeeId: string }>>(Prisma.sql`
      WITH RECURSIVE subordinate_tree AS (
        SELECT "employeeId"
        FROM employee_reporting_line
        WHERE "managerEmployeeId" = ${managerEmployeeId}
          AND "startedAt" <= ${evaluatedAt}
          AND ("endedAt" IS NULL OR "endedAt" > ${evaluatedAt})
        UNION
        SELECT line."employeeId"
        FROM employee_reporting_line line
        INNER JOIN subordinate_tree tree ON line."managerEmployeeId" = tree."employeeId"
        WHERE line."startedAt" <= ${evaluatedAt}
          AND (line."endedAt" IS NULL OR line."endedAt" > ${evaluatedAt})
      )
      SELECT "employeeId" FROM subordinate_tree
    `);
    return rows.map(row => row.employeeId);
  }
}

function emptyResolution(context: AuthorizationContext, all: boolean): ScopeResolutionInput {
  return {
    userId: context.userId,
    evaluatedAt: context.evaluatedAt,
    all,
    organizationTargets: [],
    professionalTeamIds: [],
    employeeIds: [],
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const itemKey = key(value);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}
