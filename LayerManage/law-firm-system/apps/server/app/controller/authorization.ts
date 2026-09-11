import { Controller } from 'egg';
import { PermissionTraceService } from '../application/authorization/permission-trace-service';
import { SensitiveAccessService } from '../application/authorization/sensitive-access-service';
import { AuthorizationContext } from '../application/authorization/authorization-service';
import { authorizationInputError } from '../domain/authorization/authorization-errors';
import { assertAuthorizationExactKeys } from '../domain/authorization/authorization-validation';
import { PERMISSION_CATALOG } from '../domain/authorization/permission-catalog';
import { PermissionCode } from '../domain/authorization/authorization-types';

export default class AuthorizationController extends Controller {
  async me() {
    const authorization = this.authorization();
    this.respond({
      userId: authorization.userId,
      employeeId: authorization.employeeId,
      isSystemSuperAdmin: authorization.isSystemSuperAdmin,
      isSystemAdmin: authorization.isSystemAdmin,
      evaluatedAt: authorization.evaluatedAt,
      permissionCodes: authorization.permissionCodes,
      menuCodes: authorization.permissionCodes.filter(code => code.startsWith('menu.')),
      grants: authorization.grants.map(grant => ({ ...grant })),
      fieldCapabilities: authorization.fieldRules.map(rule => ({ ...rule })),
    });
  }

  async myTrace() {
    const authorization = this.authorization();
    this.respond(await new PermissionTraceService(this.ctx.prisma).trace(
      authorization,
      authorization.userId,
      permissionCode(this.ctx.query.permissionCode),
    ));
  }

  async traceUser() {
    const authorization = this.authorization();
    this.respond(await new PermissionTraceService(this.ctx.prisma).trace(
      authorization,
      this.ctx.params.id,
      permissionCode(this.ctx.query.permissionCode),
    ));
  }

  async sensitiveView() {
    const input = this.ctx.request.body;
    assertAuthorizationExactKeys(input, ['resource', 'resourceId', 'fieldCodes', 'purpose']);
    if (input.resource !== 'employee' || typeof input.resourceId !== 'string') authorizationInputError();
    if (!Array.isArray(input.fieldCodes) || input.fieldCodes.some(code => typeof code !== 'string')) {
      authorizationInputError();
    }
    this.respond(await new SensitiveAccessService(this.ctx.prisma).viewEmployeeFields({
      context: this.authorization(),
      employeeId: input.resourceId,
      fieldCodes: input.fieldCodes as Array<'employee.idCard'>,
      purpose: input.purpose as string,
      ip: this.ctx.ip,
    }));
  }

  private authorization(): AuthorizationContext {
    return this.ctx.state.authorization as AuthorizationContext;
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function permissionCode(value: unknown): PermissionCode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') authorizationInputError();
  const permission = PERMISSION_CATALOG.find(item => item.code === value);
  if (!permission) authorizationInputError();
  return permission.code;
}
