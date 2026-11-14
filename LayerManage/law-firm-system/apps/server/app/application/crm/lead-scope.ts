// SPEC-009 Task 6: lead 数据范围共享助手。
// 自 lead-service 私有方法 buildLeadScopeWhere 原样提取（行为不变），供 lead-service 与
// lead-assignment-service 共用（dispatch：池操作与 lead-service 同语义范围校验）。

import { Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { PermissionCode } from '../../domain/authorization/authorization-types';

/**
 * lead 数据范围（SPEC-009 设计 §1.2：branchId/professionalTeamId 用于数据范围隔离）：
 * 锚定线索**自身列**而非负责人归属——
 *   SELF/员工维度 → assignedTo IN resolution.employeeIds（含 SELF_AND_SUBORDINATES/CUSTOM 员工目标）；
 *   TEAM          → professionalTeamId IN resolution.professionalTeamIds；
 *   BRANCH/ORG    → branchId IN 组织子树展开后的 id 集（未分配公海线索因此对本所范围可见）；
 *   ALL           → 不过滤。
 * 多范围取并集（OR）；解析为零目标的范围不贡献谓词；无任何谓词时返回 match-nothing
 * （fail-closed）。语义对齐 resource-scope-resolvers 的 combine()。
 */
export async function buildLeadScopeWhere(
  prisma: PrismaClient,
  authorization: AuthorizationService,
  context: AuthorizationContext,
  permissionCode: PermissionCode,
): Promise<Prisma.LeadWhereInput> {
  const resolution = await authorization.resolveScopeTargets(
    context,
    'lead',
    permissionCode,
  );
  if (resolution.all) return {};

  const predicates: Prisma.LeadWhereInput[] = [];
  if (resolution.employeeIds.length > 0) {
    predicates.push({ assignedTo: { in: resolution.employeeIds } });
  }
  if (resolution.professionalTeamIds.length > 0) {
    predicates.push({ professionalTeamId: { in: resolution.professionalTeamIds } });
  }
  if (resolution.organizationTargets.length > 0) {
    // buildOrganizationScopeWhere 只读取 organizationTargets 分量（此处 all 必为 false）。
    const organizations = await prisma.organization.findMany({
      where: buildOrganizationScopeWhere(resolution),
      select: { id: true },
    });
    if (organizations.length > 0) {
      predicates.push({ branchId: { in: organizations.map(organization => organization.id) } });
    }
  }
  if (predicates.length === 0) return { id: { in: [] } };
  return { OR: predicates };
}
