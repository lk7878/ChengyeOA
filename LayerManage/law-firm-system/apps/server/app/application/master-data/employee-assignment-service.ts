import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { assertExactKeys, normalizeAllowedValue, normalizeRequiredText, normalizeVersion } from '../../domain/master-data/master-data-validation';
import { writeMasterDataAudit } from './master-data-audit';
import {
  EMPLOYEE_DETAIL_INCLUDE,
  projectAuthorizedEmployeeDetail,
  projectEmployeeDetail,
} from './employee-projection';
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
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  async transferPrimary(employeeId: string, input: TransferPrimaryInput): Promise<EmployeeDetail> {
    this.authorization.requireAction(this.authorizationContext, 'employee.assignment.manage');
    assertExactKeys(input, ['organizationId', 'positionId', 'employeeVersion']);
    const organizationId = normalizeRequiredText(input.organizationId, 1, 100);
    const positionId = normalizeRequiredText(input.positionId, 1, 100);
    const employeeVersion = normalizeVersion(input.employeeVersion);
    const organizationScopeWhere = await this.authorizedTargets(employeeId);
    const detail = await this.withAssignmentConflictMapping(() => this.prisma.$transaction(async tx => {
      const employee = await lockEmployee(tx, employeeId);
      if (employee.version !== employeeVersion) versionConflict();
      assertActiveEmployee(employee.status);
      await assertEnabledReferences(tx, organizationId, positionId, organizationScopeWhere);
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
    return this.project(detail, 'EMPLOYEE_ASSIGNMENT_TRANSFER');
  }

  async add(employeeId: string, input: AddAssignmentInput): Promise<EmployeeDetail> {
    this.authorization.requireAction(this.authorizationContext, 'employee.assignment.manage');
    assertExactKeys(input, ['organizationId', 'positionId', 'assignmentType']);
    const organizationId = normalizeRequiredText(input.organizationId, 1, 100);
    const positionId = normalizeRequiredText(input.positionId, 1, 100);
    const assignmentType = normalizeAllowedValue(input.assignmentType, ['SECONDARY', 'ACTING'] as const);
    const organizationScopeWhere = await this.authorizedTargets(employeeId);
    const detail = await this.withAssignmentConflictMapping(() => this.prisma.$transaction(async tx => {
      const employee = await lockEmployee(tx, employeeId);
      assertActiveEmployee(employee.status);
      await assertEnabledReferences(tx, organizationId, positionId, organizationScopeWhere);
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
    return this.project(detail, 'EMPLOYEE_ASSIGNMENT_ADD');
  }

  async end(employeeId: string, assignmentId: string, input: { version: number }): Promise<EmployeeDetail> {
    this.authorization.requireAction(this.authorizationContext, 'employee.assignment.manage');
    assertExactKeys(input, ['version']);
    const version = normalizeVersion(input.version);
    await Promise.all([
      this.requireEmployeeTarget(employeeId),
      this.authorization.requireRecord(
        this.authorizationContext,
        'employee_assignment',
        'employee.assignment.manage',
        assignmentId,
      ),
    ]);
    const detail = await this.prisma.$transaction(async tx => {
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
    return this.project(detail, 'EMPLOYEE_ASSIGNMENT_END');
  }

  private async withAssignmentConflictMapping<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') primaryConflict();
      throw error;
    }
  }

  private async authorizedTargets(employeeId: string): Promise<Prisma.OrganizationWhereInput> {
    await this.requireEmployeeTarget(employeeId);
    return this.authorization.buildOrganizationTargetWhere(
      this.authorizationContext,
      'employee_assignment',
      'employee.assignment.manage',
    );
  }

  private async requireEmployeeTarget(employeeId: string): Promise<void> {
    const where = await this.authorization.buildEmployeeTargetWhere(
      this.authorizationContext,
      'employee_assignment',
      'employee.assignment.manage',
    );
    const employee = await this.prisma.employee.findFirst({ where: { AND: [where, { id: employeeId }] }, select: { id: true } });
    if (!employee) authorizationHidden();
  }

  private project(detail: EmployeeDetail, purpose: string): Promise<EmployeeDetail> {
    return projectAuthorizedEmployeeDetail(this.prisma, this.authorizationContext, detail, purpose);
  }
}

async function lockEmployee(tx: Prisma.TransactionClient, employeeId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "employee" WHERE "id" = ${employeeId} FOR UPDATE`);
  const employee = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!employee || employee.deletedAt) throw new MasterDataError('EMPLOYEE_NOT_FOUND', 404);
  return employee;
}

async function assertEnabledReferences(
  tx: Prisma.TransactionClient,
  organizationId: string,
  positionId: string,
  organizationScopeWhere: Prisma.OrganizationWhereInput,
) {
  await tx.$queryRaw`SELECT "id" FROM "position" WHERE "id" = ${positionId} FOR SHARE`;
  const [organization, position] = await Promise.all([
    tx.organization.findFirst({ where: { AND: [organizationScopeWhere, { id: organizationId }] } }),
    tx.position.findFirst({ where: { id: positionId, organization: organizationScopeWhere } }),
  ]);
  if (!organization || !position) authorizationHidden();
  if (position.organizationId !== organizationId) throw new MasterDataError('ASSIGNMENT_ORGANIZATION_MISMATCH', 409);
  if (organization.status !== 'ENABLED' || position.status !== 'ENABLED') throw new MasterDataError('MASTER_DATA_IN_USE', 409);
}

async function loadDetail(tx: Prisma.TransactionClient, employeeId: string): Promise<EmployeeDetail> {
  const employee = await tx.employee.findUnique({ where: { id: employeeId }, include: EMPLOYEE_DETAIL_INCLUDE });
  if (!employee || employee.deletedAt) throw new MasterDataError('EMPLOYEE_NOT_FOUND', 404);
  return projectEmployeeDetail(employee);
}

function assignmentAudit(item: { employeeId: string; organizationId: string; positionId: string; assignmentType: string; startedAt: Date; endedAt: Date | null; version: number }): Record<string, unknown> {
  return { employeeId: item.employeeId, organizationId: item.organizationId, positionId: item.positionId, assignmentType: item.assignmentType as AssignmentType, startedAt: item.startedAt, endedAt: item.endedAt, version: item.version };
}

function assertActiveEmployee(status: string) { if (status === 'LEAVED') throw new MasterDataError('MASTER_DATA_IN_USE', 409); }
function versionConflict(): never { throw new MasterDataError('VERSION_CONFLICT', 409); }
function primaryConflict(): never { throw new MasterDataError('PRIMARY_ASSIGNMENT_CONFLICT', 409); }
function validationFailed(): never { throw new MasterDataError('VALIDATION_FAILED', 400); }
function authorizationHidden(): never { throw new MasterDataError('RESOURCE_NOT_FOUND_OR_FORBIDDEN', 404); }
