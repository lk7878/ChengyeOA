import { Prisma } from '@prisma/client';
import { GOVERNANCE_CODES, GovernanceError } from '../../../domain/admin-governance/governance-errors';
import { GovernedOperationType } from '../../../domain/admin-governance/governance-types';
import {
  GovernedOperationAdapter,
  GovernanceExecutionOutcome,
  GovernanceExecutionRequest,
} from './governance-adapter';
import { resetAdministratorMfa } from '../../auth/administrator-mfa-reset';

type AdministratorOperationType =
  | 'SYSTEM_ADMIN_GRANT'
  | 'SYSTEM_ADMIN_REVOKE'
  | 'SYSTEM_ADMIN_ACCOUNT_DISABLE'
  | 'SUPER_ADMIN_GRANT'
  | 'SUPER_ADMIN_REVOKE'
  | 'SUPER_ADMIN_ACCOUNT_DISABLE'
  | 'ADMIN_MFA_RESET';
type RoleCode = 'SYSTEM_ADMIN' | 'SYSTEM_SUPER_ADMIN';

interface GrantPayload {
  validUntil: string | null;
}

interface LockedUser {
  id: string;
  username: string;
  status: string;
  credentialVersion: number;
}

interface LockedRole {
  id: string;
  code: RoleCode;
  type: string;
  status: string;
}

interface LockedGrant {
  id: string;
  validFrom: Date;
  validUntil: Date | null;
  revokedAt: Date | null;
  version: number;
}

const ADMINISTRATOR_OPERATIONS: ReadonlySet<GovernedOperationType> = new Set([
  'SYSTEM_ADMIN_GRANT',
  'SYSTEM_ADMIN_REVOKE',
  'SYSTEM_ADMIN_ACCOUNT_DISABLE',
  'SUPER_ADMIN_GRANT',
  'SUPER_ADMIN_REVOKE',
  'SUPER_ADMIN_ACCOUNT_DISABLE',
  'ADMIN_MFA_RESET',
]);
const MAXIMUM_TEMPORARY_GRANT_MS = 90 * 24 * 60 * 60 * 1000;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export class AdministratorAccountAdapter implements GovernedOperationAdapter {
  readonly key = 'administrator-account';

  constructor(private readonly clock: () => Date = () => new Date()) {}

  supports(operationType: GovernedOperationType): boolean {
    return ADMINISTRATOR_OPERATIONS.has(operationType);
  }

  validatePayload(operationType: GovernedOperationType, payload: unknown): Prisma.InputJsonValue {
    const type = this.requireSupported(operationType);
    if (isGrant(type)) {
      const input = exactPayload(payload, ['validUntil']);
      if (!Object.hasOwn(input, 'validUntil')) targetIneligible();
      if (input.validUntil === null) return { validUntil: null };
      if (typeof input.validUntil !== 'string' || !ISO_DATE_TIME.test(input.validUntil)) targetIneligible();
      const validUntil = new Date(input.validUntil);
      const duration = validUntil.getTime() - this.clock().getTime();
      if (!Number.isFinite(validUntil.getTime()) || duration <= 0 || duration > MAXIMUM_TEMPORARY_GRANT_MS) {
        targetIneligible();
      }
      return { validUntil: validUntil.toISOString() };
    }
    exactPayload(payload, []);
    return {};
  }

  async execute(
    tx: Prisma.TransactionClient,
    request: GovernanceExecutionRequest,
  ): Promise<GovernanceExecutionOutcome> {
    const operationType = this.requireSupported(request.operationType);
    const payload = this.validatePayload(operationType, request.payload);
    if (request.targetType !== 'USER') targetIneligible();
    if (!request.reviewerUserId) notAllowed();
    if (request.reviewerUserId === request.targetId) {
      throw new GovernanceError(GOVERNANCE_CODES.reviewTarget, 403);
    }
    if (operationType === 'ADMIN_MFA_RESET') {
      return this.resetMfa(tx, request);
    }
    const roleCode = roleCodeFor(operationType);
    const role = await lockRole(tx, roleCode);
    const user = await lockUser(tx, request.targetId);
    if (!user) hidden();
    if (user.credentialVersion !== request.expectedTargetVersion) staleTarget();
    if (user.status !== 'ENABLED' || !role || role.type !== 'SYSTEM' || role.status !== 'ENABLED') {
      targetIneligible();
    }
    const now = this.clock();
    const grants = await lockTargetRoleGrants(tx, user.id, role.id);

    if (isGrant(operationType)) {
      return this.grant(tx, request, operationType, user, role, grants, payload as unknown as GrantPayload, now);
    }
    const activeGrant = grants.find(grant => isGrantActive(grant, now));
    if (!activeGrant) targetIneligible();
    if (isSuperAdminOperation(operationType)) {
      await assertMoreThanOneEffectiveSuperAdmin(tx, role, now);
    }
    if (isRevoke(operationType)) {
      return this.revoke(tx, request, operationType, user, role, activeGrant, now);
    }
    return this.disable(tx, request, operationType, user, role);
  }

  private async resetMfa(
    tx: Prisma.TransactionClient,
    request: GovernanceExecutionRequest,
  ): Promise<GovernanceExecutionOutcome> {
    const user = await lockUser(tx, request.targetId);
    if (!user) hidden();
    if (user.credentialVersion !== request.expectedTargetVersion) staleTarget();
    if (user.status !== 'ENABLED') targetIneligible();
    const now = this.clock();
    const roleCode = await lockActiveAdministratorRole(tx, user.id, now);
    if (!roleCode) targetIneligible();
    await resetAdministratorMfa(tx, user.id, request.reviewerUserId!, 'GOVERNANCE', now);
    return {
      beforeSnapshot: snapshot(user, roleCode, 'ACTIVE'),
      afterSnapshot: snapshot(user, roleCode, 'ACTIVE'),
      resultCode: 'ADMIN_MFA_RESET',
    };
  }

  private async grant(
    tx: Prisma.TransactionClient,
    request: GovernanceExecutionRequest,
    operationType: AdministratorOperationType,
    user: LockedUser,
    role: LockedRole,
    grants: LockedGrant[],
    payload: GrantPayload,
    now: Date,
  ): Promise<GovernanceExecutionOutcome> {
    if (grants.some(grant => grant.revokedAt === null && (grant.validUntil === null || grant.validUntil > now))) {
      targetIneligible();
    }
    const validUntil = payload.validUntil === null ? null : new Date(payload.validUntil);
    try {
      await tx.userRole.create({ data: {
        userId: user.id,
        roleId: role.id,
        source: validUntil === null ? 'PERMANENT' : 'TEMPORARY',
        validFrom: now,
        validUntil,
        reason: governanceReason(request.operationId),
        grantedByUserId: request.reviewerUserId,
      } });
    } catch (error) {
      if (isGrantOverlap(error)) targetIneligible();
      throw error;
    }
    return {
      beforeSnapshot: snapshot(user, role.code, 'NONE'),
      afterSnapshot: snapshot(user, role.code, 'ACTIVE'),
      resultCode: resultCode(operationType),
    };
  }

  private async revoke(
    tx: Prisma.TransactionClient,
    request: GovernanceExecutionRequest,
    operationType: AdministratorOperationType,
    user: LockedUser,
    role: LockedRole,
    grant: LockedGrant,
    now: Date,
  ): Promise<GovernanceExecutionOutcome> {
    const changed = await tx.userRole.updateMany({
      where: { id: grant.id, version: grant.version, revokedAt: null },
      data: {
        revokedAt: now,
        revokedByUserId: request.reviewerUserId,
        revokeReason: governanceReason(request.operationId),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) staleTarget();
    return {
      beforeSnapshot: snapshot(user, role.code, 'ACTIVE'),
      afterSnapshot: snapshot(user, role.code, 'REVOKED'),
      resultCode: resultCode(operationType),
    };
  }

  private async disable(
    tx: Prisma.TransactionClient,
    request: GovernanceExecutionRequest,
    operationType: AdministratorOperationType,
    user: LockedUser,
    role: LockedRole,
  ): Promise<GovernanceExecutionOutcome> {
    const changed = await tx.user.updateMany({
      where: { id: user.id, status: 'ENABLED', credentialVersion: request.expectedTargetVersion },
      data: {
        status: 'DISABLED',
        credentialVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    if (changed.count !== 1) staleTarget();
    return {
      beforeSnapshot: snapshot(user, role.code, 'ACTIVE'),
      afterSnapshot: snapshot({ ...user, status: 'DISABLED' }, role.code, 'INACTIVE'),
      resultCode: resultCode(operationType),
    };
  }

  private requireSupported(operationType: GovernedOperationType): AdministratorOperationType {
    if (!this.supports(operationType)) notAllowed();
    return operationType as AdministratorOperationType;
  }
}

async function lockRole(tx: Prisma.TransactionClient, code: RoleCode): Promise<LockedRole | null> {
  const [role] = await tx.$queryRaw<LockedRole[]>`
    SELECT "id", "code", "type", "status"
    FROM "role"
    WHERE "code" = ${code}
    FOR UPDATE
  `;
  return role ?? null;
}

async function lockUser(tx: Prisma.TransactionClient, id: string): Promise<LockedUser | null> {
  const [user] = await tx.$queryRaw<LockedUser[]>`
    SELECT "id", "username", "status", "credentialVersion"
    FROM "user"
    WHERE "id" = ${id}
    FOR UPDATE
  `;
  return user ?? null;
}

function lockTargetRoleGrants(
  tx: Prisma.TransactionClient,
  userId: string,
  roleId: string,
): Promise<LockedGrant[]> {
  return tx.$queryRaw<LockedGrant[]>`
    SELECT "id", "validFrom", "validUntil", "revokedAt", "version"
    FROM "user_role"
    WHERE "userId" = ${userId} AND "roleId" = ${roleId}
    ORDER BY "id"
    FOR UPDATE
  `;
}

async function assertMoreThanOneEffectiveSuperAdmin(
  tx: Prisma.TransactionClient,
  role: LockedRole,
  now: Date,
): Promise<void> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT ur."id"
    FROM "user_role" ur
    JOIN "user" u ON u."id" = ur."userId"
    WHERE ur."roleId" = ${role.id}
      AND ur."revokedAt" IS NULL
      AND ur."validFrom" <= ${now}
      AND (ur."validUntil" IS NULL OR ur."validUntil" > ${now})
    ORDER BY ur."id"
    FOR UPDATE OF ur, u
  `;
  const effectiveCount = await tx.userRole.count({ where: {
    roleId: role.id,
    revokedAt: null,
    validFrom: { lte: now },
    OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    user: {
      status: 'ENABLED',
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
  } });
  if (effectiveCount <= 1) {
    throw new GovernanceError(GOVERNANCE_CODES.lastSuperAdmin, 409);
  }
}

function exactPayload(payload: unknown, keys: readonly string[]): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) targetIneligible();
  const input = payload as Record<string, unknown>;
  if (Object.keys(input).some(key => !keys.includes(key))) targetIneligible();
  return input;
}

function snapshot(
  user: Pick<LockedUser, 'id' | 'username' | 'status'>,
  roleCode: RoleCode,
  roleGrantState: 'NONE' | 'ACTIVE' | 'REVOKED' | 'INACTIVE',
): Prisma.InputJsonValue {
  return { userId: user.id, username: user.username, status: user.status, roleCode, roleGrantState };
}

function roleCodeFor(operationType: AdministratorOperationType): RoleCode {
  return operationType.startsWith('SYSTEM_ADMIN_') ? 'SYSTEM_ADMIN' : 'SYSTEM_SUPER_ADMIN';
}

async function lockActiveAdministratorRole(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<RoleCode | null> {
  const grants = await tx.$queryRaw<Array<{ code: RoleCode }>>(Prisma.sql`
    SELECT r."code"
    FROM "user_role" ur
    JOIN "role" r ON r."id" = ur."roleId"
    WHERE ur."userId" = ${userId}
      AND ur."revokedAt" IS NULL
      AND ur."validFrom" <= ${now}
      AND (ur."validUntil" IS NULL OR ur."validUntil" > ${now})
      AND r."code" IN ('SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN')
      AND r."status" = 'ENABLED'
    ORDER BY r."code", ur."id"
    FOR UPDATE OF ur, r
  `);
  return grants[0]?.code ?? null;
}

function isGrant(operationType: AdministratorOperationType): boolean {
  return operationType.endsWith('_GRANT');
}

function isRevoke(operationType: AdministratorOperationType): boolean {
  return operationType.endsWith('_REVOKE');
}

function isSuperAdminOperation(operationType: AdministratorOperationType): boolean {
  return operationType.startsWith('SUPER_ADMIN_');
}

function isGrantActive(grant: LockedGrant, now: Date): boolean {
  return grant.revokedAt === null
    && grant.validFrom <= now
    && (grant.validUntil === null || grant.validUntil > now);
}

function resultCode(operationType: AdministratorOperationType): string {
  return `${operationType.replace('_GRANT', '_GRANTED').replace('_REVOKE', '_REVOKED').replace('_ACCOUNT_DISABLE', '_ACCOUNT_DISABLED')}`;
}

function governanceReason(operationId: string): string {
  return `Governance operation ${operationId}`.slice(0, 500);
}

function isGrantOverlap(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2002' || error.code === 'P2004')
    || error instanceof Error && /overlap|exclusion|user_role_no_overlapping/i.test(error.message);
}

function notAllowed(): never {
  throw new GovernanceError(GOVERNANCE_CODES.notAllowed, 403);
}

function hidden(): never {
  throw new GovernanceError(GOVERNANCE_CODES.hidden, 404);
}

function targetIneligible(): never {
  throw new GovernanceError(GOVERNANCE_CODES.targetIneligible, 422);
}

function staleTarget(): never {
  throw new GovernanceError(GOVERNANCE_CODES.staleTarget, 409);
}
