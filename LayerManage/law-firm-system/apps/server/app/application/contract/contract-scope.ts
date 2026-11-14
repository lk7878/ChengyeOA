// Creator-scoped CRM records resolve SELF/CUSTOM/subordinate employees to actual users.
// Organization/team branches remain unions; an empty resolution never grants access.
import { creatorIdsForEmployees, creatorIdsInOrganizations } from '../authorization/creator-organization';
import { Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { PermissionCode, ResourceCode } from '../../domain/authorization/authorization-types';

export async function buildNegotiationScopeWhere(
  prisma: PrismaClient,
  authorization: AuthorizationService,
  context: AuthorizationContext,
  permissionCode: PermissionCode,
): Promise<Prisma.NegotiationWhereInput> {
  const resolution = await authorization.resolveScopeTargets(context, 'negotiation', permissionCode);
  if (resolution.all) return {};

  const predicates: Prisma.NegotiationWhereInput[] = [];
  if (resolution.employeeIds.length > 0) {
    predicates.push({ createdBy: { in: await creatorIdsForEmployees(prisma, resolution.employeeIds) } });
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
      predicates.push({ branchId: { in: organizations.map((organization) => organization.id) } });
      const creators = await creatorIdsInOrganizations(
        prisma,
        organizations.map((organization) => organization.id),
      );
      if (creators.length) predicates.push({ branchId: null, createdBy: { in: creators } });
    }
  }
  if (predicates.length === 0) return { id: { in: [] } };
  return { OR: predicates };
}

export async function buildContractScopeWhere(
  prisma: PrismaClient,
  authorization: AuthorizationService,
  context: AuthorizationContext,
  permissionCode: PermissionCode,
  resource: ResourceCode = 'contract',
): Promise<Prisma.ContractWhereInput> {
  const resolution = await authorization.resolveScopeTargets(context, resource, permissionCode);
  if (resolution.all) return {};

  const predicates: Prisma.ContractWhereInput[] = [];
  if (resolution.employeeIds.length > 0) {
    predicates.push({ createdBy: { in: await creatorIdsForEmployees(prisma, resolution.employeeIds) } });
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
      predicates.push({ branchId: { in: organizations.map((organization) => organization.id) } });
      const creators = await creatorIdsInOrganizations(
        prisma,
        organizations.map((organization) => organization.id),
      );
      if (creators.length) predicates.push({ branchId: null, createdBy: { in: creators } });
    }
  }
  if (predicates.length === 0) return { id: { in: [] } };
  return { OR: predicates };
}

export async function buildCustomerVisibilityWhere(
  prisma: PrismaClient,
  authorization: AuthorizationService,
  context: AuthorizationContext,
  permissionCode: PermissionCode,
  resource: ResourceCode = 'customer',
): Promise<Prisma.CustomerWhereInput> {
  const resolution = await authorization.resolveScopeTargets(context, resource, permissionCode);
  if (resolution.all) return {};

  const predicates: Prisma.CustomerWhereInput[] = [];
  if (resolution.employeeIds.length > 0) {
    predicates.push({ createdBy: { in: await creatorIdsForEmployees(prisma, resolution.employeeIds) } });
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
      predicates.push({
        sourceLead: { branchId: { in: organizations.map((organization) => organization.id) } },
      });
      // Directly created customers have no lead. Use their creator's current
      // organization rather than making branch-scoped users lose their own customers.
      const creators = await creatorIdsInOrganizations(
        prisma,
        organizations.map((organization) => organization.id),
      );
      if (creators.length) predicates.push({ sourceLeadId: null, createdBy: { in: creators } });
    }
  }
  if (predicates.length === 0) return { id: { in: [] } };
  return { OR: predicates };
}
