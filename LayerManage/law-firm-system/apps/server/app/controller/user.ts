import { Prisma } from '@prisma/client';
import { Controller } from 'egg';
import {
  EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE,
  projectEmployeeWithPrimaryAssignment,
} from '../application/master-data/employee-projection';
import { rethrowKnownUniqueConflict } from '../application/system/prisma-unique-conflict';
import { SAFE_USER_SELECT } from '../application/system/safe-user-projection';
import { assertMutableRole, assertMutableUser } from '../application/system/trust-root-guard';
import { BcryptPasswordHasher } from '../domain/security/password-hasher';
import { normalizeUsername, validatePassword, validateUsername } from '../domain/security/password-policy';

const passwordHasher = new BcryptPasswordHasher();

export default class UserController extends Controller {
  /**
   * 用户列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, keyword, status } = ctx.query;

    const where: Prisma.UserWhereInput = {};
    if (keyword) {
      where.OR = [
        { username: { contains: keyword } },
        { employee: { name: { contains: keyword } } },
      ];
    }
    if (status) {
      where.status = status;
    }

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

    await assertMutableUser(ctx.prisma, id);
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

  /**
   * 删除用户
   */
  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    await assertMutableUser(ctx.prisma, id);
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

  /**
   * 分配角色
   */
  async assignRoles() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { roleIds } = ctx.request.body;

    if (!Array.isArray(roleIds)) {
      ctx.throw(400, 'roleIds 必须是数组');
    }

    const updated = await ctx.prisma.$transaction(async tx => {
      await assertMutableUser(tx, id);
      for (const roleId of roleIds as string[]) {
        await assertMutableRole(tx, roleId);
      }

      const user = await tx.user.findUnique({ where: { id }, select: { id: true } });
      if (!user) {
        ctx.throw(404, '用户不存在');
      }

      await tx.userRole.deleteMany({ where: { userId: id } });
      if (roleIds.length > 0) {
        await tx.userRole.createMany({
          data: (roleIds as string[]).map(roleId => ({ userId: id, roleId })),
        });
      }

      return tx.user.findUnique({
        where: { id },
        select: {
          ...SAFE_USER_SELECT,
          userRoles: { include: { role: true } },
        },
      });
    });

    ctx.body = {
      code: 200,
      message: '角色分配成功',
      data: updated,
    };
  }
}
