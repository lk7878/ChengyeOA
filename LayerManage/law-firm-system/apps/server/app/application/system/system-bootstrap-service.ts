import { Prisma, PrismaClient } from '@prisma/client';
import { PasswordHasher } from '../../domain/security/password-hasher';
import { normalizeUsername, validatePassword, validateUsername } from '../../domain/security/password-policy';
import { applicationTableCounts } from '../../../scripts/db/assert-empty-application-tables';
import { AuditWriter, writeAuditLog } from './audit-writer';
import {
  AlreadyInitializedError,
  InconsistentSystemStateError,
  ValidationCommandError,
} from './system-command-errors';

const INITIALIZATION_ID = 'PRIMARY';
const INITIALIZATION_VERSION = 1;
const BOOTSTRAP_LOCK_KEY = 2036071502;

export interface BootstrapInput {
  organizationName: string;
  username: string;
  password: string;
}

export interface BootstrapResult {
  organizationName: string;
  username: string;
}

export interface SystemCommandMetadata {
  databaseName: string;
  hostname: string;
}

export type { AuditWriter } from './audit-writer';

export class SystemBootstrapService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly hasher: PasswordHasher,
    private readonly metadata: SystemCommandMetadata,
    private readonly auditWriter: AuditWriter = writeAuditLog,
  ) {}

  async execute(input: BootstrapInput): Promise<BootstrapResult> {
    const normalized = normalizeBootstrapInput(input);
    const passwordHash = await this.hasher.hash(normalized.password);

    try {
      await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`;

        const initialized = await tx.systemInitialization.findUnique({ where: { id: INITIALIZATION_ID } });
        if (initialized) {
          throw new AlreadyInitializedError('System is already initialized');
        }

        const counts = await applicationTableCounts(tx);
        if (counts.some(item => item.count !== 0)) {
          throw new InconsistentSystemStateError('Application data exists without initialization');
        }

        const organization = await tx.organization.create({
          data: {
            name: normalized.organizationName,
            type: 'FIRM',
            parentId: null,
            status: 'ENABLED',
          },
        });
        const role = await tx.role.create({
          data: {
            name: '系统超级管理员',
            code: 'SYSTEM_SUPER_ADMIN',
            type: 'SYSTEM',
            status: 'ENABLED',
          },
        });
        const user = await tx.user.create({
          data: {
            username: normalized.username,
            password: passwordHash,
            status: 'ENABLED',
            employeeId: null,
            mustChangePassword: true,
            credentialVersion: 1,
            passwordChangedAt: null,
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
        await tx.systemInitialization.create({
          data: {
            id: INITIALIZATION_ID,
            version: INITIALIZATION_VERSION,
            rootOrganizationId: organization.id,
            superAdminUserId: user.id,
            completedAt: new Date(),
          },
        });
        await this.auditWriter(tx, {
          userId: null,
          action: 'SYSTEM_BOOTSTRAP',
          targetType: 'SYSTEM_INITIALIZATION',
          targetId: INITIALIZATION_ID,
          newValues: JSON.stringify({
            initializationVersion: INITIALIZATION_VERSION,
            rootOrganizationId: organization.id,
            superAdminUserId: user.id,
            databaseName: this.metadata.databaseName,
            hostname: this.metadata.hostname,
          }),
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isSerializableBootstrapRace(error) && await this.isInitialized()) {
        throw new AlreadyInitializedError('System is already initialized');
      }
      throw error;
    }

    return {
      organizationName: normalized.organizationName,
      username: normalized.username,
    };
  }

  private async isInitialized(): Promise<boolean> {
    return (await this.prisma.systemInitialization.findUnique({ where: { id: INITIALIZATION_ID } })) !== null;
  }
}

function isSerializableBootstrapRace(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

function normalizeBootstrapInput(input: BootstrapInput): BootstrapInput {
  if (!input || typeof input.organizationName !== 'string' || typeof input.username !== 'string' || typeof input.password !== 'string') {
    throw new ValidationCommandError('Bootstrap input is invalid');
  }

  const organizationName = input.organizationName.trim();
  const username = normalizeUsername(input.username);

  try {
    if (organizationName.length < 2 || organizationName.length > 100) {
      throw new Error('ORGANIZATION_NAME_INVALID');
    }
    validateUsername(username);
    validatePassword(input.password, username);
  } catch {
    throw new ValidationCommandError('Bootstrap input is invalid');
  }

  return { organizationName, username, password: input.password };
}
