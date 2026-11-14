import { Controller } from 'egg';
import { RoleAuthorizationService } from '../application/authorization/role-authorization-service';
import { UserGrantService } from '../application/authorization/user-grant-service';
import { AuthorizationContext } from '../application/authorization/authorization-service';
import { authorizationInputError } from '../domain/authorization/authorization-errors';

export default class RoleController extends Controller {
  async index() {
    const page = positiveInteger(this.ctx.query.page, 1, 10_000);
    const pageSize = positiveInteger(this.ctx.query.pageSize, 20, 100);
    const keyword = optionalQueryText(this.ctx.query.keyword, 100);
    this.respond(await this.roleAuthorizationService().list(page, pageSize, keyword));
  }

  async show() {
    this.respond(await this.roleAuthorizationService().detail(this.ctx.params.id));
  }

  /** GET /api/v1/roles/:id/members：per-role 成员列表（role.read 或委派码门控）。 */
  async members() {
    this.respond(await this.grantService().listRoleMembers(this.ctx.params.id));
  }

  async create() {
    this.respond(await this.roleAuthorizationService().create(this.ctx.request.body));
  }

  async update() {
    this.respond(await this.roleAuthorizationService().update(this.ctx.params.id, this.ctx.request.body));
  }

  async disable() {
    this.respond(await this.roleAuthorizationService().disable(this.ctx.params.id, this.ctx.request.body?.version));
  }

  async destroy() {
    await this.roleAuthorizationService().remove(this.ctx.params.id, this.ctx.request.body);
    this.respond(null);
  }

  async enable() {
    this.respond(await this.roleAuthorizationService().enable(this.ctx.params.id, this.ctx.request.body?.version));
  }

  async replacePermissions() {
    this.respond(await this.roleAuthorizationService().replacePermissions(this.ctx.params.id, this.ctx.request.body));
  }

  async replaceDataScopes() {
    this.respond(await this.roleAuthorizationService().replaceDataScopes(this.ctx.params.id, this.ctx.request.body));
  }

  async replaceFieldPermissions() {
    this.respond(await this.roleAuthorizationService().replaceFieldPermissions(this.ctx.params.id, this.ctx.request.body));
  }

  private roleAuthorizationService(): RoleAuthorizationService {
    return new RoleAuthorizationService(this.ctx.prisma, {
      actorUserId: this.authorization().userId,
      ip: this.ctx.ip,
    });
  }

  private grantService(): UserGrantService {
    return new UserGrantService(this.ctx.prisma, this.authorization(), this.ctx.ip);
  }

  private authorization(): AuthorizationContext {
    return this.ctx.state.authorization as AuthorizationContext;
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) authorizationInputError();
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) authorizationInputError();
  return parsed;
}

function optionalQueryText(value: unknown, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') authorizationInputError();
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) authorizationInputError();
  return normalized;
}
