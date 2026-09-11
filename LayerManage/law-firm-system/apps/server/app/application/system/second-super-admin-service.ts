import { Prisma, PrismaClient, User, UserRole } from '@prisma/client';
import { PasswordHasher } from '../../domain/security/password-hasher';
import { normalizeUsername } from '../../domain/security/password-policy';
import { SecurityError } from '../../domain/security/security-errors';
import { AuditWriter, writeAuditLog } from './audit-writer';
import {
  InconsistentSystemStateError,
  RecoveryWindowUnavailableError,
  ValidationCommandError,
} from './system-command-errors';
import { SystemCommandMetadata } from './system-bootstrap-service';

const INITIALIZATION_ID = 'PRIMARY';
const SUPER_ADMIN_ROLE_CODE = 'SYSTEM_SUPER_ADMIN';
const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;
const RECOVERY_ADVISORY_LOCK = 47392005;

export interface AddSecondSuperAdminInput {
  actorUsername: string;
  actorPassword: string;
  targetUsername: string;
  reason: string;
  confirmation: string;
}

export interface AddSecondSuperAdminResult {
  actorUsername: string;
  targetUsername: string;
}

interface ActorSnapshot {
  id: string;
  password: string;
  credentialVersion: number;
  status: string;
  grantId: string;
  grantVersion: number;
}

export class SecondSuperAdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly hasher: PasswordHasher,
    private readonly metadata: SystemCommandMetadata,
    private readonly clock: () => Date = () => new Date(),
    private readonly auditWriter: AuditWriter = writeAuditLog,
  ) {}

  async execute(raw: AddSecondSuperAdminInput): Promise<AddSecondSuperAdminResult> {
    const input = normalizeInput(raw, this.metadata.databaseName);
    const now = this.clock();
    const snapshot = await this.verifySoleActor(input.actorUsername, input.actorPassword, now);

    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
        SELECT 1::int AS "locked"
        FROM (SELECT pg_advisory_xact_lock(${RECOVERY_ADVISORY_LOCK})) AS recovery_lock
      `);
      const initialization = await tx.systemInitialization.findUnique({ where: { id: INITIALIZATION_ID } });
      if (!initialization) inconsistent();
      const role = await tx.role.findUnique({ where: { code: SUPER_ADMIN_ROLE_CODE } });
      if (!role || role.type !== 'SYSTEM' || role.status !== 'ENABLED') inconsistent();

      const active = await effectiveSuperAdmins(tx, role.id, now);
      if (active.length !== 1 || active[0].user.id !== snapshot.id) windowUnavailable();
      const actor = active[0].user;
      const actorGrant = active[0];
      if (
        actor.status !== snapshot.status
        || actor.password !== snapshot.password
        || actor.credentialVersion !== snapshot.credentialVersion
        || actorGrant.id !== snapshot.grantId
        || actorGrant.version !== snapshot.grantVersion
      ) {
        windowUnavailable();
      }

      const target = await tx.user.findUnique({ where: { username: input.targetUsername } });
      if (!target || target.status !== 'ENABLED' || isLocked(target, now) || target.id === actor.id) invalid();
      const existing = await tx.userRole.findFirst({ where: {
        userId: target.id,
        roleId: role.id,
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      } });
      if (existing) windowUnavailable();

      await tx.userRole.create({ data: {
        userId: target.id,
        roleId: role.id,
        source: 'RECOVERY',
        validFrom: now,
        reason: input.reason,
        grantedByUserId: actor.id,
      } });
      await this.auditWriter(tx, {
        userId: actor.id,
        action: 'SUPER_ADMIN_SECOND_SEAT_RECOVERY',
        targetType: 'USER',
        targetId: target.id,
        newValues: JSON.stringify({
          targetUserId: target.id,
          reason: input.reason,
          hostname: this.metadata.hostname,
          result: 'SUCCESS',
        }),
      });
      return { actorUsername: input.actorUsername, targetUsername: input.targetUsername };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async verifySoleActor(
    actorUsername: string,
    actorPassword: string,
    now: Date,
  ): Promise<ActorSnapshot> {
    const initialization = await this.prisma.systemInitialization.findUnique({ where: { id: INITIALIZATION_ID } });
    if (!initialization) inconsistent();
    const role = await this.prisma.role.findUnique({ where: { code: SUPER_ADMIN_ROLE_CODE } });
    if (!role || role.type !== 'SYSTEM' || role.status !== 'ENABLED') inconsistent();
    const active = await effectiveSuperAdmins(this.prisma, role.id, now);
    const actorEntry = active.find(item => item.user.username === actorUsername);
    if (active.length !== 1 || !actorEntry || actorEntry.user.id !== initialization.superAdminUserId) {
      windowUnavailable();
    }
    if (!await this.hasher.compare(actorPassword, actorEntry.user.password)) {
      throw new SecurityError('AUTHENTICATION_FAILED', 401);
    }
    return {
      id: actorEntry.user.id,
      password: actorEntry.user.password,
      credentialVersion: actorEntry.user.credentialVersion,
      status: actorEntry.user.status,
      grantId: actorEntry.id,
      grantVersion: actorEntry.version,
    };
  }
}

type EffectiveGrant = UserRole & { user: User };

function effectiveSuperAdmins(
  db: PrismaClient | Prisma.TransactionClient,
  roleId: string,
  now: Date,
): Promise<EffectiveGrant[]> {
  return db.userRole.findMany({
    where: {
      roleId,
      revokedAt: null,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      user: {
        status: 'ENABLED',
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
    },
    include: { user: true },
    orderBy: { id: 'asc' },
  });
}

function normalizeInput(
  input: AddSecondSuperAdminInput,
  databaseName: string,
): AddSecondSuperAdminInput {
  if (!input
    || typeof input.actorUsername !== 'string'
    || typeof input.actorPassword !== 'string'
    || typeof input.targetUsername !== 'string'
    || typeof input.reason !== 'string'
    || typeof input.confirmation !== 'string') invalid();
  const actorUsername = normalizeUsername(input.actorUsername);
  const targetUsername = normalizeUsername(input.targetUsername);
  const reason = input.reason.trim();
  if (input.actorPassword.length === 0 || reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    invalid();
  }
  const expectedConfirmation = `ADD SECOND SUPER ADMIN ${databaseName} ${targetUsername}`;
  if (input.confirmation !== expectedConfirmation) invalid();
  return { actorUsername, actorPassword: input.actorPassword, targetUsername, reason, confirmation: input.confirmation };
}

function isLocked(user: Pick<User, 'lockedUntil'>, now: Date): boolean {
  return user.lockedUntil !== null && user.lockedUntil > now;
}

function invalid(): never { throw new ValidationCommandError('Second super-admin recovery input is invalid'); }
function inconsistent(): never { throw new InconsistentSystemStateError('System initialization is inconsistent'); }
function windowUnavailable(): never { throw new RecoveryWindowUnavailableError('Second super-admin recovery window is not available'); }
