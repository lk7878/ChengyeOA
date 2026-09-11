import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeRequiredText,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { writeMasterDataAudit } from './master-data-audit';
import {
  EMPLOYEE_DETAIL_INCLUDE,
  projectAuthorizedEmployeeDetail,
  projectEmployeeDetail,
} from './employee-projection';
import { AuditActor, EmployeeDetail } from './master-data-types';

interface BindAccountInput {
  userId: string;
  employeeVersion: number;
}

interface UnbindAccountInput {
  employeeVersion: number;
}

export class EmployeeAccountBindingService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  async bind(employeeId: string, input: BindAccountInput): Promise<EmployeeDetail> {
    this.authorization.requireAction(this.authorizationContext, 'employee.account_binding.manage');
    assertExactKeys(input, ['userId', 'employeeVersion']);
    const userId = normalizeRequiredText(input.userId, 1, 100);
    const employeeVersion = normalizeVersion(input.employeeVersion);
    await this.requireEmployeeTarget(employeeId);

    try {
      const detail = await this.prisma.$transaction(async tx => {
        const employee = await lockEmployee(tx, employeeId);
        if (employee.version !== employeeVersion) versionConflict();

        const user = await lockUser(tx, userId);
        const currentAccount = await tx.user.findUnique({ where: { employeeId } });
        if (user.employeeId !== null || currentAccount !== null) accountBindingConflict();

        await tx.user.update({ where: { id: userId }, data: { employeeId } });
        await incrementEmployeeVersion(tx, employeeId, employeeVersion);
        await writeMasterDataAudit(tx, {
          ...this.actor,
          action: 'BIND_ACCOUNT',
          targetType: 'USER',
          targetId: userId,
          before: { employeeId: null, version: employee.version },
          after: { employeeId, version: employee.version + 1 },
        });
        return loadEmployeeDetail(tx, employeeId);
      });
      return this.project(detail, 'EMPLOYEE_ACCOUNT_BIND');
    } catch (error) {
      mapBindingConstraint(error);
      throw error;
    }
  }

  async unbind(employeeId: string, input: UnbindAccountInput): Promise<EmployeeDetail> {
    this.authorization.requireAction(this.authorizationContext, 'employee.account_binding.manage');
    assertExactKeys(input, ['employeeVersion']);
    const employeeVersion = normalizeVersion(input.employeeVersion);
    await this.requireEmployeeTarget(employeeId);

    const detail = await this.prisma.$transaction(async tx => {
      const employee = await lockEmployee(tx, employeeId);
      if (employee.version !== employeeVersion) versionConflict();

      const account = await tx.user.findUnique({ where: { employeeId } });
      if (!account) accountBindingConflict();
      const lockedAccount = await lockUser(tx, account.id);
      if (lockedAccount.employeeId !== employeeId) accountBindingConflict();

      await tx.user.update({ where: { id: lockedAccount.id }, data: { employeeId: null } });
      await incrementEmployeeVersion(tx, employeeId, employeeVersion);
      await writeMasterDataAudit(tx, {
        ...this.actor,
        action: 'UNBIND_ACCOUNT',
        targetType: 'USER',
        targetId: lockedAccount.id,
        before: { employeeId, version: employee.version },
        after: { employeeId: null, version: employee.version + 1 },
      });
      return loadEmployeeDetail(tx, employeeId);
    });
    return this.project(detail, 'EMPLOYEE_ACCOUNT_UNBIND');
  }

  private async requireEmployeeTarget(employeeId: string): Promise<void> {
    const where = await this.authorization.buildEmployeeTargetWhere(
      this.authorizationContext,
      'employee_account_binding',
      'employee.account_binding.manage',
    );
    const employee = await this.prisma.employee.findFirst({
      where: { AND: [where, { id: employeeId }] },
      select: { id: true },
    });
    if (!employee) throw new MasterDataError('RESOURCE_NOT_FOUND_OR_FORBIDDEN', 404);
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

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${userId} FOR UPDATE`);
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw new MasterDataError('USER_NOT_FOUND', 404);
  return user;
}

async function incrementEmployeeVersion(
  tx: Prisma.TransactionClient,
  employeeId: string,
  employeeVersion: number,
): Promise<void> {
  const changed = await tx.employee.updateMany({
    where: { id: employeeId, version: employeeVersion },
    data: { version: { increment: 1 } },
  });
  if (changed.count !== 1) versionConflict();
}

async function loadEmployeeDetail(
  tx: Prisma.TransactionClient,
  employeeId: string,
): Promise<EmployeeDetail> {
  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    include: EMPLOYEE_DETAIL_INCLUDE,
  });
  if (!employee || employee.deletedAt) throw new MasterDataError('EMPLOYEE_NOT_FOUND', 404);
  return projectEmployeeDetail(employee);
}

function mapBindingConstraint(error: unknown): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    accountBindingConflict();
  }
}

function versionConflict(): never {
  throw new MasterDataError('VERSION_CONFLICT', 409);
}

function accountBindingConflict(): never {
  throw new MasterDataError('ACCOUNT_BINDING_CONFLICT', 409);
}
