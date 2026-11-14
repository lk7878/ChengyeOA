import { Prisma, PrismaClient } from '@prisma/client';
import { resetAdministratorMfa } from '../auth/administrator-mfa-reset';
import { PasswordHasher } from '../../domain/security/password-hasher';
import { normalizeUsername } from '../../domain/security/password-policy';
import { SecurityError } from '../../domain/security/security-errors';
import { AuditWriter, writeAuditLog } from './audit-writer';
import { RecoveryWindowUnavailableError, ValidationCommandError } from './system-command-errors';
import { SystemCommandMetadata } from './system-bootstrap-service';

const SUPER_ADMIN_ROLE_CODE = 'SYSTEM_SUPER_ADMIN';
const RECOVERY_ADVISORY_LOCK = 47392006;
const DUMMY_PASSWORD_HASH = 'chengye$bcrypt-sha256$v1$$2a$12$qOeCc6HkVowb3pPphggWdeP1K0WB6I8VddCxCKgOspC5YUTOXmvR.';

export interface AdminMfaRecoveryInput {
  username: string;
  password: string;
  confirmation: string;
}

export class AdminMfaRecoveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly hasher: PasswordHasher,
    private readonly metadata: SystemCommandMetadata,
    private readonly clock: () => Date = () => new Date(),
    private readonly auditWriter: AuditWriter = writeAuditLog,
  ) {}

  async execute(raw: AdminMfaRecoveryInput): Promise<{ username: string }> {
    const input = normalizeInput(raw, this.metadata.databaseName);
    const now = this.clock();
    const snapshot = await this.eligibleSoleSuperAdmin(input.username, now);
    const passwordMatches = await this.hasher.compare(
      input.password,
      snapshot?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (!snapshot) unavailable();
    if (!passwordMatches) throw new SecurityError('AUTHENTICATION_FAILED', 401);

    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`
        SELECT 1::int AS "locked"
        FROM (SELECT pg_advisory_xact_lock(${RECOVERY_ADVISORY_LOCK})) AS recovery_lock
      `);
      const current = await lockEligibleSuperAdmins(tx, now);
      if (
        current.length !== 1
        || current[0].id !== snapshot.id
        || current[0].username !== snapshot.username
        || current[0].password !== snapshot.password
        || current[0].credentialVersion !== snapshot.credentialVersion
      ) {
        unavailable();
      }
      await resetAdministratorMfa(
        tx,
        snapshot.id,
        snapshot.id,
        'RECOVERY',
        now,
        async (auditTx, audit) => this.auditWriter(auditTx, {
          ...audit,
          newValues: JSON.stringify({
            source: 'RECOVERY',
            hostname: this.metadata.hostname,
            result: 'SUCCESS',
          }),
        }),
      );
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { username: input.username };
  }

  private async eligibleSoleSuperAdmin(username: string, now: Date) {
    const active = await eligibleSuperAdmins(this.prisma, now);
    if (active.length !== 1 || active[0].username !== username) return null;
    return active[0];
  }
}

interface EligibleSuperAdmin {
  id: string;
  username: string;
  password: string;
  credentialVersion: number;
}

async function eligibleSuperAdmins(
  db: PrismaClient | Prisma.TransactionClient,
  now: Date,
): Promise<EligibleSuperAdmin[]> {
  const role = await db.role.findUnique({ where: { code: SUPER_ADMIN_ROLE_CODE } });
  if (!role || role.type !== 'SYSTEM' || role.status !== 'ENABLED') return [];
  const grants = await db.userRole.findMany({ where: {
    roleId: role.id,
    revokedAt: null,
    validFrom: { lte: now },
    OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    user: {
      status: 'ENABLED',
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
  }, include: { user: true }, orderBy: { id: 'asc' } });
  return grants.map(grant => ({
    id: grant.user.id,
    username: grant.user.username,
    password: grant.user.password,
    credentialVersion: grant.user.credentialVersion,
  }));
}

async function lockEligibleSuperAdmins(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<EligibleSuperAdmin[]> {
  await tx.$queryRaw(Prisma.sql`
    SELECT ur."id"
    FROM "user_role" ur
    JOIN "role" r ON r."id" = ur."roleId"
    JOIN "user" u ON u."id" = ur."userId"
    WHERE r."code" = ${SUPER_ADMIN_ROLE_CODE}
    ORDER BY ur."id"
    FOR UPDATE OF ur, r, u
  `);
  return eligibleSuperAdmins(tx, now);
}

function normalizeInput(input: AdminMfaRecoveryInput, databaseName: string): AdminMfaRecoveryInput {
  if (!input || typeof input !== 'object') invalid();
  const keys = Object.keys(input).sort();
  if (keys.join(',') !== 'confirmation,password,username') invalid();
  if (
    typeof input.username !== 'string'
    || typeof input.password !== 'string'
    || typeof input.confirmation !== 'string'
    || input.password.length === 0
  ) invalid();
  const username = normalizeUsername(input.username);
  if (input.confirmation !== `RESET ADMIN MFA ${databaseName} ${username}`) invalid();
  return { username, password: input.password, confirmation: input.confirmation };
}

function invalid(): never {
  throw new ValidationCommandError('Administrator MFA recovery input is invalid');
}

function unavailable(): never {
  throw new RecoveryWindowUnavailableError('Administrator MFA recovery window is unavailable');
}
