import { Prisma } from '@prisma/client';
import { Controller } from 'egg';
import { AuthorizationContext, AuthorizationService } from '../application/authorization/authorization-service';
import { DataScopeService } from '../application/authorization/data-scope-service';
import { UserGrantService } from '../application/authorization/user-grant-service';
import {
  EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE,
  projectEmployeeWithPrimaryAssignment,
} from '../application/master-data/employee-projection';
import { rethrowKnownUniqueConflict } from '../application/system/prisma-unique-conflict';
import { SAFE_USER_SELECT } from '../application/system/safe-user-projection';
import {
  assertMutableUser,
  assertNonAdministratorUserMutable,
} from '../application/system/trust-root-guard';
import { BcryptPasswordHasher } from '../domain/security/password-hasher';
import { authorizationInputError } from '../domain/authorization/authorization-errors';
import { assertAuthorizationExactKeys } from '../domain/authorization/authorization-validation';
import { normalizeUsername, validatePassword, validateUsername } from '../domain/security/password-policy';
import { SecurityError } from '../domain/security/security-errors';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { writeAuditLog } from '../application/system/audit-writer';

const passwordHasher = new BcryptPasswordHasher();

export default class UserController extends Controller {
  /**
   * 用户列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, keyword, status } = ctx.query;

    const filters: Prisma.UserWhereInput = {};
    if (keyword) {
      filters.OR = [
        { username: { contains: keyword } },
        { employee: { name: { contains: keyword } } },
      ];
    }
    if (status) {
      filters.status = status;
    }
    const scopeWhere = await this.authorizationService().buildScopeWhere(
      this.authorizationContext(),
      'user',
      'user.read',
    );
    const where: Prisma.UserWhereInput = { AND: [scopeWhere, filters] };

    const total = await ctx.prisma.user.count({ where });
    const list = await ctx.prisma.user.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      select: {
        ...SAFE_USER_SELECT,
        employee: {
          include: EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE,
        },
        userRoles: {
          include: {
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        list: list.map(user => ({
          ...user,
          employee: user.employee ? projectEmployeeWithPrimaryAssignment(user.employee) : null,
        })),
        pagination: {
          page: Number(page),
          pageSize: Number(pageSize),
          total,
          totalPages: Math.ceil(total / Number(pageSize)),
        },
      },
    };
  }

  /**
   * 用户详情
   */
  async show() {
    const { ctx } = this;
    const { id } = ctx.params;
    await this.authorizationService().requireRecord(
      this.authorizationContext(),
      'user',
      'user.read',
      id,
    );

    const user = await ctx.prisma.user.findUnique({
      where: { id },
      select: {
        ...SAFE_USER_SELECT,
        employee: {
          include: EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE,
        },
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      ctx.throw(404, '用户不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        ...user,
        employee: user.employee ? projectEmployeeWithPrimaryAssignment(user.employee) : null,
      },
    };
  }

  /**
   * 创建用户
   */
  async create() {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(body, 'employeeId')) {
      ctx.throw(400, 'ACCOUNT_BINDING_REQUIRES_DEDICATED_ENDPOINT');
    }
    const { username, password, status = 'ENABLED' } = body as {
      username?: unknown;
      password?: unknown;
      status?: string;
    };

    if (typeof username !== 'string' || typeof password !== 'string') {
      ctx.throw(400, '用户名和密码不能为空');
      return;
    }
    const normalizedUsername = normalizeUsername(username);
    validateUsername(normalizedUsername);
    validatePassword(password, normalizedUsername);

    // 检查用户名是否已存在
    const existing = await ctx.prisma.user.findUnique({
      where: { username: normalizedUsername },
    });
    if (existing) {
      ctx.throw(409, '用户名已存在');
    }

    const hashedPassword = await passwordHasher.hash(password);

    const user = await ctx.prisma.user.create({
      data: {
        username: normalizedUsername,
        password: hashedPassword,
        status,
        mustChangePassword: true,
      },
      select: {
        ...SAFE_USER_SELECT,
        employee: { include: EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE },
      },
    }).catch(error => rethrowKnownUniqueConflict(error, ['username'], '用户名已存在'));

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: {
        ...user,
        employee: user.employee ? projectEmployeeWithPrimaryAssignment(user.employee) : null,
      },
    };
  }

  /**
   * 更新用户
   */
  async update() {
    const { ctx } = this;
    const { id } = ctx.params;

    await this.authorizationService().requireRecord(
      this.authorizationContext(),
      'user',
      'user.update',
      id,
    );
    await assertMutableUser(ctx.prisma, id);
    await assertNonAdministratorUserMutable(ctx.prisma, id);
    const body = ctx.request.body as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(body, 'employeeId')) {
      ctx.throw(400, 'ACCOUNT_BINDING_REQUIRES_DEDICATED_ENDPOINT');
    }
    const { status } = body;
    const user = await ctx.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      ctx.throw(404, '用户不存在');
    }

    const updateData: Prisma.UserUncheckedUpdateInput = {};
    if (typeof status === 'string' && status) updateData.status = status;

    const updated = await ctx.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        ...SAFE_USER_SELECT,
        employee: { include: EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE },
      },
    });

    ctx.body = {
      code: 200,
      message: '更新成功',
      data: {
        ...updated,
        employee: updated.employee ? projectEmployeeWithPrimaryAssignment(updated.employee) : null,
      },
    };
  }

  async authorization() {
    this.respond(await this.grantService().summary(this.ctx.params.id));
  }

  /**
   * 管理员重置用户密码
   */
  async resetPassword() {
    const { ctx } = this;
    const { id } = ctx.params;

    await this.authorizationService().requireRecord(
      this.authorizationContext(),
      'user',
      'user.password.reset',
      id,
    );
    await assertMutableUser(ctx.prisma, id);
    await assertNonAdministratorUserMutable(ctx.prisma, id);
    const actorUserId = ctx.state.user?.userId as string;
    if (actorUserId === id) {
      ctx.throw(400, 'SELF_PASSWORD_RESET_FORBIDDEN');
      return;
    }
    const body = ctx.request.body as Record<string, unknown>;
    const { password, confirmation } = body;
    if (typeof password !== 'string' || typeof confirmation !== 'string') {
      ctx.throw(400, 'PASSWORD_AND_CONFIRMATION_REQUIRED');
      return;
    }
    if (password !== confirmation) {
      ctx.throw(400, 'PASSWORD_CONFIRMATION_MISMATCH');
      return;
    }

    await ctx.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${id} FOR UPDATE`;
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, username: true, password: true },
      });
      if (!target) throw new MasterDataError('USER_NOT_FOUND', 404);
      validatePassword(password, target.username);
      if (await passwordHasher.compare(password, target.password)) {
        throw new SecurityError('PASSWORD_REUSED');
      }
      await tx.user.update({
        where: { id },
        data: {
          password: await passwordHasher.hash(password),
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          credentialVersion: { increment: 1 },
        },
      });
      await writeAuditLog(tx, {
        userId: actorUserId,
        action: 'PASSWORD_RESET_BY_ADMIN',
        targetType: 'USER',
        targetId: id,
        newValues: JSON.stringify({ targetUserId: id }),
        ip: ctx.ip,
      });
    });

    ctx.body = { code: 200, message: '密码已重置', data: null };
  }

  async grantRole() {
    const input = this.ctx.request.body;
    assertAuthorizationExactKeys(input, ['roleId', 'source', 'validFrom', 'validUntil', 'reason']);
    if (typeof input.roleId !== 'string' || !input.roleId.trim()) authorizationInputError();
    this.respond(await this.grantService().grantRole(this.ctx.params.id, input.roleId, {
      source: input.source,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      reason: input.reason,
    }));
  }

  async revokeRoleGrant() {
    this.respond(await this.grantService().revokeRole(
      this.ctx.params.id,
      this.ctx.params.grantId,
      this.ctx.request.body,
    ));
  }

  async grantSpecial() {
    this.respond(await this.grantService().grantSpecial(this.ctx.params.id, this.ctx.request.body));
  }

  async revokeSpecialGrant() {
    this.respond(await this.grantService().revokeSpecial(
      this.ctx.params.id,
      this.ctx.params.grantId,
      this.ctx.request.body,
    ));
  }

  /**
   * 删除用户
   */
  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    await this.authorizationService().requireRecord(
      this.authorizationContext(),
      'user',
      'user.status.manage',
      id,
    );
    await assertMutableUser(ctx.prisma, id);
    await assertNonAdministratorUserMutable(ctx.prisma, id);
    const user = await ctx.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      ctx.throw(404, '用户不存在');
    }

    await ctx.prisma.user.delete({
      where: { id },
    });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }

  private grantService(): UserGrantService {
    return new UserGrantService(
      this.ctx.prisma,
      this.ctx.state.authorization as AuthorizationContext,
      this.ctx.ip,
    );
  }

  private authorizationContext(): AuthorizationContext {
    return this.ctx.state.authorization as AuthorizationContext;
  }

  private authorizationService(): AuthorizationService {
    return new AuthorizationService(new DataScopeService(this.ctx.prisma));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}
