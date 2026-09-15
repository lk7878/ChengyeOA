import { PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { PermissionCode } from '../../domain/authorization/authorization-types';
/** Shared structural subset of Payment/InvoiceRequest/RefundRequest Prisma where inputs. */
export interface FinancialRecordScope {
  id?: { in: string[] };
  OR?: FinancialRecordScope[];
  createdBy?: { in: string[] };
  contract?: { branchId?: { in: string[] }; professionalTeamId?: { in: string[] } };
}
export async function buildFinancialRecordScopeWhere(
  db: PrismaClient,
  authorization: AuthorizationService,
  actor: AuthorizationContext,
  permission: PermissionCode,
  resource: 'payment' | 'invoice' | 'refund',
): Promise<FinancialRecordScope> {
  authorization.requireAction(actor, permission);
  const resolved = await authorization.resolveScopeTargets(actor, resource, permission);
  if (resolved.all) return {};
  const clauses: FinancialRecordScope[] = [];
  if (resolved.employeeIds.length) {
    const users = await db.user.findMany({
      where: { employeeId: { in: resolved.employeeIds } },
      select: { id: true },
    });
    if (users.length) clauses.push({ createdBy: { in: users.map((user) => user.id) } });
  }
  if (resolved.professionalTeamIds.length)
    clauses.push({ contract: { professionalTeamId: { in: resolved.professionalTeamIds } } });
  if (resolved.organizationTargets.length) {
    const organizations = await db.organization.findMany({
      where: buildOrganizationScopeWhere(resolved),
      select: { id: true },
    });
    if (organizations.length)
      clauses.push({ contract: { branchId: { in: organizations.map((org) => org.id) } } });
  }
  return clauses.length ? { OR: clauses } : { id: { in: [] } };
}
