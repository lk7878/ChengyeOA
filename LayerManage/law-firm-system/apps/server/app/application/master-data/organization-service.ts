import { randomUUID } from 'node:crypto';
import { Organization, Prisma, PrismaClient } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { canParent, isDescendantPath, rebasePath } from '../../domain/master-data/organization-policy';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeName,
  normalizeNonNegativeInteger,
  normalizeRequiredText,
  normalizeStableCode,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { writeMasterDataAudit } from './master-data-audit';
import {
  AuditActor,
  MasterDataStatus,
  OrganizationDetail,
  OrganizationNode,
  OrganizationType,
  OrganizationView,
} from './master-data-types';

const CREATABLE_ORGANIZATION_TYPES = ['HQ_CENTER', 'DEPARTMENT', 'BRANCH', 'GROUP'] as const;

export interface MoveOrganizationInput {
  parentId: string;
  version: number;
}

export interface CreateOrganizationInput {
  code: string;
  name: string;
  type: Exclude<OrganizationType, 'FIRM'>;
  parentId: string;
  sort?: number;
}

export interface UpdateOrganizationInput {
  name?: string;
  sort?: number;
  version: number;
}

export class OrganizationService {
  constructor(private readonly prisma: PrismaClient, private readonly actor: AuditActor) {}

  async create(input: CreateOrganizationInput): Promise<OrganizationView> {
    assertExactKeys(input, ['code', 'name', 'type', 'parentId', 'sort']);
    const requestedType = input.type as OrganizationType;
    if (requestedType === 'FIRM') hierarchyInvalid();
    const code = normalizeStableCode(input.code);
    const name = normalizeName(input.name);
    const type = normalizeAllowedValue(requestedType, CREATABLE_ORGANIZATION_TYPES);
    const parentId = normalizeRequiredText(input.parentId, 1, 100);
    const sort = input.sort === undefined ? 0 : normalizeNonNegativeInteger(input.sort);

    try {
      return await this.prisma.$transaction(async tx => {
        const parent = await tx.organization.findUnique({ where: { id: parentId } });
        if (!parent) notFound();
        if (parent.status !== 'ENABLED' || !canParent(asOrganizationType(parent.type), type)) hierarchyInvalid();

        const id = randomUUID();
        const created = await tx.organization.create({
          data: {
            id,
            code,
            name,
            type,
            parentId,
            path: `${parent.path}/${id}`,
            level: parent.level + 1,
            sort,
          },
        });
        await writeMasterDataAudit(tx, {
          ...this.actor,
          action: 'CREATE',
          targetType: 'ORGANIZATION',
          targetId: created.id,
          after: auditShape(created),
        });
        return toView(created);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new MasterDataError('MASTER_DATA_CODE_CONFLICT', 409);
      throw error;
    }
  }

  async update(id: string, input: UpdateOrganizationInput): Promise<OrganizationView> {
    assertExactKeys(input, ['name', 'sort', 'version']);
    const version = normalizeVersion(input.version);
    const data: Prisma.OrganizationUpdateManyMutationInput = { version: { increment: 1 } };
    if (input.name !== undefined) data.name = normalizeName(input.name);
    if (input.sort !== undefined) data.sort = normalizeNonNegativeInteger(input.sort);
    if (input.name === undefined && input.sort === undefined) validationFailed();

    return this.prisma.$transaction(async tx => {
      const before = await tx.organization.findUnique({ where: { id } });
      if (!before) notFound();
      const changed = await tx.organization.updateMany({ where: { id, version }, data });
      if (changed.count !== 1) versionConflict();
      const after = await tx.organization.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, {
        ...this.actor,
        action: 'UPDATE',
        targetType: 'ORGANIZATION',
        targetId: id,
        before: auditShape(before),
        after: auditShape(after),
      });
      return toView(after);
    });
  }

  async move(id: string, input: MoveOrganizationInput): Promise<OrganizationView> {
    assertExactKeys(input, ['parentId', 'version']);
    const parentId = normalizeRequiredText(input.parentId, 1, 100);
    const version = normalizeVersion(input.version);

    return this.prisma.$transaction(async tx => {
      const initialization = await tx.systemInitialization.findUnique({ where: { id: 'PRIMARY' } });
      if (initialization?.rootOrganizationId === id) trustRootProtected();

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "organization"
        WHERE "id" IN (${Prisma.join([id, parentId])})
        FOR UPDATE
      `);
      const [before, parent] = await Promise.all([
        tx.organization.findUnique({ where: { id } }),
        tx.organization.findUnique({ where: { id: parentId } }),
      ]);
      if (!before || !parent) notFound();
      if (before.version !== version) versionConflict();
      if (parent.id === before.id || isDescendantPath(parent.path, before.path)) {
        throw new MasterDataError('ORGANIZATION_CYCLE', 409);
      }
      if (parent.status !== 'ENABLED' || !canParent(asOrganizationType(parent.type), asOrganizationType(before.type))) {
        hierarchyInvalid();
      }
      if (before.parentId === parentId) return toView(before);

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "organization"
        WHERE "id" = ${id} OR "path" LIKE ${`${before.path}/%`}
        FOR UPDATE
      `);
      const descendants = await tx.organization.findMany({
        where: { path: { startsWith: `${before.path}/` } },
        orderBy: { level: 'asc' },
      });
      const newPath = `${parent.path}/${before.id}`;
      const newLevel = parent.level + 1;
      const levelDelta = newLevel - before.level;
      const changed = await tx.organization.updateMany({
        where: { id, version },
        data: {
          parentId,
          path: newPath,
          level: newLevel,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) versionConflict();
      for (const descendant of descendants) {
        await tx.organization.update({
          where: { id: descendant.id },
          data: {
            path: rebasePath(before.path, descendant.path, newPath),
            level: descendant.level + levelDelta,
            version: { increment: 1 },
          },
        });
      }
      const after = await tx.organization.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, {
        ...this.actor,
        action: 'MOVE',
        targetType: 'ORGANIZATION',
        targetId: id,
        before: auditShape(before),
        after: auditShape(after),
      });
      return toView(after);
    });
  }

  async disable(id: string, versionValue: number): Promise<OrganizationView> {
    const version = normalizeVersion(versionValue);
    return this.prisma.$transaction(async tx => {
      const before = await tx.organization.findUnique({ where: { id } });
      if (!before) notFound();
      if (before.version !== version) versionConflict();
      const initialization = await tx.systemInitialization.findUnique({ where: { id: 'PRIMARY' } });
      if (initialization?.rootOrganizationId === id) trustRootProtected();

      const [enabledDescendant, enabledPosition, activeAssignment, enabledTeam] = await Promise.all([
        tx.organization.findFirst({ where: { path: { startsWith: `${before.path}/` }, status: 'ENABLED' }, select: { id: true } }),
        tx.position.findFirst({ where: { organizationId: id, status: 'ENABLED' }, select: { id: true } }),
        tx.employeeAssignment.findFirst({ where: { organizationId: id, endedAt: null }, select: { id: true } }),
        tx.professionalTeam.findFirst({ where: { homeOrganizationId: id, status: 'ENABLED' }, select: { id: true } }),
      ]);
      if (enabledDescendant || enabledPosition || activeAssignment || enabledTeam) inUse();

      const changed = await tx.organization.updateMany({
        where: { id, version },
        data: { status: 'DISABLED', version: { increment: 1 } },
      });
      if (changed.count !== 1) versionConflict();
      const after = await tx.organization.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, {
        ...this.actor,
        action: 'DISABLE',
        targetType: 'ORGANIZATION',
        targetId: id,
        before: auditShape(before),
        after: auditShape(after),
      });
      return toView(after);
    });
  }

  async enable(id: string, versionValue: number): Promise<OrganizationView> {
    const version = normalizeVersion(versionValue);
    return this.prisma.$transaction(async tx => {
      const before = await tx.organization.findUnique({ where: { id } });
      if (!before) notFound();
      if (before.version !== version) versionConflict();
      const ancestorIds = before.path.split('/').filter(Boolean).filter(ancestorId => ancestorId !== before.id);
      const disabledAncestor = await tx.organization.findFirst({
        where: { id: { in: ancestorIds }, status: 'DISABLED' },
        select: { id: true },
      });
      if (disabledAncestor) hierarchyInvalid();

      const changed = await tx.organization.updateMany({
        where: { id, version },
        data: { status: 'ENABLED', version: { increment: 1 } },
      });
      if (changed.count !== 1) versionConflict();
      const after = await tx.organization.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, {
        ...this.actor,
        action: 'ENABLE',
        targetType: 'ORGANIZATION',
        targetId: id,
        before: auditShape(before),
        after: auditShape(after),
      });
      return toView(after);
    });
  }

  async tree(status?: MasterDataStatus): Promise<OrganizationNode[]> {
    const normalizedStatus = status === undefined
      ? undefined
      : normalizeAllowedValue(status, ['ENABLED', 'DISABLED'] as const);
    const organizations = await this.prisma.organization.findMany({
      where: normalizedStatus ? { status: normalizedStatus } : undefined,
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    });
    const nodes = new Map(organizations.map(item => [item.id, { ...toView(item), children: [] } as OrganizationNode]));
    const roots: OrganizationNode[] = [];
    for (const item of organizations) {
      const node = nodes.get(item.id)!;
      const parent = item.parentId ? nodes.get(item.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async detail(id: string): Promise<OrganizationDetail> {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        parent: true,
        children: { orderBy: [{ sort: 'asc' }, { code: 'asc' }] },
        _count: {
          select: {
            positions: true,
            assignments: { where: { endedAt: null } },
          },
        },
      },
    });
    if (!organization) notFound();
    return {
      ...toView(organization),
      parent: organization.parent ? toView(organization.parent) : null,
      children: organization.children.map(toView),
      counts: {
        positions: organization._count.positions,
        activeAssignments: organization._count.assignments,
      },
    };
  }
}

function toView(organization: Organization): OrganizationView {
  return {
    id: organization.id,
    code: organization.code,
    name: organization.name,
    type: asOrganizationType(organization.type),
    parentId: organization.parentId,
    path: organization.path,
    level: organization.level,
    sort: organization.sort,
    status: organization.status as MasterDataStatus,
    version: organization.version,
  };
}

function auditShape(organization: Organization): Record<string, unknown> {
  return {
    code: organization.code,
    type: organization.type,
    status: organization.status,
    version: organization.version,
  };
}

function asOrganizationType(value: string): OrganizationType {
  return value as OrganizationType;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function validationFailed(): never {
  throw new MasterDataError('VALIDATION_FAILED', 400);
}

function notFound(): never {
  throw new MasterDataError('ORGANIZATION_NOT_FOUND', 404);
}

function versionConflict(): never {
  throw new MasterDataError('VERSION_CONFLICT', 409);
}

function hierarchyInvalid(): never {
  throw new MasterDataError('ORGANIZATION_HIERARCHY_INVALID', 409);
}

function trustRootProtected(): never {
  throw new MasterDataError('TRUST_ROOT_PROTECTED', 409);
}

function inUse(): never {
  throw new MasterDataError('MASTER_DATA_IN_USE', 409);
}
