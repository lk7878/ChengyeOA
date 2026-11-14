import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PasswordHasher } from '../../domain/security/password-hasher';
import { normalizeUsername, validateTemporaryPassword, validateUsername } from '../../domain/security/password-policy';
import { applicationTableCounts } from '../../../scripts/db/assert-empty-application-tables';
import { PERMISSION_CATALOG } from '../../domain/authorization/permission-catalog';
import { EVENT_SUBSCRIPTION_CATALOG } from '../../domain/events/event-subscription-catalog';
import { AuditWriter, writeAuditLog } from './audit-writer';
import {
  AlreadyInitializedError,
  InconsistentSystemStateError,
  ValidationCommandError,
} from './system-command-errors';

const INITIALIZATION_ID = 'PRIMARY';
const INITIALIZATION_VERSION = 1;
const BOOTSTRAP_LOCK_KEY = 2036071502;

/**
 * SPEC-022: PG C collation byte-order comparator aligned with `ORDER BY code` default semantics
 * (ASCII: `.`(46) < uppercase(65-90) < `_`(95) < lowercase(97-122)). Pure lexicographic order;
 * for ASCII permission/event codes it is byte-for-byte equivalent to PostgreSQL C collation,
 * unlike JS `localeCompare` which treats `_`/`.` differently.
 */
function compareByCodeC(left: { code: string }, right: { code: string }): number {
  return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
}

/**
 * SPEC-015 approval reviewer business roles. The approval_definition seeds
 * (LEAVE/SEAL/EXPENSE/CONTRACT_CHANGE/TRANSFER) reference these codes via
 * approverRule.roleCodes, so they must exist from a fresh bootstrap.
 */
interface BusinessRoleSeed {
  name: string;
  code: string;
  type: 'BUSINESS';
  status: 'ENABLED';
}

const BUSINESS_ROLE_SEEDS: readonly BusinessRoleSeed[] = Object.freeze([
  { name: '人事管理', code: 'HR', type: 'BUSINESS', status: 'ENABLED' },
  { name: '印章管理员', code: 'SEAL_ADMIN', type: 'BUSINESS', status: 'ENABLED' },
  { name: '财务', code: 'FINANCE', type: 'BUSINESS', status: 'ENABLED' },
  { name: '合伙人', code: 'PARTNER', type: 'BUSINESS', status: 'ENABLED' },
  { name: '主管', code: 'MANAGER', type: 'BUSINESS', status: 'ENABLED' },
]);

const APPROVAL_REVIEWER_PERMISSION_CODES: readonly string[] = Object.freeze([
  'approval.read',
  'approval.process',
]);

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

        await assertPermissionCatalog(tx);
        await assertEventSubscriptionCatalog(tx);
        const counts = await applicationTableCounts(tx);
        if (counts.some(item => item.count !== 0)) {
          throw new InconsistentSystemStateError('Application data exists without initialization');
        }

        await tx.role.create({
          data: {
            id: 'role:system-admin',
            name: '系统管理员',
            code: 'SYSTEM_ADMIN',
            type: 'SYSTEM',
            status: 'ENABLED',
          },
        });

        const rootOrganizationId = randomUUID();
        const organization = await tx.organization.create({
          data: {
            id: rootOrganizationId,
            code: 'ROOT',
            name: normalized.organizationName,
            type: 'FIRM',
            parentId: null,
            path: `/${rootOrganizationId}`,
            level: 0,
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

        const reviewerPermissions = await tx.permission.findMany({
          where: { code: { in: [...APPROVAL_REVIEWER_PERMISSION_CODES] } },
          select: { id: true },
        });
        if (reviewerPermissions.length !== APPROVAL_REVIEWER_PERMISSION_CODES.length) {
          throw new InconsistentSystemStateError('Approval reviewer permissions are not provisioned');
        }
        for (const seed of BUSINESS_ROLE_SEEDS) {
          const businessRole = await tx.role.create({
            data: {
              name: seed.name,
              code: seed.code,
              type: seed.type,
              status: seed.status,
            },
          });
          await tx.rolePermission.createMany({
            data: reviewerPermissions.map(permission => ({ roleId: businessRole.id, permissionId: permission.id })),
          });
        }

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

type BootstrapTransaction = Prisma.TransactionClient;

async function assertPermissionCatalog(tx: BootstrapTransaction): Promise<void> {
  const permissions = await tx.permission.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      resource: true,
      action: true,
      riskLevel: true,
      status: true,
      path: true,
      parentId: true,
    },
    orderBy: { code: 'asc' },
  });
  const expected = [...PERMISSION_CATALOG].sort(compareByCodeC);

  if (permissions.length !== expected.length) {
    throw new InconsistentSystemStateError('Permission catalog is inconsistent');
  }

  for (let index = 0; index < expected.length; index += 1) {
    const actual = permissions[index];
    const catalog = expected[index];
    if (
      actual.id !== catalog.id
      || actual.code !== catalog.code
      || actual.name !== catalog.name
      || actual.type !== catalog.type
      || actual.resource !== catalog.resource
      || actual.action !== catalog.action
      || actual.riskLevel !== catalog.riskLevel
      || actual.status !== catalog.status
      || actual.path !== catalog.route
      || actual.parentId !== null
    ) {
      throw new InconsistentSystemStateError('Permission catalog is inconsistent');
    }
  }
}

async function assertEventSubscriptionCatalog(tx: BootstrapTransaction): Promise<void> {
  const subscriptions = await tx.eventSubscription.findMany({
    select: {
      id: true,
      code: true,
      eventType: true,
      eventVersion: true,
      handlerCode: true,
      status: true,
      filterJson: true,
    },
    orderBy: { code: 'asc' },
  });
  const expected = [...EVENT_SUBSCRIPTION_CATALOG].sort(compareByCodeC);
  const dbNullFilterCodes = new Set((await tx.eventSubscription.findMany({
    where: { filterJson: { equals: Prisma.DbNull } },
    select: { code: true },
  })).map(subscription => subscription.code));

  if (subscriptions.length !== expected.length) {
    throw new InconsistentSystemStateError('Event subscription catalog is inconsistent');
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actual = subscriptions[index];
    const catalog = expected[index];
    if (
      actual.id !== catalog.id
      || actual.code !== catalog.code
      || actual.eventType !== catalog.eventType
      || actual.eventVersion !== catalog.eventVersion
      || actual.handlerCode !== catalog.handlerCode
      || actual.status !== catalog.status
      || catalog.filterJson !== null
      || !dbNullFilterCodes.has(actual.code)
    ) {
      throw new InconsistentSystemStateError('Event subscription catalog is inconsistent');
    }
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
    validateTemporaryPassword(input.password);
  } catch {
    throw new ValidationCommandError('Bootstrap input is invalid');
  }

  return { organizationName, username, password: input.password };
}
