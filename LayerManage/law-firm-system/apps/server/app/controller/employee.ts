import { Controller } from 'egg';
import {
  employeeService,
} from '../application/master-data/master-data-factory';
import {
  CreateEmployeeInput,
  EmployeeListQuery,
  UpdateEmployeeInput,
} from '../application/master-data/employee-service';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeEmployeeNo,
  normalizeName,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeStableCode,
  normalizeStringArray,
  normalizeVersion,
  parseIsoDate,
} from '../domain/master-data/master-data-validation';
import { MasterDataError } from '../domain/master-data/master-data-errors';

type CreateEmployeeRequest = CreateEmployeeInput & {
  primaryOrganizationId: string;
  primaryPositionId: string;
};

export default class EmployeeController extends Controller {
  async index() {
    this.respond(await employeeService(this.ctx).list(parseListQuery(this.ctx.query)));
  }

  async show() {
    this.respond(await employeeService(this.ctx).detail(this.ctx.params.id));
  }

  async create() {
    this.respond(await employeeService(this.ctx).create(parseCreate(this.ctx.request.body)));
  }

  async update() {
    this.respond(await employeeService(this.ctx).update(this.ctx.params.id, parseUpdate(this.ctx.request.body)));
  }

  async formalize() {
    this.respond(await employeeService(this.ctx).formalize(this.ctx.params.id, parseFormalize(this.ctx.request.body)));
  }

  async leave() {
    this.respond(await employeeService(this.ctx).leave(this.ctx.params.id, parseLeave(this.ctx.request.body)));
  }

  async destroy() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['version', 'confirmed', 'recipientUserId', 'deleteAccount']);
    if (input.confirmed !== true) throw new MasterDataError('VALIDATION_FAILED', 400);
    if (input.deleteAccount !== undefined && typeof input.deleteAccount !== 'boolean') throw new MasterDataError('VALIDATION_FAILED', 400);
    await employeeService(this.ctx).remove(this.ctx.params.id, { version: normalizeVersion(input.version), confirmed: true, recipientUserId: input.recipientUserId === undefined ? undefined : normalizeRequiredText(input.recipientUserId, 1, 100), deleteAccount: input.deleteAccount === true });
    this.respond(null);
  }

  async offboarding() { this.respond(await employeeService(this.ctx).offboarding(this.ctx.params.id)); }
  async suspendAccount() { this.respond(await employeeService(this.ctx).suspendAccount(this.ctx.params.id, this.ctx.request.body)); }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseListQuery(input: unknown): EmployeeListQuery {
  assertExactKeys(input, ['page', 'pageSize', 'keyword', 'status', 'organizationId', 'teamId']);
  return {
    page: parseQueryInteger(input.page, 1),
    pageSize: parseQueryInteger(input.pageSize, 10),
    keyword: input.keyword === undefined ? undefined : normalizeRequiredText(input.keyword, 1, 100),
    status: input.status === undefined
      ? undefined
      : normalizeAllowedValue(input.status, ['PROBATION', 'FORMAL', 'LEAVED'] as const),
    organizationId: input.organizationId === undefined
      ? undefined
      : normalizeRequiredText(input.organizationId, 1, 100),
    teamId: input.teamId === undefined ? undefined : normalizeRequiredText(input.teamId, 1, 100),
  };
}

function parseCreate(input: unknown): CreateEmployeeRequest {
  assertExactKeys(input, [
    'employeeNo', 'name', 'phone', 'email', 'idCard', 'licenseNo', 'employeeType',
    'professionalDirections', 'entryDate', 'primaryOrganizationId', 'primaryPositionId',
  ]);
  return {
    employeeNo: normalizeEmployeeNo(input.employeeNo),
    name: normalizeName(input.name),
    phone: normalizeRequiredText(input.phone, 5, 30),
    email: input.email === undefined ? undefined : normalizeOptionalText(input.email, 254),
    idCard: input.idCard === undefined ? undefined : normalizeOptionalText(input.idCard, 100),
    licenseNo: input.licenseNo === undefined ? undefined : normalizeOptionalText(input.licenseNo, 100),
    employeeType: normalizeStableCode(input.employeeType),
    professionalDirections: input.professionalDirections === undefined
      ? undefined
      : normalizeStringArray(input.professionalDirections, 20, 100),
    entryDate: parseIsoDate(input.entryDate).toISOString(),
    primaryOrganizationId: normalizeRequiredText(input.primaryOrganizationId, 1, 100),
    primaryPositionId: normalizeRequiredText(input.primaryPositionId, 1, 100),
  };
}

function parseUpdate(input: unknown): UpdateEmployeeInput & { version: number } {
  assertExactKeys(input, [
    'name', 'phone', 'email', 'idCard', 'licenseNo', 'employeeType', 'professionalDirections', 'version',
  ]);
  const parsed: UpdateEmployeeInput & { version: number } = { version: normalizeVersion(input.version) };
  if (input.name !== undefined) parsed.name = normalizeName(input.name);
  if (input.phone !== undefined) parsed.phone = normalizeRequiredText(input.phone, 5, 30);
  if (input.email !== undefined) parsed.email = normalizeOptionalText(input.email, 254);
  if (input.idCard !== undefined) parsed.idCard = normalizeOptionalText(input.idCard, 100);
  if (input.licenseNo !== undefined) parsed.licenseNo = normalizeOptionalText(input.licenseNo, 100);
  if (input.employeeType !== undefined) parsed.employeeType = normalizeStableCode(input.employeeType);
  if (input.professionalDirections !== undefined) {
    parsed.professionalDirections = normalizeStringArray(input.professionalDirections, 20, 100);
  }
  return parsed;
}

function parseFormalize(input: unknown): { formalDate: string; version: number } {
  assertExactKeys(input, ['formalDate', 'version']);
  return { formalDate: parseIsoDate(input.formalDate).toISOString(), version: normalizeVersion(input.version) };
}

function parseLeave(input: unknown): { leaveDate: string; handoverConfirmed: true; version: number } {
  assertExactKeys(input, ['leaveDate', 'handoverConfirmed', 'version']);
  if (input.handoverConfirmed !== true) throw new MasterDataError('VALIDATION_FAILED', 400);
  return {
    leaveDate: parseIsoDate(input.leaveDate).toISOString(),
    handoverConfirmed: true,
    version: normalizeVersion(input.version),
  };
}

function parseQueryInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new MasterDataError('VALIDATION_FAILED', 400);
  return normalizeVersion(Number(value));
}
