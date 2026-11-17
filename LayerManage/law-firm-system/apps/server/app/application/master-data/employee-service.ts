import { deletedUsername } from '../system/deleted-username';
import { Employee, Prisma, PrismaClient } from '@prisma/client';
import { transferEmployeeResources } from './employee-resource-transfer';
import { blockerCounts, employeeHandoverBlockers, employeeOffboardingOverview } from './employee-offboarding';
import { assertMutableUser } from '../system/trust-root-guard';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { FieldProjectionService } from '../authorization/field-projection-service';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys, normalizeAllowedValue, normalizeEmployeeNo, normalizeName, normalizeOptionalText,
  normalizeRequiredText, normalizeStableCode, normalizeStringArray, normalizeVersion, parseIsoDate,
} from '../../domain/master-data/master-data-validation';
import { writeMasterDataAudit } from './master-data-audit';
import { EMPLOYEE_DETAIL_INCLUDE, projectAuthorizedEmployeeDetail, projectEmployeeDetail } from './employee-projection';
import { AuditActor, EmployeeDetail, EmployeeListItem, Paginated } from './master-data-types';

export interface CreateEmployeeInput {
  employeeNo: string; name: string; phone: string; email?: string | null; idCard?: string | null;
  licenseNo?: string | null; employeeType: string; professionalDirections?: string[]; entryDate: string;
}
export interface UpdateEmployeeInput {
  name?: string; phone?: string; email?: string | null; idCard?: string | null; licenseNo?: string | null;
  employeeType?: string; professionalDirections?: string[];
}
export interface EmployeeListQuery { page: number; pageSize: number; keyword?: string; status?: string; organizationId?: string; teamId?: string }
type CreateWithPrimary = CreateEmployeeInput & { primaryOrganizationId: string; primaryPositionId: string };

export class EmployeeService {
  private readonly authorization: AuthorizationService;
  private readonly fields = new FieldProjectionService();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  async create(input: CreateWithPrimary): Promise<EmployeeDetail> {
    this.authorization.requireAction(this.authorizationContext, 'employee.create');
    this.requireWritableFields(input, 'employee.create');
    assertExactKeys(input, ['employeeNo','name','phone','email','idCard','licenseNo','employeeType','professionalDirections','entryDate','primaryOrganizationId','primaryPositionId']);
    const values = normalizeCreate(input);
    const organizationScopeWhere = await this.authorization.buildOrganizationTargetWhere(
      this.authorizationContext,
      'employee',
      'employee.create',
    );
    try {
      const detail = await this.prisma.$transaction(async tx => {
        await assertEnabledReferences(
          tx,
          values.primaryOrganizationId,
          values.primaryPositionId,
          organizationScopeWhere,
        );
        const employee = await tx.employee.create({ data: {
          employeeNo: values.employeeNo, name: values.name, phone: values.phone, email: values.email,
          idCard: values.idCard, licenseNo: values.licenseNo, type: values.employeeType,
          professionalDirections: values.professionalDirections, entryDate: values.entryDate,
        } });
        await tx.employeeAssignment.create({ data: {
          employeeId: employee.id, organizationId: values.primaryOrganizationId, positionId: values.primaryPositionId,
          assignmentType: 'PRIMARY', startedAt: values.entryDate,
        } });
        await writeMasterDataAudit(tx, { ...this.actor, action: 'CREATE', targetType: 'EMPLOYEE', targetId: employee.id, after: employeeAudit(employee) });
        return loadDetail(tx, employee.id);
      });
      return this.project(detail, 'EMPLOYEE_CREATE');
    } catch (error) { mapIdentityConflict(error); throw error; }
  }

  async update(id: string, input: UpdateEmployeeInput & { version: number }): Promise<EmployeeDetail> {
    this.authorization.requireAction(this.authorizationContext, 'employee.update');
    assertExactKeys(input, ['name','phone','email','idCard','licenseNo','employeeType','professionalDirections','version']);
    const version = normalizeVersion(input.version);
    const data: Prisma.EmployeeUpdateManyMutationInput = { version: { increment: 1 } };
    if (input.name !== undefined) data.name = normalizeName(input.name);
    if (input.phone !== undefined) data.phone = normalizeRequiredText(input.phone, 5, 30);
    if (input.email !== undefined) data.email = normalizeEmail(input.email);
    if (input.idCard !== undefined) data.idCard = normalizeOptionalText(input.idCard, 100);
    if (input.licenseNo !== undefined) data.licenseNo = normalizeOptionalText(input.licenseNo, 100);
    if (input.employeeType !== undefined) data.type = normalizeStableCode(input.employeeType);
    if (input.professionalDirections !== undefined) data.professionalDirections = normalizeStringArray(input.professionalDirections, 20, 100);
    await this.authorization.requireRecord(this.authorizationContext, 'employee', 'employee.update', id);
    this.requireWritableFields(input, 'employee.update');
    const detail = await this.mutateIdentity(async tx => {
      const before = await lockEmployee(tx, id);
      const changed = await tx.employee.updateMany({ where: { id, version }, data }); if (changed.count !== 1) versionConflict();
      const after = await tx.employee.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, { ...this.actor, action: 'UPDATE', targetType: 'EMPLOYEE', targetId: id, before: employeeAudit(before), after: employeeAudit(after) });
      return loadDetail(tx, id);
    });
    return this.project(detail, 'EMPLOYEE_UPDATE');
  }

  async formalize(id: string, input: { formalDate: string; version: number }): Promise<EmployeeDetail> {
    this.authorization.requireAction(this.authorizationContext, 'employee.formalize');
    assertExactKeys(input, ['formalDate','version']);
    const formalDate = parseIsoDate(input.formalDate); const version = normalizeVersion(input.version);
    await this.authorization.requireRecord(this.authorizationContext, 'employee', 'employee.formalize', id);
    this.fields.requireWritableField(
      this.authorizationContext,
      'employee',
      'employee.formalDate',
      'employee.formalize',
    );
    const detail = await this.prisma.$transaction(async tx => {
      const before = await lockEmployee(tx, id); if (before.version !== version) versionConflict();
      if (before.status !== 'PROBATION' || formalDate < before.entryDate) validationFailed();
      await tx.employee.update({ where: { id }, data: { status: 'FORMAL', formalDate, version: { increment: 1 } } });
      const after = await tx.employee.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, { ...this.actor, action: 'FORMALIZE', targetType: 'EMPLOYEE', targetId: id, before: employeeAudit(before), after: employeeAudit(after) });
      return loadDetail(tx, id);
    });
    return this.project(detail, 'EMPLOYEE_FORMALIZE');
  }

  async leave(id: string, input: { leaveDate: string; handoverConfirmed: true; version: number }): Promise<EmployeeDetail> {
    this.authorization.requireAction(this.authorizationContext, 'employee.leave');
    assertExactKeys(input, ['leaveDate','handoverConfirmed','version']);
    if (input.handoverConfirmed !== true) validationFailed();
    const leaveDate = parseIsoDate(input.leaveDate); const version = normalizeVersion(input.version);
    await this.authorization.requireRecord(this.authorizationContext, 'employee', 'employee.leave', id);
    this.fields.requireWritableField(
      this.authorizationContext,
      'employee',
      'employee.leaveDate',
      'employee.leave',
    );
    const detail = await this.prisma.$transaction(async tx => {
      const before = await lockEmployee(tx, id); if (before.version !== version) versionConflict();
      if (before.status === 'LEAVED' || leaveDate < before.entryDate) validationFailed();
      await endEmploymentTx(tx, before, leaveDate);
      const after = await tx.employee.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, { ...this.actor, action: 'LEAVE', targetType: 'EMPLOYEE', targetId: id, before: employeeAudit(before), after: employeeAudit(after) });
      return loadDetail(tx, id);
    });
    return this.project(detail, 'EMPLOYEE_LEAVE');
  }

  async offboarding(id: string) {
    if (!this.authorizationContext.isSystemSuperAdmin) throw new MasterDataError('SUPER_ADMIN_REQUIRED', 403);
    await this.authorization.requireRecord(this.authorizationContext, 'employee', 'employee.leave', id);
    const employee = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!employee) notFound();
    return employeeOffboardingOverview(this.prisma, id);
  }

  async suspendAccount(id: string, input: { version: number; confirmed: true }) {
    if (!this.authorizationContext.isSystemSuperAdmin) throw new MasterDataError('SUPER_ADMIN_REQUIRED', 403);
    assertExactKeys(input, ['version', 'confirmed']);
    if (input.confirmed !== true) validationFailed();
    const version = normalizeVersion(input.version);
    await this.authorization.requireRecord(this.authorizationContext, 'employee', 'employee.leave', id);
    await this.prisma.$transaction(async tx => {
      const employee = await lockEmployee(tx, id);
      if (employee.version !== version) versionConflict();
      const account = await tx.user.findUnique({ where: { employeeId: id } });
      if (!account) throw new MasterDataError('EMPLOYEE_ACCOUNT_NOT_BOUND', 409);
      if (account.id === this.actor.actorUserId) throw new MasterDataError('EMPLOYEE_DELETE_SELF', 409);
      await assertMutableUser(tx, account.id);
      if (account.status === 'DELETED') notFound();
      await tx.user.update({ where: { id: account.id }, data: { status: 'DISABLED', credentialVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId: account.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'EMPLOYEE_OFFBOARDING_SUSPEND' } });
      await tx.employee.update({ where: { id }, data: { version: { increment: 1 } } });
      await writeMasterDataAudit(tx, { ...this.actor, action: 'SUSPEND_ACCOUNT', targetType: 'EMPLOYEE', targetId: id, before: { accountStatus: account.status }, after: { accountStatus: 'DISABLED', accountId: account.id } });
    });
    return this.detail(id);
  }

  async remove(id: string, input: { version: number; confirmed: true; recipientUserId?: string; deleteAccount?: boolean }): Promise<void> {
    if (!this.authorizationContext.isSystemSuperAdmin) throw new MasterDataError('SUPER_ADMIN_REQUIRED', 403);
    this.authorization.requireAction(this.authorizationContext, 'employee.leave');
    assertExactKeys(input, ['version', 'confirmed', 'recipientUserId', 'deleteAccount']);
    if (input.deleteAccount !== undefined && typeof input.deleteAccount !== 'boolean') validationFailed();
    const recipientUserId = input.recipientUserId === undefined ? undefined : normalizeRequiredText(input.recipientUserId, 1, 100);
    if (input.confirmed !== true) validationFailed();
    const version = normalizeVersion(input.version);
    if (this.authorizationContext.employeeId === id) throw new MasterDataError('EMPLOYEE_DELETE_SELF', 409);
    try {
      await this.prisma.$transaction(async tx => {
        const before = await lockEmployee(tx, id);
        if (before.version !== version) versionConflict();
          const selfAccount = await tx.user.findFirst({ where: { id: this.actor.actorUserId, employeeId: id }, select: { id: true } });
          if (selfAccount) throw new MasterDataError('EMPLOYEE_DELETE_SELF', 409);
          const account = await tx.user.findUnique({ where: { employeeId: id } });
          if (input.deleteAccount && account) {
            if (before.status !== 'LEAVED' || account.status !== 'DISABLED') throw new MasterDataError('EMPLOYEE_OFFBOARDING_INCOMPLETE', 409);
            await assertMutableUser(tx, account.id);
          }
        const transferred = await transferEmployeeResources(tx, id, recipientUserId);
        const now = new Date();
          await endEmploymentTx(tx, before, before.leaveDate ?? (before.entryDate > now ? before.entryDate : now), now);
          // Preserve foreign keys and audit attribution while removing the login account from management lists.
          if (input.deleteAccount && account) await tx.user.update({ where: { id: account.id }, data: { status: 'DELETED', username: deletedUsername(account.id, account.username) } });
        const after = await tx.employee.findUniqueOrThrow({ where: { id } });
        await writeMasterDataAudit(tx, { ...this.actor, action: 'DELETE', targetType: 'EMPLOYEE', targetId: id, before: employeeAudit(before), after: { ...employeeAudit(after), transferred, deleteAccount: input.deleteAccount === true, ...(input.deleteAccount && account ? { deletedAccountId: account.id, deletedAccountUsername: account.username } : {}) } });
      });
    } catch (error) {
      if (error instanceof MasterDataError && error.code === 'MASTER_DATA_IN_USE') throw new MasterDataError('EMPLOYEE_DELETE_IN_USE', 409, error.errors);
      throw error;
    }
  }

  async list(query: EmployeeListQuery): Promise<Paginated<EmployeeListItem>> {
    this.authorization.requireAction(this.authorizationContext, 'employee.read');
    assertExactKeys(query, ['page','pageSize','keyword','status','organizationId','teamId']);
    const page = normalizeVersion(query.page); const pageSize = normalizeVersion(query.pageSize); if (pageSize > 100) validationFailed();
    const keyword = query.keyword === undefined ? undefined : normalizeRequiredText(query.keyword, 1, 100);
    const status = query.status === undefined ? undefined : normalizeAllowedValue(query.status, ['PROBATION','FORMAL','LEAVED'] as const);
    const scopeWhere = await this.authorization.buildScopeWhere(
      this.authorizationContext,
      'employee',
      'employee.read',
    );
    const filters: Prisma.EmployeeWhereInput = {
      deletedAt: null, status,
      OR: keyword ? [{ name: { contains: keyword, mode: 'insensitive' } }, { employeeNo: { contains: keyword, mode: 'insensitive' } }] : undefined,
      assignments: query.organizationId ? { some: { organizationId: query.organizationId, endedAt: null } } : undefined,
      professionalTeams: query.teamId ? { some: { professionalTeamId: query.teamId, endedAt: null } } : undefined,
    };
    const where: Prisma.EmployeeWhereInput = { AND: [scopeWhere, filters] };
    const [total, records] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({ where, include: EMPLOYEE_DETAIL_INCLUDE, orderBy: [{ employeeNo: 'asc' }], skip: (page-1)*pageSize, take: pageSize }),
    ]);
    return { list: records.map(record => { const detail = projectEmployeeDetail(record); return {
      id: detail.id, employeeNo: detail.employeeNo, name: detail.name, employeeType: detail.employeeType,
      status: detail.status, entryDate: detail.entryDate, activeProfessionalTeamIds: detail.activeProfessionalTeamIds,
      version: detail.version, primaryAssignment: detail.primaryAssignment,
    }; }), pagination: { page, pageSize, total, totalPages: Math.ceil(total/pageSize) } };
  }

  async detail(id: string): Promise<EmployeeDetail> {
    this.authorization.requireAction(this.authorizationContext, 'employee.read');
    const scopeWhere = await this.authorization.buildScopeWhere(
      this.authorizationContext,
      'employee',
      'employee.read',
    );
    const employee = await this.prisma.employee.findFirst({
      where: { AND: [scopeWhere, { id, deletedAt: null }] },
      include: EMPLOYEE_DETAIL_INCLUDE,
    });
    if (!employee) authorizationHidden();
    return this.project(projectEmployeeDetail(employee), 'EMPLOYEE_DETAIL');
  }

  private async mutateIdentity<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(run); } catch (error) { mapIdentityConflict(error); throw error; }
  }

  private requireWritableFields(input: object, permissionCode: PermissionCode): void {
    const fieldCodes: Record<string, string> = {
      employeeNo: 'employee.employeeNo',
      name: 'employee.name',
      phone: 'employee.phone',
      email: 'employee.email',
      idCard: 'employee.idCard',
      licenseNo: 'employee.licenseNo',
      employeeType: 'employee.type',
      professionalDirections: 'employee.professionalDirections',
      entryDate: 'employee.entryDate',
    };
    const values = input as Record<string, unknown>;
    for (const [field, fieldCode] of Object.entries(fieldCodes)) {
      if (values[field] === undefined) continue;
      this.fields.requireWritableField(
        this.authorizationContext,
        'employee',
        fieldCode,
        permissionCode,
      );
    }
  }

  private project(detail: EmployeeDetail, purpose: string): Promise<EmployeeDetail> {
    return projectAuthorizedEmployeeDetail(this.prisma, this.authorizationContext, detail, purpose);
  }
}

function normalizeCreate(input: CreateWithPrimary) {
  return {
    employeeNo: normalizeEmployeeNo(input.employeeNo), name: normalizeName(input.name), phone: normalizeRequiredText(input.phone,5,30),
    email: normalizeEmail(input.email), idCard: normalizeOptionalText(input.idCard,100), licenseNo: normalizeOptionalText(input.licenseNo,100),
    employeeType: normalizeStableCode(input.employeeType), professionalDirections: input.professionalDirections ? normalizeStringArray(input.professionalDirections,20,100) : [],
    entryDate: parseIsoDate(input.entryDate), primaryOrganizationId: normalizeRequiredText(input.primaryOrganizationId,1,100), primaryPositionId: normalizeRequiredText(input.primaryPositionId,1,100),
  };
}
function normalizeEmail(value: unknown): string | null { const email = normalizeOptionalText(value,254); if (email === null) return null; const normalized=email.toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) validationFailed(); return normalized; }
async function assertEnabledReferences(
  tx: Prisma.TransactionClient,
  organizationId: string,
  positionId: string,
  organizationScopeWhere: Prisma.OrganizationWhereInput,
) {
  await tx.$queryRaw`SELECT "id" FROM "position" WHERE "id" = ${positionId} FOR SHARE`;
  const [org,pos]=await Promise.all([
    tx.organization.findFirst({where:{AND:[organizationScopeWhere,{id:organizationId}]}}),
    tx.position.findFirst({where:{id:positionId,organization:organizationScopeWhere}}),
  ]);
  if(!org||!pos) authorizationHidden();
  if(pos.organizationId!==organizationId) throw new MasterDataError('ASSIGNMENT_ORGANIZATION_MISMATCH',409);
  if(org.status!=='ENABLED'||pos.status!=='ENABLED') inUse();
}
async function lockEmployee(tx: Prisma.TransactionClient,id:string){await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "employee" WHERE "id"=${id} FOR UPDATE`);const e=await tx.employee.findUnique({where:{id}});if(!e || e.deletedAt)notFound();return e;}
async function loadDetail(tx: Prisma.TransactionClient,id:string){const e=await tx.employee.findUnique({where:{id},include:EMPLOYEE_DETAIL_INCLUDE});if(!e)notFound();return projectEmployeeDetail(e);}
function employeeAudit(e:Employee):Record<string,unknown>{return{employeeId:e.id,status:e.status,version:e.version,formalDate:e.formalDate,leaveDate:e.leaveDate,deletedAt:e.deletedAt};}
function mapIdentityConflict(error:unknown){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new MasterDataError('EMPLOYEE_IDENTITY_CONFLICT',409);}
function notFound():never{throw new MasterDataError('EMPLOYEE_NOT_FOUND',404);} function versionConflict():never{throw new MasterDataError('VERSION_CONFLICT',409);} function validationFailed():never{throw new MasterDataError('VALIDATION_FAILED',400);} function inUse():never{throw new MasterDataError('MASTER_DATA_IN_USE',409);}
function authorizationHidden():never{throw new MasterDataError('RESOURCE_NOT_FOUND_OR_FORBIDDEN',404);}

async function endEmploymentTx(tx: Prisma.TransactionClient, before: Employee, leaveDate: Date, deletedAt?: Date) {
  const id = before.id;
  const initialization = await tx.systemInitialization.findUnique({ where: { id: 'PRIMARY' }, include: { superAdminUser: true } });
  if (initialization?.superAdminUser.employeeId === id) throw new MasterDataError('TRUST_ROOT_PROTECTED', 409);
  const counts = blockerCounts(await employeeHandoverBlockers(tx, id));
  if (Object.values(counts).some(count => count > 0)) throw new MasterDataError('MASTER_DATA_IN_USE', 409, { employeeHandoverBlockers: counts });
  const now = deletedAt ?? new Date();
  await tx.employeeAssignment.updateMany({ where: { employeeId: id, endedAt: null }, data: { endedAt: now, version: { increment: 1 } } });
  await tx.professionalTeamMember.updateMany({ where: { employeeId: id, endedAt: null }, data: { endedAt: now, version: { increment: 1 } } });
  await tx.employeeReportingLine.updateMany({
    where: { employeeId: id, endedAt: null },
    data: { endedAt: now, version: { increment: 1 } },
  });
  await tx.employee.update({ where: { id }, data: { status: 'LEAVED', leaveDate, deletedAt, version: { increment: 1 } } });
  await tx.user.updateMany({ where: { employeeId: id }, data: { status: 'DISABLED', credentialVersion: { increment: 1 } } });

}
