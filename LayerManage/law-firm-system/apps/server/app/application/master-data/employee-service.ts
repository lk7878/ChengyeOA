import { Employee, Prisma, PrismaClient } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys, normalizeAllowedValue, normalizeEmployeeNo, normalizeName, normalizeOptionalText,
  normalizeRequiredText, normalizeStableCode, normalizeStringArray, normalizeVersion, parseIsoDate,
} from '../../domain/master-data/master-data-validation';
import { writeMasterDataAudit } from './master-data-audit';
import { EMPLOYEE_DETAIL_INCLUDE, projectEmployeeDetail } from './employee-projection';
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
  constructor(private readonly prisma: PrismaClient, private readonly actor: AuditActor) {}

  async create(input: CreateWithPrimary): Promise<EmployeeDetail> {
    assertExactKeys(input, ['employeeNo','name','phone','email','idCard','licenseNo','employeeType','professionalDirections','entryDate','primaryOrganizationId','primaryPositionId']);
    const values = normalizeCreate(input);
    try {
      return await this.prisma.$transaction(async tx => {
        await assertEnabledReferences(tx, values.primaryOrganizationId, values.primaryPositionId);
        const employee = await tx.employee.create({ data: {
          employeeNo: values.employeeNo, name: values.name, phone: values.phone, email: values.email,
          idCard: values.idCard, licenseNo: values.licenseNo, type: values.employeeType,
          professionalDirections: values.professionalDirections, entryDate: values.entryDate,
          orgId: values.primaryOrganizationId, positionId: values.primaryPositionId,
        } });
        await tx.employeeAssignment.create({ data: {
          employeeId: employee.id, organizationId: values.primaryOrganizationId, positionId: values.primaryPositionId,
          assignmentType: 'PRIMARY', startedAt: values.entryDate,
        } });
        await writeMasterDataAudit(tx, { ...this.actor, action: 'CREATE', targetType: 'EMPLOYEE', targetId: employee.id, after: employeeAudit(employee) });
        return loadDetail(tx, employee.id);
      });
    } catch (error) { mapIdentityConflict(error); throw error; }
  }

  async update(id: string, input: UpdateEmployeeInput & { version: number }): Promise<EmployeeDetail> {
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
    return this.mutateIdentity(async tx => {
      const before = await tx.employee.findUnique({ where: { id } }); if (!before) notFound();
      const changed = await tx.employee.updateMany({ where: { id, version }, data }); if (changed.count !== 1) versionConflict();
      const after = await tx.employee.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, { ...this.actor, action: 'UPDATE', targetType: 'EMPLOYEE', targetId: id, before: employeeAudit(before), after: employeeAudit(after) });
      return loadDetail(tx, id);
    });
  }

  async formalize(id: string, input: { formalDate: string; version: number }): Promise<EmployeeDetail> {
    assertExactKeys(input, ['formalDate','version']);
    const formalDate = parseIsoDate(input.formalDate); const version = normalizeVersion(input.version);
    return this.prisma.$transaction(async tx => {
      const before = await lockEmployee(tx, id); if (before.version !== version) versionConflict();
      if (before.status !== 'PROBATION' || formalDate < before.entryDate) validationFailed();
      await tx.employee.update({ where: { id }, data: { status: 'FORMAL', formalDate, version: { increment: 1 } } });
      const after = await tx.employee.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, { ...this.actor, action: 'FORMALIZE', targetType: 'EMPLOYEE', targetId: id, before: employeeAudit(before), after: employeeAudit(after) });
      return loadDetail(tx, id);
    });
  }

  async leave(id: string, input: { leaveDate: string; handoverConfirmed: true; version: number }): Promise<EmployeeDetail> {
    assertExactKeys(input, ['leaveDate','handoverConfirmed','version']);
    if (input.handoverConfirmed !== true) validationFailed();
    const leaveDate = parseIsoDate(input.leaveDate); const version = normalizeVersion(input.version);
    return this.prisma.$transaction(async tx => {
      const before = await lockEmployee(tx, id); if (before.version !== version) versionConflict();
      if (before.status === 'LEAVED' || leaveDate < before.entryDate) validationFailed();
      const initialization = await tx.systemInitialization.findUnique({ where: { id: 'PRIMARY' }, include: { superAdminUser: true } });
      if (initialization?.superAdminUser.employeeId === id) throw new MasterDataError('TRUST_ROOT_PROTECTED', 409);
      const [lead, legalCase] = await Promise.all([
        tx.lead.findFirst({ where: { assignedTo: id, status: { notIn: ['SIGNED','LOST'] } }, select: { id: true } }),
        tx.case.findFirst({ where: { lawyerId: id, status: { notIn: ['CLOSED','ARCHIVED'] } }, select: { id: true } }),
      ]);
      if (lead || legalCase) inUse();
      const now = new Date();
      await tx.employeeAssignment.updateMany({ where: { employeeId: id, endedAt: null }, data: { endedAt: now, version: { increment: 1 } } });
      await tx.professionalTeamMember.updateMany({ where: { employeeId: id, endedAt: null }, data: { endedAt: now, version: { increment: 1 } } });
      await tx.employee.update({ where: { id }, data: { status: 'LEAVED', leaveDate, version: { increment: 1 } } });
      await tx.user.updateMany({ where: { employeeId: id }, data: { status: 'DISABLED', credentialVersion: { increment: 1 } } });
      const after = await tx.employee.findUniqueOrThrow({ where: { id } });
      await writeMasterDataAudit(tx, { ...this.actor, action: 'LEAVE', targetType: 'EMPLOYEE', targetId: id, before: employeeAudit(before), after: employeeAudit(after) });
      return loadDetail(tx, id);
    });
  }

  async list(query: EmployeeListQuery): Promise<Paginated<EmployeeListItem>> {
    assertExactKeys(query, ['page','pageSize','keyword','status','organizationId','teamId']);
    const page = normalizeVersion(query.page); const pageSize = normalizeVersion(query.pageSize); if (pageSize > 100) validationFailed();
    const keyword = query.keyword === undefined ? undefined : normalizeRequiredText(query.keyword, 1, 100);
    const status = query.status === undefined ? undefined : normalizeAllowedValue(query.status, ['PROBATION','FORMAL','LEAVED'] as const);
    const where: Prisma.EmployeeWhereInput = {
      status,
      OR: keyword ? [{ name: { contains: keyword, mode: 'insensitive' } }, { employeeNo: { contains: keyword, mode: 'insensitive' } }] : undefined,
      assignments: query.organizationId ? { some: { organizationId: query.organizationId, endedAt: null } } : undefined,
      professionalTeams: query.teamId ? { some: { professionalTeamId: query.teamId, endedAt: null } } : undefined,
    };
    const [total, records] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({ where, include: EMPLOYEE_DETAIL_INCLUDE, orderBy: [{ employeeNo: 'asc' }], skip: (page-1)*pageSize, take: pageSize }),
    ]);
    return { list: records.map(record => { const detail = projectEmployeeDetail(record); return {
      id: detail.id, employeeNo: detail.employeeNo, name: detail.name, employeeType: detail.employeeType,
      status: detail.status, version: detail.version, primaryAssignment: detail.primaryAssignment,
    }; }), pagination: { page, pageSize, total, totalPages: Math.ceil(total/pageSize) } };
  }

  async detail(id: string): Promise<EmployeeDetail> { const employee = await this.prisma.employee.findUnique({ where: { id }, include: EMPLOYEE_DETAIL_INCLUDE }); if (!employee) notFound(); return projectEmployeeDetail(employee); }

  private async mutateIdentity<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(run); } catch (error) { mapIdentityConflict(error); throw error; }
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
async function assertEnabledReferences(tx: Prisma.TransactionClient, organizationId: string, positionId: string) { const [org,pos]=await Promise.all([tx.organization.findUnique({where:{id:organizationId}}),tx.position.findUnique({where:{id:positionId}})]); if(!org||!pos) throw new MasterDataError('MASTER_DATA_NOT_FOUND',404); if(pos.organizationId!==organizationId) throw new MasterDataError('ASSIGNMENT_ORGANIZATION_MISMATCH',409); if(org.status!=='ENABLED'||pos.status!=='ENABLED') inUse(); }
async function lockEmployee(tx: Prisma.TransactionClient,id:string){await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "employee" WHERE "id"=${id} FOR UPDATE`);const e=await tx.employee.findUnique({where:{id}});if(!e)notFound();return e;}
async function loadDetail(tx: Prisma.TransactionClient,id:string){const e=await tx.employee.findUnique({where:{id},include:EMPLOYEE_DETAIL_INCLUDE});if(!e)notFound();return projectEmployeeDetail(e);}
function employeeAudit(e:Employee):Record<string,unknown>{return{employeeId:e.id,status:e.status,version:e.version,formalDate:e.formalDate,leaveDate:e.leaveDate};}
function mapIdentityConflict(error:unknown){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new MasterDataError('EMPLOYEE_IDENTITY_CONFLICT',409);}
function notFound():never{throw new MasterDataError('EMPLOYEE_NOT_FOUND',404);} function versionConflict():never{throw new MasterDataError('VERSION_CONFLICT',409);} function validationFailed():never{throw new MasterDataError('VALIDATION_FAILED',400);} function inUse():never{throw new MasterDataError('MASTER_DATA_IN_USE',409);}
