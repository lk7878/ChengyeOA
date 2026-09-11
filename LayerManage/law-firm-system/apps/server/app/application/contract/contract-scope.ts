// SPEC-010 Task 6: contract 模块数据范围共享助手（本任务先服务 Negotiation；Task 7/9 扩展复用）。
// Negotiation 范围锚（设计 §8 + 协调者裁决 4）：锚定谈案自身列——
//   SELF/员工维度 → negotiatorEmployeeId IN resolution.employeeIds 或 createdBy = context.userId
//                  （两锚同属一个员工维度谓词，OR 关系；resolution.employeeIds 含
//                    SELF_AND_SUBORDINATES/CUSTOM 员工目标，与 lead-scope 同语义）；
//   TEAM          → professionalTeamId IN resolution.professionalTeamIds；
//   BRANCH/ORG    → branchId IN 组织子树展开后的 id 集（复用 SPEC-009 lead-scope 展开模式：
//                   buildOrganizationScopeWhere 只读取 organizationTargets 分量）；
//   ALL           → 不过滤。
// 多范围取并集（OR）；解析为零目标的范围不贡献谓词；无任何谓词时返回 match-nothing（fail-closed）。
// 客户可见性（协调者裁决 2）：buildCustomerVisibilityWhere 镜像 customer-service
// buildCustomerScopeWhere 语义（Customer 无组织列——SELF→createdBy、TEAM→sourceLead.professionalTeamId、
// BRANCH/ORG→sourceLead.branchId 子树、ALL→不过滤），供 createNegotiation 以 customer.read
// 判定目标客户是否可寻址（不可见统一 404 不泄露）。
// Task 7 扩展：
//   buildContractScopeWhere —— 合同范围锚，与 negotiation 同构（沿 D4 形态：employeeIds 门
//     控 + createdBy 锚；Contract 无员工列，SELF 谓词即 { createdBy: context.userId }）；
//     TEAM→professionalTeamId、BRANCH/ORG→branchId 组织子树、零谓词 fail-closed。
//   buildCustomerVisibilityWhere 增加可选 resource 形参（缺省 'customer'，Task 6 调用零影响）——
//     createContract 按协调者裁决以 contract.create 动作级范围判定客户可寻址
//     （resource='contract' + permissionCode='contract.create'）。
// Task 9 扩展（自裁决 S15，沿 Task 7 S2 先例）：buildContractScopeWhere 增加可选 resource
//   形参（缺省 'contract'，Task 7/8 调用零影响）——ReceivableService 以 payment.* 动作级
//   范围锚定合同列（Payment 经 { contract: … } 包裹，设计 §8）。范围解析必须按授权上下
//   文 (resource, permissionCode) 双键过滤：payment.create 的目录 resource 为 'payment'，
//   若以缺省 'contract' 解析则 ('contract', 'payment.create') 恒空集 fail-closed（生产
//   loader 授予的 resource=catalog.resource——Task 7 S2 已钉死同一陷阱的customer变体）。

import { Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { PermissionCode, ResourceCode } from '../../domain/authorization/authorization-types';

/**
 * 谈案数据范围 where 构造：action 对应的授权范围锚定 Negotiation 自身列。
 * 语义对齐 resource-scope-resolvers 的 combine() 与 crm/lead-scope.ts。
 */
export async function buildNegotiationScopeWhere(
  prisma: PrismaClient,
  authorization: AuthorizationService,
  context: AuthorizationContext,
  permissionCode: PermissionCode,
): Promise<Prisma.NegotiationWhereInput> {
  const resolution = await authorization.resolveScopeTargets(
    context,
    'negotiation',
    permissionCode,
  );
  if (resolution.all) return {};

  const predicates: Prisma.NegotiationWhereInput[] = [];
  if (resolution.employeeIds.length > 0) {
    predicates.push({
      OR: [
        { negotiatorEmployeeId: { in: resolution.employeeIds } },
        { createdBy: context.userId },
      ],
    });
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

/**
 * 合同数据范围 where 构造：action 对应的授权范围锚定 Contract 自身列。
 * 与 buildNegotiationScopeWhere 同构；唯一差异是 Contract 无员工列，SELF 谓词
 * 仅 { createdBy: context.userId }（employeeIds 门控保留——SELF_AND_SUBORDINATES/
 * CUSTOM 员工目标因此与 negotiation 同语义启闭该锚）。
 * resource 形参（Task 9 扩展，缺省 'contract'，既有调用零影响）：payment.* 动作以
 * 自身 resource 解析范围目标、锚定合同列（设计 §8 Payment 经 contract 包裹）——
 * 与 Task 7 S2 buildCustomerVisibilityWhere 的 resource 形参同一形态同一理由。
 */
export async function buildContractScopeWhere(
  prisma: PrismaClient,
  authorization: AuthorizationService,
  context: AuthorizationContext,
  permissionCode: PermissionCode,
  resource: ResourceCode = 'contract',
): Promise<Prisma.ContractWhereInput> {
  const resolution = await authorization.resolveScopeTargets(
    context,
    resource,
    permissionCode,
  );
  if (resolution.all) return {};

  const predicates: Prisma.ContractWhereInput[] = [];
  if (resolution.employeeIds.length > 0) {
    predicates.push({ createdBy: context.userId });
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

/**
 * 客户可见性 where 构造：镜像 customer-service buildCustomerScopeWhere（customer-service.ts:535-562）
 * 语义。Customer 无组织列，锚定 createdBy 与 sourceLead 继承的组织列；sourceLeadId=null 的
 * 客户仅命中 SELF-createdBy 谓词与 ALL。调用方以
 * { AND: [visibilityWhere, { id, deletedAt: null }] } 判定目标客户是否可寻址。
 * resource 形参（Task 7 扩展，缺省 'customer'）：createContract 以 'contract' 解析
 * contract.create 动作级范围——操作者在合同资源上的范围目标决定可寻址客户集。
 */
export async function buildCustomerVisibilityWhere(
  prisma: PrismaClient,
  authorization: AuthorizationService,
  context: AuthorizationContext,
  permissionCode: PermissionCode,
  resource: ResourceCode = 'customer',
): Promise<Prisma.CustomerWhereInput> {
  const resolution = await authorization.resolveScopeTargets(
    context,
    resource,
    permissionCode,
  );
  if (resolution.all) return {};

  const predicates: Prisma.CustomerWhereInput[] = [];
  if (resolution.employeeIds.length > 0) {
    predicates.push({ createdBy: context.userId });
  }
  if (resolution.professionalTeamIds.length > 0) {
    predicates.push({ sourceLead: { professionalTeamId: { in: resolution.professionalTeamIds } } });
  }
  if (resolution.organizationTargets.length > 0) {
    // buildOrganizationScopeWhere 只读取 organizationTargets 分量（此处 all 必为 false）。
    const organizations = await prisma.organization.findMany({
      where: buildOrganizationScopeWhere(resolution),
      select: { id: true },
    });
    if (organizations.length > 0) {
      predicates.push({ sourceLead: { branchId: { in: organizations.map(organization => organization.id) } } });
    }
  }
  if (predicates.length === 0) return { id: { in: [] } };
  return { OR: predicates };
}
