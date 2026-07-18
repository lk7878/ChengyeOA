import { Prisma, PrismaClient } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { assertExactKeys, normalizeAllowedValue, normalizeRequiredText, normalizeVersion } from '../../domain/master-data/master-data-validation';
import { writeMasterDataAudit } from './master-data-audit';
import { EMPLOYEE_DETAIL_INCLUDE, projectEmployeeDetail } from './employee-projection';
import { AssignmentType, AuditActor, EmployeeDetail } from './master-data-types';

export interface TransferPrimaryInput {
  organizationId: string;
  positionId: string;
  employeeVersion: number;
}

export interface AddAssignmentInput {
  organizationId: string;
  positionId: string;
  assignmentType: 'SECONDARY' | 'ACTING';
}

export class EmployeeAssignmentService {
  constructor(private readonly prisma: PrismaClient, private readonly actor: AuditActor) {}

  async transferPrimary(employeeId: string, input: TransferPrimaryInput): Promise<EmployeeDetail> {
    assertExactKeys(input, ['organizationId', 'positionId', 'employeeVersion']);
    const organizationId = normalizeRequiredText(input.organizationId, 1, 100);
    const positionId = normalizeRequiredText(input.positionId, 1, 100);
    const employeeVersion = normalizeVersion(input.employeeVersion);
    return this.withAssignmentConflictMapping(() => this.prisma.$transaction(async tx => {
      const employee = await lockEmployee(tx, employeeId);
      if (employee.version !== employeeVersion) versionConflict();
      assertActiveEmployee(employee.status);
      await assertEnabledReferences(tx, organizationId, positionId);
      const activePrimary = await tx.employeeAssignment.findMany({
        where: { employeeId, assignmentType: 'PRIMARY', endedAt: null },
      });
      if (activePrimary.length !== 1) primaryConflict();
      const now = new Date();
      await tx.employeeAssignment.update({
        where: { id: activePrimary[0].id },
        data: { endedAt: now, version: { increment: 1 } },
      });
      const created = await tx.employeeAssignment.create({
        data: { employeeId, organizationId, positionId, assignmentType: 'PRIMARY', startedAt: now },
      });
      const changed = await tx.employee.updateMany({
        where: { id: employeeId, version: employeeVersion },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) versionConflict();
      await writeMasterDataAudit(tx, {
        ...this.actor, action: 'TRANSFER_PRIMARY', targetType: 'EMPLOYEE_ASSIGNMENT', targetId: created.id,
        before: assignmentAudit(activePrimary[0]), after: assignmentAudit(created),
      });
      return loadDetail(tx, employeeId);
    }));
  }

  async add(employeeId: string, input: AddAssignmentInput): Promise<EmployeeDetail> {
    assertExactKeys(input, ['organizationId', 'positionId', 'assignmentType']);
    const organizationId = normalizeRequiredText(input.organizationId, 1, 100);
    const positionId = normalizeRequiredText(input.positionId, 1, 100);
    const assignmentType = normalizeAllowedValue(input.assignmentType, ['SECONDARY', 'ACTING'] as const);
    return this.withAssignmentConflictMapping(() => this.prisma.$transaction(async tx => {
      const employee = await lockEmployee(tx, employeeId);
      assertActiveEmployee(employee.status);
      await assertEnabledReferences(tx, organizationId, positionId);
      const created = await tx.employeeAssignment.create({
        data: { employeeId, organizationId, positionId, assignmentType, startedAt: new Date() },
      });
      await tx.employee.update({ where: { id: employeeId }, data: { version: { increment: 1 } } });
      await writeMasterDataAudit(tx, {
        ...this.actor, action: 'ADD_ASSIGNMENT', targetType: 'EMPLOYEE_ASSIGNMENT', targetId: created.id,
        after: assignmentAudit(created),
      });
      return loadDetail(tx, employeeId);
    }));
  }

  async end(employeeId: string, assignmentId: string, input: { version: number }): Promise<EmployeeDetail> {
    assertExactKeys(input, ['version']);
    const version = normalizeVersion(input.version);
    return this.prisma.$transaction(async tx => {
      await lockEmployee(tx, employeeId);
      const assignment = await tx.employeeAssignment.findFirst({ where: { id: assignmentId, employeeId } });
      if (!assignment) throw new MasterDataError('ASSIGNMENT_NOT_FOUND', 404);
      if (assignment.assignmentType === 'PRIMARY') primaryConflict();
      if (assignment.version !== version || assignment.endedAt) versionConflict();
      const now = new Date();
      if (now <= assignment.startedAt) validationFailed();
      const changed = await tx.employeeAssignment.updateMany({
        where: { id: assignmentId, version, endedAt: null },
        data: { endedAt: now, version: { increment: 1 } },
      });
      if (changed.count !== 1) versionConflict();
      await tx.employee.update({ where: { id: employeeId }, data: { version: { increment: 1 } } });
      const after = await tx.employeeAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      await writeMasterDataAudit(tx, {
        ...this.actor, action: 'END_ASSIGNMENT', targetType: 'EMPLOYEE_ASSIGNMENT', targetId: assignmentId,
        before: assignmentAudit(assignment), after: assignmentAudit(after),
      });
      return loadDetail(tx, employeeId);
    });
  }

  private async withAssignmentConflictMapping<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') primaryConflict();
      throw error;
    }
  }
}

async function lockEmployee(tx: Prisma.TransactionClient, employeeId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "employee" WHERE "id" = ${employeeId} FOR UPDATE`);
  const employee = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new MasterDataError('EMPLOYEE_NOT_FOUND', 404);
  return employee;
}

async function assertEnabledReferences(tx: Prisma.TransactionClient, organizationId: string, positionId: string) {
  const [organization, position] = await Promise.all([
    tx.organization.findUnique({ where: { id: organizationId } }),
    tx.position.findUnique({ where: { id: positionId } }),
  ]);
  if (!organization || !position) throw new MasterDataError('MASTER_DATA_NOT_FOUND', 404);
  if (position.organizationId !== organizationId) throw new MasterDataError('ASSIGNMENT_ORGANIZATION_MISMATCH', 409);
  if (organization.status !== 'ENABLED' || position.status !== 'ENABLED') throw new MasterDataError('MASTER_DATA_IN_USE', 409);
}

async function loadDetail(tx: Prisma.TransactionClient, employeeId: string): Promise<EmployeeDetail> {
  const employee = await tx.employee.findUnique({ where: { id: employeeId }, include: EMPLOYEE_DETAIL_INCLUDE });
  if (!employee) throw new MasterDataError('EMPLOYEE_NOT_FOUND', 404);
  return projectEmployeeDetail(employee);
}

function assignmentAudit(item: { employeeId: string; organizationId: string; positionId: string; assignmentType: string; startedAt: Date; endedAt: Date | null; version: number }): Record<string, unknown> {
  return { employeeId: item.employeeId, organizationId: item.organizationId, positionId: item.positionId, assignmentType: item.assignmentType as AssignmentType, startedAt: item.startedAt, endedAt: item.endedAt, version: item.version };
}

function assertActiveEmployee(status: string) { if (status === 'LEAVED') throw new MasterDataError('MASTER_DATA_IN_USE', 409); }
function versionConflict(): never { throw new MasterDataError('VERSION_CONFLICT', 409); }
function primaryConflict(): never { throw new MasterDataError('PRIMARY_ASSIGNMENT_CONFLICT', 409); }
function validationFailed(): never { throw new MasterDataError('VALIDATION_FAILED', 400); }
