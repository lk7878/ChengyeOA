import { Position, Prisma, PrismaClient } from '@prisma/client';
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
  constructor(private readonly prisma: PrismaClient, private readonly actor: AuditActor) {}

  async create(input: CreatePositionInput): Promise<PositionView> {
    assertExactKeys(input, ['organizationId', 'code', 'name', 'categoryCode', 'level', 'responsibilities']);
    const organizationId = normalizeRequiredText(input.organizationId, 1, 100);
    const code = normalizeStableCode(input.code);
    const name = normalizeName(input.name);
    const categoryCode = normalizeStableCode(input.categoryCode);
    const level = normalizeNonNegativeInteger(input.level);
    const responsibilities = input.responsibilities === undefined
      ? null
      : normalizeOptionalText(input.responsibilities, 2000);

    try {
      return await this.prisma.$transaction(async tx => {
        await assertEnabledOrganization(tx, organizationId);
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
    const version = normalizeVersion(versionValue);
    return this.prisma.$transaction(async tx => {
      const before = await tx.position.findUnique({ where: { id } });
      if (!before) notFound();
      if (before.version !== version) versionConflict();
      const activeAssignment = await tx.employeeAssignment.findFirst({
        where: { positionId: id, endedAt: null },
        select: { id: true },
      });
      if (activeAssignment) inUse();
      const changed = await tx.position.updateMany({
        where: { id, version },
        data: { status: 'DISABLED', version: { increment: 1 } },
      });
      if (changed.count !== 1) versionConflict();
      const after = await tx.position.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, {
        ...this.actor,
        action: 'DISABLE',
        targetType: 'POSITION',
        targetId: id,
        before: auditShape(before),
        after: auditShape(after),
      });
      return toView(after, 0);
    });
  }

  async enable(id: string, versionValue: number): Promise<PositionView> {
    const version = normalizeVersion(versionValue);
    return this.prisma.$transaction(async tx => {
      const before = await tx.position.findUnique({ where: { id } });
      if (!before) notFound();
      if (before.version !== version) versionConflict();
      await assertEnabledOrganization(tx, before.organizationId);
      const changed = await tx.position.updateMany({
        where: { id, version },
        data: { status: 'ENABLED', version: { increment: 1 } },
      });
      if (changed.count !== 1) versionConflict();
      const after = await tx.position.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, {
        ...this.actor,
        action: 'ENABLE',
        targetType: 'POSITION',
        targetId: id,
        before: auditShape(before),
        after: auditShape(after),
      });
      return toView(after, 0);
    });
  }

  async list(query: PositionListQuery): Promise<PositionView[]> {
    assertExactKeys(query, ['organizationId', 'status', 'keyword']);
    const organizationId = query.organizationId === undefined
      ? undefined
      : normalizeRequiredText(query.organizationId, 1, 100);
    const status = query.status === undefined
      ? undefined
      : normalizeAllowedValue(query.status, ['ENABLED', 'DISABLED'] as const);
    const keyword = query.keyword === undefined ? undefined : normalizeRequiredText(query.keyword, 1, 100);
    const positions = await this.prisma.position.findMany({
      where: {
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
    const position = await this.prisma.position.findUnique({
      where: { id },
      include: { _count: { select: { assignments: { where: { endedAt: null } } } } },
    });
    if (!position) notFound();
    return toView(position, position._count.assignments);
  }
}

async function assertEnabledOrganization(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
  if (!organization) throw new MasterDataError('ORGANIZATION_NOT_FOUND', 404);
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

function versionConflict(): never {
  throw new MasterDataError('VERSION_CONFLICT', 409);
}

function codeConflict(): never {
  throw new MasterDataError('MASTER_DATA_CODE_CONFLICT', 409);
}

function inUse(): never {
  throw new MasterDataError('MASTER_DATA_IN_USE', 409);
}
