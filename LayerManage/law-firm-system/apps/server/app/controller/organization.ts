import { Controller } from 'egg';
import {
  CreateOrganizationInput,
  MoveOrganizationInput,
  UpdateOrganizationInput,
} from '../application/master-data/organization-service';
import { organizationService } from '../application/master-data/master-data-factory';
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
  async options() {
    const status = this.ctx.query.status === undefined ? undefined
      : normalizeAllowedValue(this.ctx.query.status, ['ENABLED', 'DISABLED'] as const);
    this.respond(await organizationService(this.ctx).options(status));
  }

  async managerOptions() {
    this.respond(await organizationService(this.ctx).managerOptions(this.ctx.query.keyword));
  }

  async copy() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['code', 'name', 'type', 'parentId', 'sort', 'managerEmployeeId', 'sourceVersion']);
    const { sourceVersion, ...creation } = input;
    this.respond(await organizationService(this.ctx).copy(this.ctx.params.id, {
      ...parseCreate(creation), sourceVersion: normalizeVersion(sourceVersion),
    }));
  }

  async destroy() {
    await organizationService(this.ctx).remove(this.ctx.params.id, parseVersionCommand(this.ctx.request.body));
    this.respond(null);
  }

  async tree() {
    const { ctx } = this;
    const status = ctx.query.status === undefined
      ? undefined
      : normalizeAllowedValue(ctx.query.status, ['ENABLED', 'DISABLED'] as const);
    this.respond(await organizationService(ctx).tree(status));
  }

  async show() {
    this.respond(await organizationService(this.ctx).detail(this.ctx.params.id));
  }

  async create() {
    this.respond(await organizationService(this.ctx).create(parseCreate(this.ctx.request.body)));
  }

  async update() {
    this.respond(await organizationService(this.ctx).update(this.ctx.params.id, parseUpdate(this.ctx.request.body)));
  }

  async move() {
    this.respond(await organizationService(this.ctx).move(this.ctx.params.id, parseMove(this.ctx.request.body)));
  }

  async disable() {
    this.respond(await organizationService(this.ctx).disable(this.ctx.params.id, parseVersionCommand(this.ctx.request.body)));
  }

  async enable() {
    this.respond(await organizationService(this.ctx).enable(this.ctx.params.id, parseVersionCommand(this.ctx.request.body)));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseCreate(input: unknown): CreateOrganizationInput {
  assertExactKeys(input, ['code', 'name', 'type', 'parentId', 'sort', 'managerEmployeeId']);
  return {
    code: normalizeStableCode(input.code),
    name: normalizeName(input.name),
    type: normalizeAllowedValue(input.type, ['HQ_CENTER', 'DEPARTMENT', 'BRANCH', 'GROUP'] as const),
    parentId: normalizeRequiredText(input.parentId, 1, 100),
    sort: input.sort === undefined ? undefined : normalizeNonNegativeInteger(input.sort),
    managerEmployeeId: input.managerEmployeeId === undefined ? undefined : input.managerEmployeeId === null ? null : normalizeRequiredText(input.managerEmployeeId, 1, 100),
  };
}

function parseUpdate(input: unknown): UpdateOrganizationInput {
  assertExactKeys(input, ['name', 'sort', 'version', 'managerEmployeeId']);
  const parsed: UpdateOrganizationInput = { version: normalizeVersion(input.version) };
  if (input.name !== undefined) parsed.name = normalizeName(input.name);
  if (input.sort !== undefined) parsed.sort = normalizeNonNegativeInteger(input.sort);
  if (input.managerEmployeeId !== undefined) parsed.managerEmployeeId = input.managerEmployeeId === null ? null : normalizeRequiredText(input.managerEmployeeId, 1, 100);
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
