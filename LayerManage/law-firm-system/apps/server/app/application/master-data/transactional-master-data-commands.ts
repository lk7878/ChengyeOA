import { Organization, Position, Prisma, ProfessionalTeam } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { writeMasterDataAudit } from './master-data-audit';
import { reserveOrganizationSort } from './organization-sort';
import {
  AuditActor,
  MasterDataStatus,
  OrganizationType,
  OrganizationView,
  PositionView,
  ProfessionalTeamDetail,
  ProfessionalTeamMemberView,
  TeamMemberRole,
} from './master-data-types';

export async function updateOrganizationTx(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  id: string,
  input: { sort: number; version: number },
): Promise<OrganizationView> {
  const sort = await reserveOrganizationSort(tx, input.sort, id);
  const before = await tx.organization.findUnique({ where: { id } });
  if (!before) organizationNotFound();
  const changed = await tx.organization.updateMany({
    where: { id, version: input.version },
    data: { sort, version: { increment: 1 } },
  });
  if (changed.count !== 1) versionConflict();
  const after = await tx.organization.findUniqueOrThrow({ where: { id } });
  await writeMasterDataAudit(tx, {
    ...actor,
    action: 'UPDATE',
    targetType: 'ORGANIZATION',
    targetId: id,
    before: organizationAudit(before),
    after: organizationAudit(after),
  });
  return organizationView(after);
}

export async function setOrganizationStatusTx(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  id: string,
  status: MasterDataStatus,
  version: number,
): Promise<OrganizationView> {
  const before = await tx.organization.findUnique({ where: { id } });
  if (!before) organizationNotFound();
  if (before.version !== version) versionConflict();
  if (status === 'DISABLED') {
    const initialization = await tx.systemInitialization.findUnique({ where: { id: 'PRIMARY' } });
    if (initialization?.rootOrganizationId === id) trustRootProtected();
    const [enabledDescendant, enabledPosition, activeAssignment, enabledTeam] = await Promise.all([
      tx.organization.findFirst({
        where: { path: { startsWith: `${before.path}/` }, status: 'ENABLED' }, select: { id: true },
      }),
      tx.position.findFirst({ where: { organizationId: id, status: 'ENABLED' }, select: { id: true } }),
      tx.employeeAssignment.findFirst({ where: { organizationId: id, endedAt: null }, select: { id: true } }),
      tx.professionalTeam.findFirst({
        where: { homeOrganizationId: id, status: 'ENABLED' }, select: { id: true },
      }),
    ]);
    if (enabledDescendant || enabledPosition || activeAssignment || enabledTeam) inUse();
  } else {
    const ancestorIds = before.path.split('/').filter(Boolean).filter(ancestorId => ancestorId !== before.id);
    const disabledAncestor = await tx.organization.findFirst({
      where: { id: { in: ancestorIds }, status: 'DISABLED' }, select: { id: true },
    });
    if (disabledAncestor) hierarchyInvalid();
  }
  const changed = await tx.organization.updateMany({
    where: { id, version }, data: { status, version: { increment: 1 } },
  });
  if (changed.count !== 1) versionConflict();
  const after = await tx.organization.findUniqueOrThrow({ where: { id } });
  await writeMasterDataAudit(tx, {
    ...actor,
    action: status === 'ENABLED' ? 'ENABLE' : 'DISABLE',
    targetType: 'ORGANIZATION',
    targetId: id,
    before: organizationAudit(before),
    after: organizationAudit(after),
  });
  return organizationView(after);
}

export async function updatePositionTx(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  id: string,
  input: { responsibilities: string | null; version: number },
): Promise<PositionView> {
  const before = await tx.position.findUnique({ where: { id } });
  if (!before || before.deletedAt) positionNotFound();
  const changed = await tx.position.updateMany({
    where: { id, version: input.version },
    data: { responsibilities: input.responsibilities, version: { increment: 1 } },
  });
  if (changed.count !== 1) versionConflict();
  const after = await tx.position.findUniqueOrThrow({ where: { id } });
  const activeAssignmentCount = await tx.employeeAssignment.count({ where: { positionId: id, endedAt: null } });
  await writeMasterDataAudit(tx, {
    ...actor,
    action: 'UPDATE',
    targetType: 'POSITION',
    targetId: id,
    before: positionAudit(before),
    after: positionAudit(after),
  });
  return positionView(after, activeAssignmentCount);
}

export async function setPositionStatusTx(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  id: string,
  status: MasterDataStatus,
  version: number,
): Promise<PositionView> {
  const before = await tx.position.findUnique({ where: { id } });
  if (!before || before.deletedAt) positionNotFound();
  if (before.version !== version) versionConflict();
  if (status === 'DISABLED') {
    const activeAssignment = await tx.employeeAssignment.findFirst({
      where: { positionId: id, endedAt: null }, select: { id: true },
    });
    if (activeAssignment) inUse();
  } else {
    await assertEnabledOrganization(tx, before.organizationId);
  }
  const changed = await tx.position.updateMany({
    where: { id, version }, data: { status, version: { increment: 1 } },
  });
  if (changed.count !== 1) versionConflict();
  const after = await tx.position.findUniqueOrThrow({ where: { id } });
  const activeAssignmentCount = await tx.employeeAssignment.count({ where: { positionId: id, endedAt: null } });
  await writeMasterDataAudit(tx, {
    ...actor,
    action: status === 'ENABLED' ? 'ENABLE' : 'DISABLE',
    targetType: 'POSITION',
    targetId: id,
    before: positionAudit(before),
    after: positionAudit(after),
  });
  return positionView(after, activeAssignmentCount);
}

export async function updateProfessionalTeamTx(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  id: string,
  input: { description: string | null; version: number },
): Promise<ProfessionalTeamDetail> {
  const before = await tx.professionalTeam.findUnique({ where: { id } });
  if (!before || before.deletedAt) teamNotFound();
  const changed = await tx.professionalTeam.updateMany({
    where: { id, version: input.version },
    data: { description: input.description, version: { increment: 1 } },
  });
  if (changed.count !== 1) versionConflict();
  const after = await tx.professionalTeam.findUniqueOrThrow({ where: { id } });
  await writeMasterDataAudit(tx, {
    ...actor,
    action: 'UPDATE',
    targetType: 'PROFESSIONAL_TEAM',
    targetId: id,
    before: teamAudit(before),
    after: teamAudit(after),
  });
  return teamDetail(tx, id);
}

export async function setProfessionalTeamStatusTx(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  id: string,
  status: MasterDataStatus,
  version: number,
): Promise<ProfessionalTeamDetail> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "professional_team" WHERE "id" = ${id} FOR UPDATE`);
  const before = await tx.professionalTeam.findUnique({ where: { id } });
  if (!before || before.deletedAt) teamNotFound();
  if (before.version !== version) versionConflict();
  if (status === 'DISABLED') {
    const activeMember = await tx.professionalTeamMember.findFirst({
      where: { professionalTeamId: id, endedAt: null }, select: { id: true },
    });
    if (activeMember) inUse();
  } else {
    await assertEnabledOrganization(tx, before.homeOrganizationId);
  }
  const changed = await tx.professionalTeam.updateMany({
    where: { id, version }, data: { status, version: { increment: 1 } },
  });
  if (changed.count !== 1) versionConflict();
  const after = await tx.professionalTeam.findUniqueOrThrow({ where: { id } });
  await writeMasterDataAudit(tx, {
    ...actor,
    action: status === 'ENABLED' ? 'ENABLE' : 'DISABLE',
    targetType: 'PROFESSIONAL_TEAM',
    targetId: id,
    before: teamAudit(before),
    after: teamAudit(after),
  });
  return teamDetail(tx, id);
}

async function assertEnabledOrganization(tx: Prisma.TransactionClient, id: string): Promise<void> {
  const organization = await tx.organization.findUnique({ where: { id }, select: { status: true } });
  if (!organization) throw new MasterDataError('RESOURCE_NOT_FOUND_OR_FORBIDDEN', 404);
  if (organization.status !== 'ENABLED') inUse();
}

function organizationView(value: Organization): OrganizationView {
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    type: value.type as OrganizationType,
    parentId: value.parentId,
    path: value.path,
    level: value.level,
    sort: value.sort,
    status: value.status as MasterDataStatus,
    version: value.version,
  };
}

function positionView(value: Position, activeAssignmentCount: number): PositionView {
  return {
    id: value.id,
    organizationId: value.organizationId,
    code: value.code,
    name: value.name,
    categoryCode: value.categoryCode,
    level: value.level,
    responsibilities: value.responsibilities,
    status: value.status as MasterDataStatus,
    version: value.version,
    activeAssignmentCount,
  };
}

async function teamDetail(tx: Prisma.TransactionClient, id: string): Promise<ProfessionalTeamDetail> {
  const team = await tx.professionalTeam.findUnique({
    where: { id },
    include: {
      members: { orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }] },
      _count: { select: { members: { where: { endedAt: null } } } },
    },
  });
  if (!team) teamNotFound();
  return {
    id: team.id,
    code: team.code,
    name: team.name,
    categoryCode: team.categoryCode,
    homeOrganizationId: team.homeOrganizationId,
    status: team.status as MasterDataStatus,
    version: team.version,
    activeMemberCount: team._count.members,
    description: team.description,
    members: team.members.map(member => ({
      id: member.id,
      professionalTeamId: member.professionalTeamId,
      employeeId: member.employeeId,
      memberRole: member.memberRole as TeamMemberRole,
      startedAt: member.startedAt,
      endedAt: member.endedAt,
      version: member.version,
    } satisfies ProfessionalTeamMemberView)),
  };
}

function organizationAudit(value: Organization): Record<string, unknown> {
  return { code: value.code, type: value.type, sort: value.sort, status: value.status, version: value.version };
}

function positionAudit(value: Position): Record<string, unknown> {
  return {
    organizationId: value.organizationId,
    code: value.code,
    categoryCode: value.categoryCode,
    status: value.status,
    version: value.version,
  };
}

function teamAudit(value: ProfessionalTeam): Record<string, unknown> {
  return {
    code: value.code,
    categoryCode: value.categoryCode,
    organizationId: value.homeOrganizationId,
    status: value.status,
    version: value.version,
  };
}

function organizationNotFound(): never { throw new MasterDataError('ORGANIZATION_NOT_FOUND', 404); }
function positionNotFound(): never { throw new MasterDataError('POSITION_NOT_FOUND', 404); }
function teamNotFound(): never { throw new MasterDataError('PROFESSIONAL_TEAM_NOT_FOUND', 404); }
function versionConflict(): never { throw new MasterDataError('VERSION_CONFLICT', 409); }
function hierarchyInvalid(): never { throw new MasterDataError('ORGANIZATION_HIERARCHY_INVALID', 409); }
function trustRootProtected(): never { throw new MasterDataError('TRUST_ROOT_PROTECTED', 409); }
function inUse(): never { throw new MasterDataError('MASTER_DATA_IN_USE', 409); }
