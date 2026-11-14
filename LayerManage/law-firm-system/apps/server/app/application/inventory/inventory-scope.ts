import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import {
  buildOrganizationScopeWhere,
  buildEmployeeScopeWhere,
} from '../authorization/resource-scope-resolvers';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { creatorIdsInOrganizations } from '../authorization/creator-organization';

export type InventorySource = 'items' | 'movements' | 'stocktakes';
export interface InventoryScope {
  id?: { in: string[] };
  OR?: InventoryScope[];
  createdBy?: { in: string[] };
  item?: { createdBy: { in: string[] } };
}
export async function inventoryScope(
  db: PrismaClient,
  context: AuthorizationContext,
  permission: PermissionCode,
  source: InventorySource,
): Promise<InventoryScope> {
  const auth = new AuthorizationService(new DataScopeService(db));
  auth.requireAction(context, permission);
  const resolved = await auth.resolveScopeTargets(context, 'inventory', permission);
  if (resolved.all) return {};
  const clauses: InventoryScope[] = [];
  if (resolved.employeeIds.length) {
    const users = await db.user.findMany({
      where: { employeeId: { in: resolved.employeeIds } },
      select: { id: true },
    });
    if (users.length) clauses.push({ createdBy: { in: users.map((u) => u.id) } });
  }
  if (resolved.organizationTargets.length) {
    const orgs = await db.organization.findMany({
      where: buildOrganizationScopeWhere(resolved),
      select: { id: true },
    });
    const creators = await creatorIdsInOrganizations(
      db,
      orgs.map((o) => o.id),
    );
    if (creators.length)
      clauses.push(
        source === 'items' ? { createdBy: { in: creators } } : { item: { createdBy: { in: creators } } },
      );
  }
  return clauses.length ? { OR: clauses } : { id: { in: [] } };
}
export async function inventoryRecipientScope(
  db: PrismaClient,
  context: AuthorizationContext,
): Promise<Prisma.EmployeeWhereInput> {
  const auth = new AuthorizationService(new DataScopeService(db));
  auth.requireAction(context, 'inventory.outbound');
  const resolved = await auth.resolveScopeTargets(context, 'inventory', 'inventory.outbound');
  return buildEmployeeScopeWhere(resolved);
}
