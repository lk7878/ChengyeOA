import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { writeAuditLog } from '../system/audit-writer';
import { GOVERNANCE_CODES, GovernanceError, governanceInputError } from '../../domain/admin-governance/governance-errors';
import { GOVERNED_OPERATION_CATALOG } from '../../domain/admin-governance/operation-catalog';
import {
  GOVERNED_OPERATION_TYPES,
  GovernedOperationType,
  GovernanceStatus,
} from '../../domain/admin-governance/governance-types';
import { GovernanceStore } from './governance-store';
import {
  AdminOperationDetailView,
  AdminOperationView,
  GovernanceCatalogView,
  GovernancePage,
  toAdminOperationDetailView,
  toAdminOperationView,
} from './governance-views';

export type GovernanceListScope = 'mine' | 'reviewable' | 'all';

export interface GovernanceListQuery {
  scope?: GovernanceListScope;
  status?: GovernanceStatus;
  operationType?: GovernedOperationType;
  requesterUserId?: string;
  from?: Date | string;
  to?: Date | string;
  page?: number | string;
  pageSize?: number | string;
}

export interface GovernanceUserTargetView {
  id: string;
  username: string;
  displayName: string | null;
  status: string;
  governanceVersion: number;
}

const GOVERNANCE_STATUSES: readonly GovernanceStatus[] = Object.freeze([
  'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTING', 'SUCCEEDED', 'FAILED',
  'PENDING_POST_REVIEW', 'CONFIRMED', 'FLAGGED',
]);
const ADMINISTRATOR_ACCOUNT_TYPES: readonly GovernedOperationType[] = Object.freeze([
  'SYSTEM_ADMIN_GRANT',
  'SYSTEM_ADMIN_REVOKE',
  'SYSTEM_ADMIN_ACCOUNT_DISABLE',
  'SUPER_ADMIN_GRANT',
  'SUPER_ADMIN_REVOKE',
  'SUPER_ADMIN_ACCOUNT_DISABLE',
]);

export class GovernanceQueryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly databaseName: string,
  ) {}

  async list(
    context: AuthorizationContext,
    query: GovernanceListQuery,
  ): Promise<GovernancePage<AdminOperationView>> {
    const page = positiveInteger(query.page ?? 1);
    const pageSize = positiveInteger(query.pageSize ?? 20);
    if (pageSize > 100) governanceInputError();
    const scope = query.scope ?? 'mine';
    if (!(['mine', 'reviewable', 'all'] as const).includes(scope)) governanceInputError();
    if (query.status !== undefined && !GOVERNANCE_STATUSES.includes(query.status)) governanceInputError();
    if (query.operationType !== undefined && !GOVERNED_OPERATION_TYPES.includes(query.operationType)) {
      governanceInputError();
    }

    const conditions: Prisma.AdminOperationWhereInput[] = [];
    if (scope === 'mine') {
      requirePermission(context, 'governance.operation.read_self');
      conditions.push({ requesterUserId: context.userId });
    } else if (scope === 'reviewable') {
      requireSuperAdminPermission(context, 'governance.review');
      conditions.push(
        { requesterUserId: { not: context.userId } },
        { status: { in: ['PENDING_REVIEW', 'PENDING_POST_REVIEW'] } },
        { NOT: { operationType: { in: [...ADMINISTRATOR_ACCOUNT_TYPES] }, targetId: context.userId } },
      );
    } else {
      requireSuperAdminPermission(context, 'governance.operation.read_all');
    }

    if (query.status !== undefined) conditions.push({ status: query.status });
    if (query.operationType !== undefined) conditions.push({ operationType: query.operationType });
    if (query.requesterUserId !== undefined) conditions.push({ requesterUserId: query.requesterUserId });
    const createdAt = dateRange(query.from, query.to);
    if (createdAt !== undefined) conditions.push({ createdAt });
    const where: Prisma.AdminOperationWhereInput = conditions.length === 0 ? {} : { AND: conditions };

    const [total, operations] = await Promise.all([
      this.prisma.adminOperation.count({ where }),
      this.prisma.adminOperation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: operations.map(toAdminOperationView),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async userTargets(context: AuthorizationContext, keywordValue?: unknown): Promise<GovernanceUserTargetView[]> {
    requirePermission(context, 'governance.catalog.read');
    if (!context.isSystemAdmin && !context.isSystemSuperAdmin) notAllowed();
    if (keywordValue !== undefined && typeof keywordValue !== 'string') governanceInputError();
    const keyword = typeof keywordValue === 'string' ? keywordValue.trim() : '';
    if (keyword.length > 100) governanceInputError();
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ENABLED',
        ...(keyword === '' ? {} : { OR: [
          { username: { contains: keyword, mode: 'insensitive' } },
          { employee: { name: { contains: keyword, mode: 'insensitive' } } },
        ] }),
      },
      select: {
        id: true,
        username: true,
        status: true,
        credentialVersion: true,
        employee: { select: { name: true } },
      },
      orderBy: [{ username: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    return users.map(user => ({
      id: user.id,
      username: user.username,
      displayName: user.employee?.name ?? null,
      status: user.status,
      governanceVersion: user.credentialVersion,
    }));
  }

  detail(context: AuthorizationContext, id: string, ip?: string): Promise<AdminOperationDetailView> {
    return this.prisma.$transaction(async tx => {
      const operation = await new GovernanceStore(tx).getDetail(id);
      if (!operation || !canReadDetail(context, operation.requesterUserId)) {
        throw new GovernanceError(GOVERNANCE_CODES.hidden, 404);
      }
      await writeAuditLog(tx, {
        userId: context.userId,
        action: 'VIEW_ADMIN_GOVERNANCE_DETAIL',
        targetType: 'ADMIN_GOVERNANCE',
        targetId: operation.id,
        ip: ip ?? null,
      });
      return toAdminOperationDetailView(operation);
    });
  }

  catalog(context: AuthorizationContext): GovernanceCatalogView[] {
    requirePermission(context, 'governance.catalog.read');
    const requesterRole = context.isSystemSuperAdmin
      ? 'SYSTEM_SUPER_ADMIN'
      : context.isSystemAdmin
        ? 'SYSTEM_ADMIN'
        : null;
    if (requesterRole === null) notAllowed();

    return GOVERNED_OPERATION_TYPES
      .filter(operationType => GOVERNED_OPERATION_CATALOG[operationType].requesterRoles.includes(requesterRole))
      .map(operationType => {
        const entry = GOVERNED_OPERATION_CATALOG[operationType];
        return {
          operationType,
          ...entry,
          ...(entry.confirmationTemplate === undefined ? {} : {
            confirmationTemplate: entry.confirmationTemplate
              .replaceAll('{databaseName}', this.databaseName)
              .replaceAll('{operationType}', operationType),
          }),
        };
      });
  }
}

function canReadDetail(context: AuthorizationContext, requesterUserId: string): boolean {
  if (requesterUserId === context.userId) {
    return context.permissionCodes.includes('governance.operation.read_self');
  }
  return context.isSystemSuperAdmin && context.permissionCodes.includes('governance.operation.read_all');
}

function requireSuperAdminPermission(context: AuthorizationContext, permission: 'governance.review' | 'governance.operation.read_all'): void {
  if (!context.isSystemSuperAdmin || !context.permissionCodes.includes(permission)) notAllowed();
}

function requirePermission(
  context: AuthorizationContext,
  permission: 'governance.catalog.read' | 'governance.operation.read_self',
): void {
  if (!context.permissionCodes.includes(permission)) notAllowed();
}

function notAllowed(): never {
  throw new GovernanceError(GOVERNANCE_CODES.notAllowed, 403);
}

function positiveInteger(value: number | string): number {
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) governanceInputError();
  return normalized;
}

function dateRange(from?: Date | string, to?: Date | string): Prisma.DateTimeFilter | undefined {
  const gte = optionalDate(from);
  const lte = optionalDate(to);
  if (gte !== undefined && lte !== undefined && gte > lte) governanceInputError();
  return gte === undefined && lte === undefined ? undefined : { gte, lte };
}

function optionalDate(value?: Date | string): Date | undefined {
  if (value === undefined) return undefined;
  const normalized = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(normalized.getTime())) governanceInputError();
  return normalized;
}
