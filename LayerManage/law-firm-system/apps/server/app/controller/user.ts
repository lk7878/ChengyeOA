import { Controller } from 'egg';
import * as bcrypt from 'bcryptjs';

export default class UserController extends Controller {
  /**
   * 用户列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, keyword, status } = ctx.query;

    const where: any = {};
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
      include: {
        employee: {
          include: {
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
      include: {
        employee: {
          include: {
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
    const { username, password, status = 'ENABLED', employeeId } = ctx.request.body;

    if (!username || !password) {
      ctx.throw(400, '用户名和密码不能为空');
    }

    // 检查用户名是否已存在
    const existing = await ctx.prisma.user.findUnique({
      where: { username },
    });
    if (existing) {
      ctx.throw(409, '用户名已存在');
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await ctx.prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        status,
        employeeId,
      },
      include: {
        employee: true,
      },
    });

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

    const user = await ctx.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      ctx.throw(404, '用户不存在');
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (employeeId !== undefined) updateData.employeeId = employeeId;

    const updated = await ctx.prisma.user.update({
      where: { id },
      data: updateData,
      include: {
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

    const user = await ctx.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      ctx.throw(404, '用户不存在');
    }

    // 删除现有角色关联
    await ctx.prisma.userRole.deleteMany({
      where: { userId: id },
    });

    // 创建新角色关联
    if (roleIds.length > 0) {
      await ctx.prisma.userRole.createMany({
        data: roleIds.map((roleId: string) => ({
          userId: id,
          roleId,
        })),
      });
    }

    const updated = await ctx.prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    ctx.body = {
      code: 200,
      message: '角色分配成功',
      data: updated,
    };
  }
}
