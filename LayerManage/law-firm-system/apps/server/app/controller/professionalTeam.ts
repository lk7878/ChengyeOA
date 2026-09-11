import { Controller } from 'egg';
import { professionalTeamService } from '../application/master-data/master-data-factory';
import { MasterDataStatus } from '../application/master-data/master-data-types';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeName,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeStableCode,
  normalizeVersion,
} from '../domain/master-data/master-data-validation';
import { MasterDataError } from '../domain/master-data/master-data-errors';

export default class ProfessionalTeamController extends Controller {
  async index() {
    const query = this.ctx.query;
    assertExactKeys(query, ['page', 'pageSize', 'keyword', 'categoryCode', 'homeOrganizationId', 'status']);
    this.respond(await professionalTeamService(this.ctx).list({
      page: parseQueryInteger(query.page, 1),
      pageSize: parseQueryInteger(query.pageSize, 10),
      keyword: query.keyword === undefined ? undefined : normalizeRequiredText(query.keyword, 1, 100),
      categoryCode: query.categoryCode === undefined ? undefined : normalizeRequiredText(query.categoryCode, 1, 100),
      homeOrganizationId: query.homeOrganizationId === undefined
        ? undefined
        : normalizeRequiredText(query.homeOrganizationId, 1, 100),
      status: query.status === undefined
        ? undefined
        : normalizeAllowedValue(query.status, ['ENABLED', 'DISABLED'] as const) as MasterDataStatus,
    }));
  }

  async show() {
    this.respond(await professionalTeamService(this.ctx).detail(this.ctx.params.id));
  }

  async create() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['code', 'name', 'categoryCode', 'homeOrganizationId', 'description']);
    this.respond(await professionalTeamService(this.ctx).create({
      code: normalizeStableCode(input.code),
      name: normalizeName(input.name),
      categoryCode: normalizeRequiredText(input.categoryCode, 1, 100),
      homeOrganizationId: normalizeRequiredText(input.homeOrganizationId, 1, 100),
      description: input.description === undefined ? undefined : normalizeOptionalText(input.description, 2000),
    }));
  }

  async update() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['name', 'categoryCode', 'homeOrganizationId', 'description', 'version']);
    this.respond(await professionalTeamService(this.ctx).update(this.ctx.params.id, {
      name: input.name === undefined ? undefined : normalizeName(input.name),
      categoryCode: input.categoryCode === undefined ? undefined : normalizeRequiredText(input.categoryCode, 1, 100),
      homeOrganizationId: input.homeOrganizationId === undefined
        ? undefined
        : normalizeRequiredText(input.homeOrganizationId, 1, 100),
      description: input.description === undefined ? undefined : normalizeOptionalText(input.description, 2000),
      version: normalizeVersion(input.version),
    }));
  }

  async disable() { await this.state('disable'); }
  async enable() { await this.state('enable'); }

  async addMember() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['employeeId', 'memberRole']);
    this.respond(await professionalTeamService(this.ctx).addMember(this.ctx.params.id, {
      employeeId: normalizeRequiredText(input.employeeId, 1, 100),
      memberRole: normalizeAllowedValue(
        input.memberRole,
        ['LEAD', 'EXPERT', 'LAWYER', 'ASSISTANT', 'OPERATIONS', 'OTHER'] as const,
      ),
    }));
  }

  async endMember() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['version']);
    this.respond(await professionalTeamService(this.ctx).endMember(
      this.ctx.params.id,
      this.ctx.params.memberId,
      normalizeVersion(input.version),
    ));
  }

  async replaceLead() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['employeeId', 'teamVersion']);
    this.respond(await professionalTeamService(this.ctx).replaceLead(this.ctx.params.id, {
      employeeId: normalizeRequiredText(input.employeeId, 1, 100),
      teamVersion: normalizeVersion(input.teamVersion),
    }));
  }

  private async state(action: 'enable' | 'disable'): Promise<void> {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['version']);
    const service = professionalTeamService(this.ctx);
    const version = normalizeVersion(input.version);
    this.respond(action === 'enable'
      ? await service.enable(this.ctx.params.id, version)
      : await service.disable(this.ctx.params.id, version));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseQueryInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new MasterDataError('VALIDATION_FAILED', 400);
  return normalizeVersion(Number(value));
}
