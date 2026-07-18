import { Controller } from 'egg';
import {
  CreateOrganizationInput,
  MoveOrganizationInput,
  OrganizationService,
  UpdateOrganizationInput,
} from '../application/master-data/organization-service';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeName,
  normalizeNonNegativeInteger,
  normalizeRequiredText,
  normalizeStableCode,
  normalizeVersion,
} from '../domain/master-data/master-data-validation';

export default class OrganizationController extends Controller {
  async tree() {
    const { ctx } = this;
    const status = ctx.query.status === undefined
      ? undefined
      : normalizeAllowedValue(ctx.query.status, ['ENABLED', 'DISABLED'] as const);
    this.respond(await this.organizationService().tree(status));
  }

  async show() {
    this.respond(await this.organizationService().detail(this.ctx.params.id));
  }

  async create() {
    this.respond(await this.organizationService().create(parseCreate(this.ctx.request.body)));
  }

  async update() {
    this.respond(await this.organizationService().update(this.ctx.params.id, parseUpdate(this.ctx.request.body)));
  }

  async move() {
    this.respond(await this.organizationService().move(this.ctx.params.id, parseMove(this.ctx.request.body)));
  }

  async disable() {
    this.respond(await this.organizationService().disable(this.ctx.params.id, parseVersionCommand(this.ctx.request.body)));
  }

  async enable() {
    this.respond(await this.organizationService().enable(this.ctx.params.id, parseVersionCommand(this.ctx.request.body)));
  }

  private organizationService(): OrganizationService {
    return new OrganizationService(this.ctx.prisma, {
      actorUserId: this.ctx.state.user.userId,
      ip: this.ctx.ip,
    });
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseCreate(input: unknown): CreateOrganizationInput {
  assertExactKeys(input, ['code', 'name', 'type', 'parentId', 'sort']);
  return {
    code: normalizeStableCode(input.code),
    name: normalizeName(input.name),
    type: normalizeAllowedValue(input.type, ['HQ_CENTER', 'DEPARTMENT', 'BRANCH', 'GROUP'] as const),
    parentId: normalizeRequiredText(input.parentId, 1, 100),
    sort: input.sort === undefined ? undefined : normalizeNonNegativeInteger(input.sort),
  };
}

function parseUpdate(input: unknown): UpdateOrganizationInput {
  assertExactKeys(input, ['name', 'sort', 'version']);
  const parsed: UpdateOrganizationInput = { version: normalizeVersion(input.version) };
  if (input.name !== undefined) parsed.name = normalizeName(input.name);
  if (input.sort !== undefined) parsed.sort = normalizeNonNegativeInteger(input.sort);
  return parsed;
}

function parseMove(input: unknown): MoveOrganizationInput {
  assertExactKeys(input, ['parentId', 'version']);
  return {
    parentId: normalizeRequiredText(input.parentId, 1, 100),
    version: normalizeVersion(input.version),
  };
}

function parseVersionCommand(input: unknown): number {
  assertExactKeys(input, ['version']);
  return normalizeVersion(input.version);
}
