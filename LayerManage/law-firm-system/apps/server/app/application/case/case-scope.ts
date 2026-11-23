import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { creatorIdsInOrganizations } from '../authorization/creator-organization';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { projectCaseFile, type CaseView } from './case-types';
import { CaseError, CASE_ERROR_CODES } from '../../domain/case/case-errors';

/** Ownership follows the creator. Worksheet read/update includes personally assigned lead cases; other actions keep their existing scope. */
export async function buildCaseScopeWhere(
  db: PrismaClient,
  actor: AuthorizationContext,
  permission: PermissionCode,
  reader: Prisma.TransactionClient = db,
  options: { includeWorksheetLead?: boolean } = {},
): Promise<Prisma.CaseWhereInput> {
  const authorization = new AuthorizationService(new DataScopeService(db));
  authorization.requireAction(actor, permission);
  const resolved = await authorization.resolveScopeTargets(actor, 'case', permission);
  if (resolved.all) return { deletedAt: null };
  const clauses: Prisma.CaseWhereInput[] = [];
  if (options.includeWorksheetLead && ['case.read', 'case.update'].includes(permission) && actor.employeeId && resolved.employeeIds.includes(actor.employeeId)) {
    clauses.push({ lawyerId: actor.employeeId });
  }
  if (resolved.employeeIds.length) {
    const users = await reader.user.findMany({
      where: { employeeId: { in: resolved.employeeIds } },
      select: { id: true },
    });
    if (users.length) clauses.push({ createdBy: { in: users.map((user) => user.id) } });
  }
  if (resolved.organizationTargets.length) {
    const organizations = await reader.organization.findMany({
      where: buildOrganizationScopeWhere(resolved),
      select: { id: true },
    });
    if (organizations.length) clauses.push({ branchId: { in: organizations.map((org) => org.id) } });
    const creators = await creatorIdsInOrganizations(reader, organizations.map((org) => org.id));
    if (creators.length) clauses.push({ branchId: null, createdBy: { in: creators } });
  }
  if (resolved.professionalTeamIds.length) {
    // Legacy teamIds is JSON stored as text. Parse candidates strictly; malformed rows grant nothing.
    const candidates = await reader.case.findMany({
      where: {
        OR: resolved.professionalTeamIds.map((id) => ({ teamIds: { contains: JSON.stringify(id) } })),
      },
      select: { id: true, teamIds: true },
    });
    const ids = candidates
      .filter((row) => {
        try {
          const teams: unknown = JSON.parse(row.teamIds || 'null');
          return (
            Array.isArray(teams) &&
            teams.every((id) => typeof id === 'string') &&
            teams.some((id) => resolved.professionalTeamIds.includes(id))
          );
        } catch {
          return false;
        }
      })
      .map((row) => row.id);
    if (ids.length) clauses.push({ id: { in: ids } });
  }
  return { deletedAt: null, ...(clauses.length ? { OR: clauses } : { id: { in: [] } }) };
}

export async function requireCaseAccess(
  db: PrismaClient,
  actor: AuthorizationContext,
  id: string,
  permission: PermissionCode,
  tx: Prisma.TransactionClient = db,
  options: { includeWorksheetLead?: boolean } = {},
) {
  const where = await buildCaseScopeWhere(db, actor, permission, tx, options);
  const row = await tx.case.findFirst({ where: { AND: [where, { id }] } });
  if (!row) throw new CaseError(CASE_ERROR_CODES.CASE_NOT_FOUND, 404, 'case not found');
  return row;
}

/** File metadata is subject to the file-read scope, which may be narrower than case-read. */
export async function withAuthorizedCaseFiles(
  db: PrismaClient,
  actor: AuthorizationContext,
  rows: CaseView[],
) {
  if (!rows.length || !actor.permissionCodes.includes('case.file.read')) return rows;
  const cases = await db.case.findMany({
    where: {
      AND: [
        { id: { in: rows.map((row) => row.id) } },
        await buildCaseScopeWhere(db, actor, 'case.file.read'),
      ],
    },
    select: { id: true },
  });
  const allowed = new Set(cases.map((row) => row.id));
  const files = await db.caseFile.findMany({
    where: { caseId: { in: [...allowed] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  return rows.map((row) => ({
    ...row,
    ...(allowed.has(row.id)
      ? { files: files.filter((file) => file.caseId === row.id).map(projectCaseFile) }
      : {}),
  }));
}
