import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationError, AUTHORIZATION_CODES, authorizationInputError } from '../../domain/authorization/authorization-errors';
import { assertAuthorizationExactKeys } from '../../domain/authorization/authorization-validation';
import { normalizeName } from '../../domain/master-data/master-data-validation';
import { writeAuthorizationAudit } from './authorization-audit';

const STANDARD_SCOPE_TYPES = new Set(['ALL', 'HQ_SCOPE', 'ORG', 'BRANCH', 'TEAM', 'SELF_AND_SUBORDINATES', 'SELF']);

const SCOPE_SELECT = Prisma.validator<Prisma.DataScopeSelect>()({
  id: true,
  name: true,
  scopeType: true,
  includeDescendants: true,
  organization: { select: { id: true, name: true } },
  professionalTeam: { select: { id: true, name: true } },
});

export type DataScopeCatalogView = Prisma.DataScopeGetPayload<{ select: typeof SCOPE_SELECT }>;

interface Actor {
  userId: string;
  isSystemSuperAdmin: boolean;
  ip?: string;
}

export class DataScopeCatalogService {
  constructor(private readonly prisma: PrismaClient, private readonly actor: Actor) {}

  list(): Promise<DataScopeCatalogView[]> {
    return this.prisma.dataScope.findMany({
      where: { status: 'ENABLED' },
      select: SCOPE_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async create(input: unknown): Promise<DataScopeCatalogView> {
    if (!this.actor.isSystemSuperAdmin) {
      throw new AuthorizationError(AUTHORIZATION_CODES.escalation, 403);
    }
    assertAuthorizationExactKeys(input, [
      'name', 'scopeType', 'includeDescendants', 'organizationId', 'professionalTeamId',
    ]);
    if (typeof input.scopeType !== 'string' || !STANDARD_SCOPE_TYPES.has(input.scopeType)) authorizationInputError();
    if (typeof input.includeDescendants !== 'boolean') authorizationInputError();
    const scopeType = input.scopeType;
    const includeDescendants = input.includeDescendants;
    const name = normalizeScopeName(input.name);
    const organizationId = nullableIdentifier(input.organizationId);
    const professionalTeamId = nullableIdentifier(input.professionalTeamId);
    validateShape(scopeType, organizationId, professionalTeamId);

    return this.prisma.$transaction(async tx => {
      if (organizationId) {
        const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true, status: true } });
        if (!organization || organization.status !== 'ENABLED') objectNotFound();
        if (scopeType === 'BRANCH' && organization.type !== 'BRANCH') authorizationInputError();
      }
      if (professionalTeamId) {
        const team = await tx.professionalTeam.findUnique({ where: { id: professionalTeamId }, select: { status: true } });
        if (!team || team.status !== 'ENABLED') objectNotFound();
      }
      const created = await tx.dataScope.create({
        data: { name, scopeType, includeDescendants, organizationId, professionalTeamId },
      });
      const view = await tx.dataScope.findUniqueOrThrow({ where: { id: created.id }, select: SCOPE_SELECT });
      await writeAuthorizationAudit(tx, {
        actorUserId: this.actor.userId,
        action: 'CREATE_DATA_SCOPE',
        targetType: 'DATA_SCOPE',
        targetId: view.id,
        changes: { scopeType: view.scopeType, organizationId, professionalTeamId, includeDescendants: view.includeDescendants },
        ip: this.actor.ip,
      });
      return view;
    });
  }
}

function validateShape(scopeType: string, organizationId: string | null, professionalTeamId: string | null) {
  if (scopeType === 'ORG' || scopeType === 'BRANCH') {
    if (!organizationId || professionalTeamId) authorizationInputError();
    return;
  }
  if (scopeType === 'TEAM') {
    if (!professionalTeamId || organizationId) authorizationInputError();
    return;
  }
  if (organizationId || professionalTeamId) authorizationInputError();
}

function nullableIdentifier(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') authorizationInputError();
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) authorizationInputError();
  return normalized;
}

function normalizeScopeName(value: unknown): string {
  try { return normalizeName(value); } catch { return authorizationInputError(); }
}

function objectNotFound(): never {
  throw new AuthorizationError(AUTHORIZATION_CODES.objectNotFound, 404);
}
