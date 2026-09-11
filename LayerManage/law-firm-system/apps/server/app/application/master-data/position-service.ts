import { Position, Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeName,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeStableCode,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { writeMasterDataAudit } from './master-data-audit';
import { setPositionStatusTx, updatePositionTx } from './transactional-master-data-commands';
import { AuditActor, MasterDataStatus, PositionView } from './master-data-types';

export interface CreatePositionInput {
  organizationId: string;
  code: string;
  name: string;
  categoryCode: string;
  level: number;
  responsibilities?: string | null;
}

export interface UpdatePositionInput {
  name?: string;
  categoryCode?: string;
  level?: number;
  responsibilities?: string | null;
  version: number;
}

export type PositionDetail = PositionView;

export interface PositionListQuery {
  organizationId?: string;
  status?: MasterDataStatus;
  keyword?: string;
}

export class PositionService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  async create(input: CreatePositionInput): Promise<PositionView> {
    this.authorization.requireAction(this.authorizationContext, 'position.create');
    assertExactKeys(input, ['organizationId', 'code', 'name', 'categoryCode', 'level', 'responsibilities']);
    const organizationId = normalizeRequiredText(input.organizationId, 1, 100);
    const code = normalizeStableCode(input.code);
    const name = normalizeName(input.name);
    const categoryCode = normalizeStableCode(input.categoryCode);
    const level = normalizeNonNegativeInteger(input.level);
    const responsibilities = input.responsibilities === undefined
      ? null
      : normalizeOptionalText(input.responsibilities, 2000);
    const organizationScopeWhere = await this.authorization.buildOrganizationTargetWhere(
      this.authorizationContext,
      'position',
      'position.create',
    );

    try {
      return await this.prisma.$transaction(async tx => {
        await assertEnabledOrganization(tx, organizationId, organizationScopeWhere);
        const created = await tx.position.create({
          data: { organizationId, code, name, categoryCode, level, responsibilities },
        });
        await writeMasterDataAudit(tx, {
          ...this.actor,
          action: 'CREATE',
          targetType: 'POSITION',
          targetId: created.id,
          after: auditShape(created),
        });
        return toView(created, 0);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) codeConflict();
      throw error;
    }
  }

  async update(id: string, input: UpdatePositionInput): Promise<PositionView> {
    this.authorization.requireAction(this.authorizationContext, 'position.update');
    assertExactKeys(input, ['name', 'categoryCode', 'level', 'responsibilities', 'version']);
    const version = normalizeVersion(input.version);
    const data: Prisma.PositionUpdateManyMutationInput = { version: { increment: 1 } };
    if (input.name !== undefined) data.name = normalizeName(input.name);
    if (input.categoryCode !== undefined) data.categoryCode = normalizeStableCode(input.categoryCode);
    if (input.level !== undefined) data.level = normalizeNonNegativeInteger(input.level);
    if (input.responsibilities !== undefined) data.responsibilities = normalizeOptionalText(input.responsibilities, 2000);
    if (input.name === undefined && input.categoryCode === undefined && input.level === undefined && input.responsibilities === undefined) {
      validationFailed();
    }
    await this.authorization.requireRecord(this.authorizationContext, 'position', 'position.update', id);

    if (
      input.name === undefined
      && input.categoryCode === undefined
      && input.level === undefined
      && input.responsibilities !== undefined
    ) {
      return this.prisma.$transaction(tx => updatePositionTx(tx, this.actor, id, {
        responsibilities: data.responsibilities as string | null,
        version,
      }));
    }

    return this.prisma.$transaction(async tx => {
      const before = await tx.position.findUnique({ where: { id } });
      if (!before) notFound();
      const changed = await tx.position.updateMany({ where: { id, version }, data });
      if (changed.count !== 1) versionConflict();
      const after = await tx.position.findUniqueOrThrow({ where: { id } });
      const activeAssignmentCount = await tx.employeeAssignment.count({ where: { positionId: id, endedAt: null } });
      await writeMasterDataAudit(tx, {
        ...this.actor,
        action: 'UPDATE',
        targetType: 'POSITION',
        targetId: id,
        before: auditShape(before),
        after: auditShape(after),
      });
      return toView(after, activeAssignmentCount);
    });
  }

  async disable(id: string, versionValue: number): Promise<PositionView> {
    this.authorization.requireAction(this.authorizationContext, 'position.status.manage');
    const version = normalizeVersion(versionValue);
    await this.authorization.requireRecord(this.authorizationContext, 'position', 'position.status.manage', id);
    return this.prisma.$transaction(tx => setPositionStatusTx(tx, this.actor, id, 'DISABLED', version));
  }

  async enable(id: string, versionValue: number): Promise<PositionView> {
    this.authorization.requireAction(this.authorizationContext, 'position.status.manage');
    const version = normalizeVersion(versionValue);
    await this.authorization.requireRecord(this.authorizationContext, 'position', 'position.status.manage', id);
    return this.prisma.$transaction(tx => setPositionStatusTx(tx, this.actor, id, 'ENABLED', version));
  }

  async remove(id: string, versionValue: number): Promise<void> {
    if (!this.authorizationContext.isSystemSuperAdmin) throw new MasterDataError('SUPER_ADMIN_REQUIRED', 403);
    this.authorization.requireAction(this.authorizationContext, 'position.update');
    const version = normalizeVersion(versionValue);
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "position" WHERE "id" = ${id} FOR UPDATE`;
        const before = await tx.position.findUnique({ where: { id } });
        if (!before) notFound();
        if (before.version !== version) versionConflict();
        if (await tx.employeeAssignment.count({ where: { positionId: id } })) throw new MasterDataError('POSITION_DELETE_IN_USE', 409);
        await tx.position.delete({ where: { id } });
        await writeMasterDataAudit(tx, { ...this.actor, action: 'DELETE', targetType: 'POSITION', targetId: id, before: auditShape(before) });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new MasterDataError('POSITION_DELETE_IN_USE', 409);
      throw error;
    }
  }

  async list(query: PositionListQuery): Promise<PositionView[]> {
    this.authorization.requireAction(this.authorizationContext, 'position.read');
    assertExactKeys(query, ['organizationId', 'status', 'keyword']);
    const organizationId = query.organizationId === undefined
      ? undefined
      : normalizeRequiredText(query.organizationId, 1, 100);
    const status = query.status === undefined
      ? undefined
      : normalizeAllowedValue(query.status, ['ENABLED', 'DISABLED'] as const);
    const keyword = query.keyword === undefined ? undefined : normalizeRequiredText(query.keyword, 1, 100);
    const scopeWhere = await this.authorization.buildScopeWhere(
      this.authorizationContext,
      'position',
      'position.read',
    );
    const positions = await this.prisma.position.findMany({
      where: {
        AND: [scopeWhere],
        organizationId,
        status,
        OR: keyword
          ? [
            { name: { contains: keyword, mode: 'insensitive' } },
            { code: { contains: keyword, mode: 'insensitive' } },
          ]
          : undefined,
      },
      include: { _count: { select: { assignments: { where: { endedAt: null } } } } },
      orderBy: [{ level: 'desc' }, { code: 'asc' }],
    });
    return positions.map(position => toView(position, position._count.assignments));
  }

  async detail(id: string): Promise<PositionDetail> {
    this.authorization.requireAction(this.authorizationContext, 'position.read');
    const scopeWhere = await this.authorization.buildScopeWhere(
      this.authorizationContext,
      'position',
      'position.read',
    );
    const position = await this.prisma.position.findFirst({
      where: { AND: [scopeWhere, { id }] },
      include: { _count: { select: { assignments: { where: { endedAt: null } } } } },
    });
    if (!position) authorizationHidden();
    return toView(position, position._count.assignments);
  }
}

async function assertEnabledOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string,
  scopeWhere?: Prisma.OrganizationWhereInput,
): Promise<void> {
  const organization = await tx.organization.findFirst({
    where: { AND: [scopeWhere ?? {}, { id: organizationId }] },
    select: { status: true },
  });
  if (!organization) authorizationHidden();
  if (organization.status !== 'ENABLED') inUse();
}

function toView(position: Position, activeAssignmentCount: number): PositionView {
  return {
    id: position.id,
    organizationId: position.organizationId,
    code: position.code,
    name: position.name,
    categoryCode: position.categoryCode,
    level: position.level,
    responsibilities: position.responsibilities,
    status: position.status as MasterDataStatus,
    version: position.version,
    activeAssignmentCount,
  };
}

function auditShape(position: Position): Record<string, unknown> {
  return {
    organizationId: position.organizationId,
    code: position.code,
    categoryCode: position.categoryCode,
    status: position.status,
    version: position.version,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function validationFailed(): never {
  throw new MasterDataError('VALIDATION_FAILED', 400);
}

function notFound(): never {
  throw new MasterDataError('POSITION_NOT_FOUND', 404);
}

function authorizationHidden(): never {
  throw new MasterDataError('RESOURCE_NOT_FOUND_OR_FORBIDDEN', 404);
}

function versionConflict(): never {
  throw new MasterDataError('VERSION_CONFLICT', 409);
}

function codeConflict(): never {
  throw new MasterDataError('MASTER_DATA_CODE_CONFLICT', 409);
}

function inUse(): never {
  throw new MasterDataError('MASTER_DATA_IN_USE', 409);
}
