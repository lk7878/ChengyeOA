import { Controller } from 'egg';
import {
  CreatePositionInput,
  UpdatePositionInput,
} from '../application/master-data/position-service';
import { positionService } from '../application/master-data/master-data-factory';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeName,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeStableCode,
  normalizeVersion,
} from '../domain/master-data/master-data-validation';

export default class PositionController extends Controller {
  async index() {
    const { organizationId, status, keyword } = this.ctx.query;
    this.respond(await positionService(this.ctx).list({
      organizationId: organizationId === undefined ? undefined : normalizeRequiredText(organizationId, 1, 100),
      status: status === undefined ? undefined : normalizeAllowedValue(status, ['ENABLED', 'DISABLED'] as const),
      keyword: keyword === undefined ? undefined : normalizeRequiredText(keyword, 1, 100),
    }));
  }

  async show() {
    this.respond(await positionService(this.ctx).detail(this.ctx.params.id));
  }

  async create() {
    this.respond(await positionService(this.ctx).create(parseCreate(this.ctx.request.body)));
  }

  async update() {
    this.respond(await positionService(this.ctx).update(this.ctx.params.id, parseUpdate(this.ctx.request.body)));
  }

  async disable() {
    this.respond(await positionService(this.ctx).disable(this.ctx.params.id, parseVersionCommand(this.ctx.request.body)));
  }

  async enable() {
    this.respond(await positionService(this.ctx).enable(this.ctx.params.id, parseVersionCommand(this.ctx.request.body)));
  }

  async destroy() {
    await positionService(this.ctx).remove(this.ctx.params.id, parseVersionCommand(this.ctx.request.body));
    this.respond(null);
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseCreate(input: unknown): CreatePositionInput {
  assertExactKeys(input, ['organizationId', 'code', 'name', 'categoryCode', 'level', 'responsibilities']);
  return {
    organizationId: normalizeRequiredText(input.organizationId, 1, 100),
    code: normalizeStableCode(input.code),
    name: normalizeName(input.name),
    categoryCode: normalizeStableCode(input.categoryCode),
    level: normalizeNonNegativeInteger(input.level),
    responsibilities: input.responsibilities === undefined
      ? undefined
      : normalizeOptionalText(input.responsibilities, 2000),
  };
}

function parseUpdate(input: unknown): UpdatePositionInput {
  assertExactKeys(input, ['name', 'categoryCode', 'level', 'responsibilities', 'version']);
  const parsed: UpdatePositionInput = { version: normalizeVersion(input.version) };
  if (input.name !== undefined) parsed.name = normalizeName(input.name);
  if (input.categoryCode !== undefined) parsed.categoryCode = normalizeStableCode(input.categoryCode);
  if (input.level !== undefined) parsed.level = normalizeNonNegativeInteger(input.level);
  if (input.responsibilities !== undefined) parsed.responsibilities = normalizeOptionalText(input.responsibilities, 2000);
  return parsed;
}

function parseVersionCommand(input: unknown): number {
  assertExactKeys(input, ['version']);
  return normalizeVersion(input.version);
}
