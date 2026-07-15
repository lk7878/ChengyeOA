import { Prisma } from '@prisma/client';
import { Controller } from 'egg';
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
          select: {
            id: true,
            employeeNo: true,
            name: true,
            phone: true,
            email: true,
            type: true,
            status: true,
            entryDate: true,
            leaveDate: true,
            orgId: true,
            positionId: true,
            createdAt: true,
            updatedAt: true,
            organization: true,
            position: true,
          },
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
        list,
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
          select: {
            id: true,
            employeeNo: true,
            name: true,
            phone: true,
            email: true,
            type: true,
            status: true,
            entryDate: true,
            leaveDate: true,
            orgId: true,
            positionId: true,
            createdAt: true,
            updatedAt: true,
            organization: true,
            position: true,
          },
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
      data: user,
    };
  }

  /**
   * 创建用户
   */
  async create() {
    const { ctx } = this;
    const { username, password, status = 'ENABLED', employeeId } = ctx.request.body as {
      username?: unknown;
      password?: unknown;
      status?: string;
      employeeId?: string | null;
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
        employeeId,
        mustChangePassword: true,
      },
      select: {
        ...SAFE_USER_SELECT,
        employee: true,
      },
    }).catch(error => rethrowKnownUniqueConflict(error, ['username'], '用户名已存在'));

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: user,
    };
  }

  /**
   * 更新用户
   */
  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { status, employeeId } = ctx.request.body;

    await assertMutableUser(ctx.prisma, id);
    const user = await ctx.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      ctx.throw(404, '用户不存在');
    }

    const updateData: Prisma.UserUncheckedUpdateInput = {};
    if (status) updateData.status = status;
    if (employeeId !== undefined) updateData.employeeId = employeeId;

    const updated = await ctx.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        ...SAFE_USER_SELECT,
        employee: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '更新成功',
      data: updated,
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
