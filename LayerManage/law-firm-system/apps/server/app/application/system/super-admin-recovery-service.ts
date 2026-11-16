import { PrismaClient } from '@prisma/client';
import { PasswordHasher } from '../../domain/security/password-hasher';
import { normalizeUsername, validatePassword } from '../../domain/security/password-policy';
import { SecurityError } from '../../domain/security/security-errors';
import { AuditWriter, writeAuditLog } from './audit-writer';
import { SystemCommandMetadata } from './system-bootstrap-service';
import {
  InconsistentSystemStateError,
  RecoveryDisabledError,
  ValidationCommandError,
} from './system-command-errors';

const INITIALIZATION_ID = 'PRIMARY';
const SUPER_ADMIN_ROLE_CODE = 'SYSTEM_SUPER_ADMIN';
const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

export interface RecoveryInput {
  enabled: boolean;
  username: string;
  temporaryPassword: string;
  reason: string;
}

export interface RecoveryResult {
  username: string;
}

export class SuperAdminRecoveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly hasher: PasswordHasher,
    private readonly metadata: SystemCommandMetadata,
    private readonly auditWriter: AuditWriter = writeAuditLog,
  ) {}

  async execute(input: RecoveryInput): Promise<RecoveryResult> {
    if (input?.enabled !== true) {
      throw new RecoveryDisabledError('Super-admin recovery is disabled');
    }

    const normalizedInput = normalizeRecoveryInput(input);

    return this.prisma.$transaction(async tx => {
      const initialization = await tx.systemInitialization.findUnique({
        where: { id: INITIALIZATION_ID },
        select: { superAdminUserId: true },
      });
      if (!initialization) {
        throw new InconsistentSystemStateError('System initialization is missing');
      }

      const user = await tx.user.findUnique({
        where: { id: initialization.superAdminUserId },
        include: { userRoles: { include: { role: { select: { code: true } } } } },
      });
      if (!user || !user.userRoles.some(userRole => userRole.role.code === SUPER_ADMIN_ROLE_CODE)) {
        throw new InconsistentSystemStateError('Initialized super-admin trust root is inconsistent');
      }
      if (normalizeUsername(user.username) !== normalizedInput.username) {
        throw new ValidationCommandError('Recovery username does not match the initialized super-admin');
      }

      validatePassword(normalizedInput.temporaryPassword);
      if (await this.hasher.compare(normalizedInput.temporaryPassword, user.password)) {
        throw new SecurityError('PASSWORD_REUSED');
      }

      const password = await this.hasher.hash(normalizedInput.temporaryPassword);
      await tx.user.update({
        where: { id: user.id },
        data: {
          password,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          credentialVersion: { increment: 1 },
        },
      });
      await this.auditWriter(tx, {
        userId: null,
        action: 'SUPER_ADMIN_RECOVERY',
        targetType: 'USER',
        targetId: user.id,
        newValues: JSON.stringify({
          targetUserId: user.id,
          reason: normalizedInput.reason,
          hostname: this.metadata.hostname,
          result: 'SUCCESS',
        }),
      });

      return { username: normalizedInput.username };
    });
  }
}

function normalizeRecoveryInput(input: RecoveryInput): Omit<RecoveryInput, 'username' | 'reason'> & { username: string; reason: string } {
  if (
    !input
    || typeof input.username !== 'string'
    || typeof input.temporaryPassword !== 'string'
    || typeof input.reason !== 'string'
  ) {
    throw new ValidationCommandError('Recovery input is invalid');
  }

  const username = normalizeUsername(input.username);
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    throw new ValidationCommandError('Recovery reason is invalid');
  }

  return { enabled: true, username, temporaryPassword: input.temporaryPassword, reason };
}
