import { randomUUID } from 'node:crypto';
import { Organization, Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
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
import { mapOrganizationUniqueError, reserveOrganizationSort } from './organization-sort';
import { setOrganizationStatusTx, updateOrganizationTx } from './transactional-master-data-commands';
import {
  AuditActor,
  MasterDataStatus,
  OrganizationDetail,
  OrganizationNode,
  OrganizationType,
  OrganizationView,
} from './master-data-types';

const CREATABLE_ORGANIZATION_TYPES = ['HQ_CENTER', 'DEPARTMENT', 'BRANCH', 'GROUP'] as const;
const managerSelect = { id: true, employeeNo: true, name: true, status: true } as const;

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
  managerEmployeeId?: string | null;
}

export interface UpdateOrganizationInput {
  name?: string;
  sort?: number;
  version: number;
  managerEmployeeId?: string | null;
}

export class OrganizationService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  async create(input: CreateOrganizationInput): Promise<OrganizationView> {
    this.requireSuperAdmin();
    this.authorization.requireAction(this.authorizationContext, 'organization.create');
    assertExactKeys(input, ['code', 'name', 'type', 'parentId', 'sort', 'managerEmployeeId']);
    const requestedType = input.type as OrganizationType;
    if (requestedType === 'FIRM') hierarchyInvalid();
    const code = normalizeStableCode(input.code);
    const name = normalizeName(input.name);
    const type = normalizeAllowedValue(requestedType, CREATABLE_ORGANIZATION_TYPES);
    const parentId = normalizeRequiredText(input.parentId, 1, 100);
    const scopeWhere = await this.authorization.buildOrganizationTargetWhere(
      this.authorizationContext,
      'organization',
      'organization.create',
    );

    try {
      return await this.prisma.$transaction(async tx => {
        const sort = await reserveOrganizationSort(tx, input.sort);
        const parent = await tx.organization.findFirst({ where: { AND: [scopeWhere, { id: parentId }] } });
        if (!parent) authorizationHidden();
        if (parent.status !== 'ENABLED' || !canParent(asOrganizationType(parent.type), type)) hierarchyInvalid();
        const managerEmployeeId = await validateManager(tx, input.managerEmployeeId);

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
            managerEmployeeId,
          },
          include: { manager: { select: managerSelect } },
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
      mapOrganizationUniqueError(error);
    }
  }

  async update(id: string, input: UpdateOrganizationInput): Promise<OrganizationView> {
    this.requireSuperAdmin();
    this.authorization.requireAction(this.authorizationContext, 'organization.update');
    assertExactKeys(input, ['name', 'sort', 'version', 'managerEmployeeId']);
    const version = normalizeVersion(input.version);
    const data: Prisma.OrganizationUncheckedUpdateManyInput = { version: { increment: 1 } };
    if (input.name !== undefined) data.name = normalizeName(input.name);
    if (input.sort !== undefined) data.sort = normalizeNonNegativeInteger(input.sort);
    if (input.name === undefined && input.sort === undefined && input.managerEmployeeId === undefined) validationFailed();
    await this.authorization.requireRecord(this.authorizationContext, 'organization', 'organization.update', id);

    if (input.name === undefined && input.sort !== undefined && input.managerEmployeeId === undefined) {
      return this.prisma.$transaction(tx => updateOrganizationTx(tx, this.actor, id, {
        sort: input.sort as number,
        version,
      }));
    }

    return this.prisma.$transaction(async tx => {
      if (input.sort !== undefined) data.sort = await reserveOrganizationSort(tx, input.sort, id);
      const before = await tx.organization.findUnique({ where: { id } });
      if (!before) notFound();
      if (input.managerEmployeeId !== undefined) {
        data.managerEmployeeId = await validateManager(tx, input.managerEmployeeId);
      }
      const changed = await tx.organization.updateMany({ where: { id, version }, data });
      if (changed.count !== 1) versionConflict();
      const after = await tx.organization.findUniqueOrThrow({ where: { id }, include: { manager: { select: managerSelect } } });
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
    this.requireSuperAdmin();
    this.authorization.requireAction(this.authorizationContext, 'organization.move');
    assertExactKeys(input, ['parentId', 'version']);
    const parentId = normalizeRequiredText(input.parentId, 1, 100);
    const version = normalizeVersion(input.version);
    const scopeWhere = await this.authorization.buildScopeWhere(
      this.authorizationContext,
      'organization',
      'organization.move',
    );
    await Promise.all([
      this.authorization.requireRecord(this.authorizationContext, 'organization', 'organization.move', id),
      this.authorization.requireRecord(this.authorizationContext, 'organization', 'organization.move', parentId),
    ]);
    const target = await this.prisma.organization.findFirst({
      where: { AND: [scopeWhere, { id }] },
      select: { path: true },
    });
    if (!target) authorizationHidden();
    const subtreeWhere: Prisma.OrganizationWhereInput = {
      OR: [{ id }, { path: { startsWith: `${target.path}/` } }],
    };
    const [subtreeCount, authorizedSubtreeCount] = await Promise.all([
      this.prisma.organization.count({ where: subtreeWhere }),
      this.prisma.organization.count({ where: { AND: [scopeWhere, subtreeWhere] } }),
    ]);
    if (subtreeCount !== authorizedSubtreeCount) authorizationHidden();

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
    this.requireSuperAdmin();
    this.authorization.requireAction(this.authorizationContext, 'organization.status.manage');
    const version = normalizeVersion(versionValue);
    await this.authorization.requireRecord(this.authorizationContext, 'organization', 'organization.status.manage', id);
    return this.prisma.$transaction(tx => setOrganizationStatusTx(tx, this.actor, id, 'DISABLED', version));
  }

  async enable(id: string, versionValue: number): Promise<OrganizationView> {
    this.requireSuperAdmin();
    this.authorization.requireAction(this.authorizationContext, 'organization.status.manage');
    const version = normalizeVersion(versionValue);
    await this.authorization.requireRecord(this.authorizationContext, 'organization', 'organization.status.manage', id);
    return this.prisma.$transaction(tx => setOrganizationStatusTx(tx, this.actor, id, 'ENABLED', version));
  }

  async tree(status?: MasterDataStatus): Promise<OrganizationNode[]> {
    this.requireSuperAdmin();
    return this.readTree(status, true);
  }

  async options(status?: MasterDataStatus): Promise<OrganizationNode[]> {
    return this.readTree(status, false);
  }

  private async readTree(status: MasterDataStatus | undefined, includeManager: boolean): Promise<OrganizationNode[]> {
    this.authorization.requireAction(this.authorizationContext, 'organization.read');
    const normalizedStatus = status === undefined
      ? undefined
      : normalizeAllowedValue(status, ['ENABLED', 'DISABLED'] as const);
    const scopeWhere = await this.authorization.buildScopeWhere(
      this.authorizationContext,
      'organization',
      'organization.read',
    );
    const organizations = await this.prisma.organization.findMany({
      where: { AND: [scopeWhere, normalizedStatus ? { status: normalizedStatus } : {}] },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
      include: { manager: includeManager ? { select: managerSelect } : false },
    });
    const nodes = new Map(organizations.map(item => {
      const view = toView(item);
      if (!includeManager) { delete view.manager; delete view.managerEmployeeId; }
      return [item.id, { ...view, children: [] } as OrganizationNode];
    }));
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
    this.requireSuperAdmin();
    this.authorization.requireAction(this.authorizationContext, 'organization.read');
    const scopeWhere = await this.authorization.buildScopeWhere(
      this.authorizationContext,
      'organization',
      'organization.read',
    );
    const organization = await this.prisma.organization.findFirst({
      where: { AND: [scopeWhere, { id }] },
      include: {
        manager: { select: managerSelect },
        children: { where: scopeWhere, orderBy: [{ sort: 'asc' }, { code: 'asc' }] },
        _count: {
          select: {
            positions: true,
            assignments: { where: { endedAt: null } },
          },
        },
      },
    });
    if (!organization) authorizationHidden();
    const parent = organization.parentId
      ? await this.prisma.organization.findFirst({ where: { AND: [scopeWhere, { id: organization.parentId }] } })
      : null;
    return {
      ...toView(organization),
      parent: parent ? toView(parent) : null,
      children: organization.children.map(toView),
      counts: {
        positions: organization._count.positions,
        activeAssignments: organization._count.assignments,
      },
    };
  }

  private requireSuperAdmin(): void {
    if (!this.authorizationContext.isSystemSuperAdmin) throw new MasterDataError('SUPER_ADMIN_REQUIRED', 403);
  }

  async managerOptions(keyword = '') {
    this.requireSuperAdmin();
    this.authorization.requireAction(this.authorizationContext, 'organization.read');
    const search = keyword.trim().slice(0, 100);
    return this.prisma.employee.findMany({
      where: { status: { in: ['PROBATION', 'FORMAL'] }, ...(search ? {
        OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { employeeNo: { contains: search, mode: 'insensitive' as const } }],
      } : {}) },
      select: managerSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100,
    });
  }

  async remove(id: string, versionValue: number): Promise<void> {
    this.requireSuperAdmin();
    this.authorization.requireAction(this.authorizationContext, 'organization.update');
    const version = normalizeVersion(versionValue);
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "organization" WHERE "id" = ${id} FOR UPDATE`;
        const before = await tx.organization.findUnique({ where: { id }, include: { _count: { select: {
          children: true, positions: true, assignments: true, professionalTeams: true,
          dataScopes: true, dataScopeTargets: true, eventLogsOrganization: true, eventLogsBranch: true,
        } } } });
        if (!before) notFound();
        if (before.type === 'FIRM' || await tx.systemInitialization.findFirst({ where: { rootOrganizationId: id } })) trustRootProtected();
        if (before.version !== version) versionConflict();
        const blockers = Object.fromEntries(Object.entries(before._count).filter(([, count]) => count > 0));
        if (Object.keys(blockers).length) throw new MasterDataError('ORGANIZATION_DELETE_IN_USE', 409, { organizationDeleteBlockers: blockers });
        await tx.organization.delete({ where: { id } });
        await writeMasterDataAudit(tx, { ...this.actor, action: 'DELETE', targetType: 'ORGANIZATION', targetId: id, before: auditShape(before) });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new MasterDataError('ORGANIZATION_DELETE_IN_USE', 409);
      throw error;
    }
  }

  async copy(sourceId: string, input: CreateOrganizationInput & { sourceVersion: number }): Promise<OrganizationView> {
    this.requireSuperAdmin();
    this.authorization.requireAction(this.authorizationContext, 'organization.create');
    assertExactKeys(input, ['code', 'name', 'type', 'parentId', 'sort', 'managerEmployeeId', 'sourceVersion']);
    const code = normalizeStableCode(input.code);
    const name = normalizeName(input.name);
    const type = normalizeAllowedValue(input.type, CREATABLE_ORGANIZATION_TYPES);
    const parentId = normalizeRequiredText(input.parentId, 1, 100);
    const sourceVersion = normalizeVersion(input.sourceVersion);
    try {
      return await this.prisma.$transaction(async tx => {
        const sort = await reserveOrganizationSort(tx, input.sort);
        const source = await tx.organization.findUnique({ where: { id: sourceId } });
        const parent = await tx.organization.findUnique({ where: { id: parentId } });
        if (!source || !parent) notFound();
        if (source.type === 'FIRM') trustRootProtected();
        if (source.version !== sourceVersion) versionConflict();
        if (parent.status !== 'ENABLED' || !canParent(asOrganizationType(parent.type), type)) hierarchyInvalid();
        const nodes = await tx.organization.findMany({ where: { OR: [{ id: sourceId }, { path: { startsWith: `${source.path}/` } }] }, orderBy: [{ level: 'asc' }, { sort: 'asc' }, { id: 'asc' }] });
        if (nodes.some(node => node.parentId === sourceId && !canParent(type, asOrganizationType(node.type)))) hierarchyInvalid();
        const positions = await tx.position.findMany({ where: { organizationId: { in: nodes.map(node => node.id) } } });
        const managerEmployeeId = await validateManager(tx, input.managerEmployeeId);
        const copies = new Map<string, Organization>();
        for (const node of nodes) {
          const isRoot = node.id === sourceId;
          const destinationParent = isRoot ? parent : copies.get(node.parentId!)!;
          const id = randomUUID();
          const created = await tx.organization.create({ data: {
            id, code: isRoot ? code : `${node.code.slice(0, 23)}_${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
            name: isRoot ? name : node.name, type: isRoot ? type : node.type,
            parentId: destinationParent.id, path: `${destinationParent.path}/${id}`, level: destinationParent.level + 1,
            sort: isRoot ? sort : await reserveOrganizationSort(tx), status: isRoot ? 'ENABLED' : node.status,
            managerEmployeeId: isRoot ? managerEmployeeId : null,
          } });
          copies.set(node.id, created);
        }
        if (positions.length) await tx.position.createMany({ data: positions.map(position => ({
          id: randomUUID(), organizationId: copies.get(position.organizationId)!.id,
          code: position.code, name: position.name, categoryCode: position.categoryCode,
          level: position.level, responsibilities: position.responsibilities, status: position.status,
        })) });
        const created = copies.get(sourceId)!;
        await writeMasterDataAudit(tx, { ...this.actor, action: 'COPY', targetType: 'ORGANIZATION', targetId: created.id,
          after: { ...auditShape(created), sourceOrganizationId: sourceId, copiedOrganizationCount: nodes.length, copiedPositionCount: positions.length } });
        return toView(await tx.organization.findUniqueOrThrow({ where: { id: created.id }, include: { manager: { select: managerSelect } } }));
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') versionConflict();
      mapOrganizationUniqueError(error);
    }
  }
}

async function validateManager(tx: Prisma.TransactionClient, value: unknown): Promise<string | null> {
  if (value === undefined || value === null) return null;
  const id = normalizeRequiredText(value, 1, 100);
  await tx.$queryRaw`SELECT "id" FROM "employee" WHERE "id" = ${id} FOR SHARE`;
  const employee = await tx.employee.findUnique({ where: { id }, select: { status: true } });
  if (!employee || !['PROBATION', 'FORMAL'].includes(employee.status)) throw new MasterDataError('ORGANIZATION_MANAGER_INVALID', 400);
  return id;
}

function toView(organization: Organization & { manager?: OrganizationView['manager'] }): OrganizationView {
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
    managerEmployeeId: organization.managerEmployeeId,
    manager: organization.manager ?? null,
  };
}

function auditShape(organization: Organization): Record<string, unknown> {
  return {
    code: organization.code,
    type: organization.type,
    sort: organization.sort,
    status: organization.status,
    version: organization.version,
    ...(organization.managerEmployeeId ? { managerEmployeeId: organization.managerEmployeeId } : {}),
  };
}

function asOrganizationType(value: string): OrganizationType {
  return value as OrganizationType;
}

function validationFailed(): never {
  throw new MasterDataError('VALIDATION_FAILED', 400);
}

function notFound(): never {
  throw new MasterDataError('ORGANIZATION_NOT_FOUND', 404);
}

function authorizationHidden(): never {
  throw new MasterDataError('RESOURCE_NOT_FOUND_OR_FORBIDDEN', 404);
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
