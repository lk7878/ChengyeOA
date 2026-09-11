import { EmployeeReportingLine, Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeRequiredText,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { writeMasterDataAudit } from './master-data-audit';
import { AuditActor, ReportingLineView } from './master-data-types';

export interface CreateOrReplaceReportingLineInput {
  managerEmployeeId: string;
  startedAt: Date;
  currentLineVersion?: number;
}

export class EmployeeReportingLineService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  async createOrReplace(
    employeeIdValue: string,
    input: CreateOrReplaceReportingLineInput,
  ): Promise<ReportingLineView> {
    this.authorization.requireAction(this.authorizationContext, 'employee.reporting_line.manage');
    assertExactKeys(input, ['managerEmployeeId', 'startedAt', 'currentLineVersion']);
    const employeeId = normalizeRequiredText(employeeIdValue, 1, 100);
    const managerEmployeeId = normalizeRequiredText(input.managerEmployeeId, 1, 100);
    const startedAt = normalizeDate(input.startedAt);
    const currentLineVersion = input.currentLineVersion === undefined
      ? undefined
      : normalizeVersion(input.currentLineVersion);
    if (employeeId === managerEmployeeId) reportingCycle();
    await Promise.all([
      this.requireEmployeeTarget(employeeId, 'employee.reporting_line.manage'),
      this.requireEmployeeTarget(managerEmployeeId, 'employee.reporting_line.manage'),
    ]);

    return this.withCurrentConflictMapping(() => this.prisma.$transaction(async tx => {
      const employee = await lockEmployee(tx, employeeId);
      const manager = await tx.employee.findUnique({ where: { id: managerEmployeeId } });
      if (!manager) employeeNotFound();
      if (employee.status === 'LEAVED' || manager.status === 'LEAVED') inUse();
      if (startedAt > new Date()) validationFailed();

      const current = await tx.employeeReportingLine.findFirst({ where: { employeeId, endedAt: null } });
      if (current?.managerEmployeeId === managerEmployeeId) return view(current);
      if (current && (currentLineVersion === undefined || current.version !== currentLineVersion)) {
        versionConflict();
      }
      if (current && startedAt <= current.startedAt) validationFailed();
      if (await createsCycle(tx, employeeId, managerEmployeeId, startedAt)) reportingCycle();

      if (current) {
        const changed = await tx.employeeReportingLine.updateMany({
          where: { id: current.id, version: current.version, endedAt: null },
          data: { endedAt: startedAt, version: { increment: 1 } },
        });
        if (changed.count !== 1) versionConflict();
      }
      const created = await tx.employeeReportingLine.create({
        data: { employeeId, managerEmployeeId, startedAt },
      });
      await writeMasterDataAudit(tx, {
        ...this.actor,
        action: current ? 'REPLACE_REPORTING_LINE' : 'CREATE_REPORTING_LINE',
        targetType: 'EMPLOYEE_REPORTING_LINE',
        targetId: created.id,
        before: current ? reportingLineAudit(current) : undefined,
        after: reportingLineAudit(created),
      });
      return view(created);
    }));
  }

  async end(
    employeeIdValue: string,
    lineIdValue: string,
    input: { endedAt: Date; version: number },
  ): Promise<ReportingLineView> {
    this.authorization.requireAction(this.authorizationContext, 'employee.reporting_line.manage');
    assertExactKeys(input, ['endedAt', 'version']);
    const employeeId = normalizeRequiredText(employeeIdValue, 1, 100);
    const lineId = normalizeRequiredText(lineIdValue, 1, 100);
    const endedAt = normalizeDate(input.endedAt);
    const version = normalizeVersion(input.version);
    await Promise.all([
      this.requireEmployeeTarget(employeeId, 'employee.reporting_line.manage'),
      this.authorization.requireRecord(
        this.authorizationContext,
        'employee_reporting_line',
        'employee.reporting_line.manage',
        lineId,
      ),
    ]);

    return this.prisma.$transaction(async tx => {
      await lockEmployee(tx, employeeId);
      const current = await tx.employeeReportingLine.findFirst({ where: { id: lineId, employeeId } });
      if (!current) reportingLineNotFound();
      if (current.endedAt || current.version !== version) versionConflict();
      if (endedAt <= current.startedAt || endedAt > new Date()) validationFailed();
      const changed = await tx.employeeReportingLine.updateMany({
        where: { id: lineId, employeeId, endedAt: null, version },
        data: { endedAt, version: { increment: 1 } },
      });
      if (changed.count !== 1) versionConflict();
      const after = await tx.employeeReportingLine.findUniqueOrThrow({ where: { id: lineId } });
      await writeMasterDataAudit(tx, {
        ...this.actor,
        action: 'END_REPORTING_LINE',
        targetType: 'EMPLOYEE_REPORTING_LINE',
        targetId: lineId,
        before: reportingLineAudit(current),
        after: reportingLineAudit(after),
      });
      return view(after);
    });
  }

  async list(employeeIdValue: string): Promise<ReportingLineView[]> {
    this.authorization.requireAction(this.authorizationContext, 'employee.reporting_line.read');
    const employeeId = normalizeRequiredText(employeeIdValue, 1, 100);
    await this.requireEmployeeTarget(employeeId, 'employee.reporting_line.read');
    const records = await this.prisma.employeeReportingLine.findMany({
      where: { employeeId },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    });
    return records.map(view);
  }

  async descendantEmployeeIds(managerEmployeeIdValue: string, evaluatedAt = new Date()): Promise<string[]> {
    this.authorization.requireAction(this.authorizationContext, 'employee.reporting_line.read');
    const managerEmployeeId = normalizeRequiredText(managerEmployeeIdValue, 1, 100);
    const at = normalizeDate(evaluatedAt);
    await this.requireEmployeeTarget(managerEmployeeId, 'employee.reporting_line.read');
    const descendantIds = await recursiveDescendantIds(this.prisma, managerEmployeeId, at);
    const where = await this.authorization.buildEmployeeTargetWhere(
      this.authorizationContext,
      'employee_reporting_line',
      'employee.reporting_line.read',
    );
    const visible = await this.prisma.employee.findMany({
      where: { AND: [where, { id: { in: descendantIds } }] },
      select: { id: true },
    });
    return visible.map(item => item.id);
  }

  private async withCurrentConflictMapping<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') versionConflict();
      throw error;
    }
  }

  private async requireEmployeeTarget(employeeId: string, permissionCode: PermissionCode): Promise<void> {
    const where = await this.authorization.buildEmployeeTargetWhere(
      this.authorizationContext,
      'employee_reporting_line',
      permissionCode,
    );
    const employee = await this.prisma.employee.findFirst({
      where: { AND: [where, { id: employeeId }] },
      select: { id: true },
    });
    if (!employee) authorizationHidden();
  }
}

async function lockEmployee(tx: Prisma.TransactionClient, employeeId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "employee" WHERE "id" = ${employeeId} FOR UPDATE`);
  const employee = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!employee) employeeNotFound();
  return employee;
}

async function createsCycle(
  tx: Prisma.TransactionClient,
  employeeId: string,
  managerEmployeeId: string,
  evaluatedAt: Date,
): Promise<boolean> {
  const descendants = await recursiveDescendantIds(tx, employeeId, evaluatedAt);
  return descendants.includes(managerEmployeeId);
}

async function recursiveDescendantIds(
  client: PrismaClient | Prisma.TransactionClient,
  managerEmployeeId: string,
  evaluatedAt: Date,
): Promise<string[]> {
  const rows = await client.$queryRaw<Array<{ employeeId: string }>>(Prisma.sql`
    WITH RECURSIVE subordinate_tree AS (
      SELECT "employeeId"
      FROM "employee_reporting_line"
      WHERE "managerEmployeeId" = ${managerEmployeeId}
        AND "startedAt" <= ${evaluatedAt}
        AND ("endedAt" IS NULL OR "endedAt" > ${evaluatedAt})
      UNION
      SELECT line."employeeId"
      FROM "employee_reporting_line" line
      INNER JOIN subordinate_tree tree ON line."managerEmployeeId" = tree."employeeId"
      WHERE line."startedAt" <= ${evaluatedAt}
        AND (line."endedAt" IS NULL OR line."endedAt" > ${evaluatedAt})
    )
    SELECT "employeeId" FROM subordinate_tree
  `);
  return rows.map(row => row.employeeId);
}

function normalizeDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) validationFailed();
  return new Date(value.getTime());
}

function view(line: EmployeeReportingLine): ReportingLineView {
  return {
    id: line.id,
    employeeId: line.employeeId,
    managerEmployeeId: line.managerEmployeeId,
    startedAt: line.startedAt,
    endedAt: line.endedAt,
    version: line.version,
  };
}

function reportingLineAudit(line: EmployeeReportingLine): Record<string, unknown> {
  return {
    employeeId: line.employeeId,
    managerEmployeeId: line.managerEmployeeId,
    startedAt: line.startedAt,
    endedAt: line.endedAt,
    version: line.version,
  };
}

function employeeNotFound(): never { throw new MasterDataError('EMPLOYEE_NOT_FOUND', 404); }
function reportingLineNotFound(): never { throw new MasterDataError('REPORTING_LINE_NOT_FOUND', 404); }
function reportingCycle(): never { throw new MasterDataError('REPORTING_LINE_CYCLE', 409); }
function versionConflict(): never { throw new MasterDataError('VERSION_CONFLICT', 409); }
function validationFailed(): never { throw new MasterDataError('VALIDATION_FAILED', 400); }
function inUse(): never { throw new MasterDataError('MASTER_DATA_IN_USE', 409); }
function authorizationHidden(): never { throw new MasterDataError('RESOURCE_NOT_FOUND_OR_FORBIDDEN', 404); }
