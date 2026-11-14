import { Controller } from 'egg';
import { FIELD_CATALOG } from '../domain/authorization/field-security-policy';
import { businessRolePermissionAssignable, PERMISSION_CATALOG } from '../domain/authorization/permission-catalog';
import { DataScopeCatalogService } from '../application/authorization/data-scope-catalog-service';
import { AuthorizationContext } from '../application/authorization/authorization-service';

export default class PermissionController extends Controller {
  async catalog() {
    this.ctx.body = {
      code: 200,
      message: 'success',
      data: PERMISSION_CATALOG.map(permission => ({ ...permission, businessRoleAssignable: businessRolePermissionAssignable(permission) })),
    };
  }

  async fields() {
    this.respond(FIELD_CATALOG
      .filter(field => field.classification !== 'FORBIDDEN')
      .map(field => ({ ...field })));
  }

  async dataScopes() {
    this.respond(await this.scopeService().list());
  }

  async createDataScope() {
    this.respond(await this.scopeService().create(this.ctx.request.body));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }

  private scopeService(): DataScopeCatalogService {
    const authorization = this.ctx.state.authorization as AuthorizationContext;
    return new DataScopeCatalogService(this.ctx.prisma, {
      userId: authorization.userId,
      isSystemSuperAdmin: authorization.isSystemSuperAdmin,
      ip: this.ctx.ip,
    });
  }
}
