import { Controller } from 'egg';

export default class RoleController extends Controller {
  /**
   * 角色列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, keyword } = ctx.query;

    const where: any = {};
    if (keyword) {
      where.name = { contains: keyword };
    }

    const total = await ctx.prisma.role.count({ where });
    const list = await ctx.prisma.role.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      include: {
        permissions: {
          include: { permission: true },
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
   * 角色详情
   */
  async show() {
    const { ctx } = this;
    const { id } = ctx.params;

    const role = await ctx.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: { permission: true },
        },
        userRoles: {
          include: { user: true },
        },
      },
    });

    if (!role) {
      ctx.throw(404, '角色不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: role,
    };
  }

  /**
   * 创建角色
   */
  async create() {
    const { ctx } = this;
    const { name, type = 'BUSINESS', description } = ctx.request.body;

    if (!name) {
      ctx.throw(400, '角色名称不能为空');
    }

    const existing = await ctx.prisma.role.findUnique({
      where: { name },
    });
    if (existing) {
      ctx.throw(409, '角色名称已存在');
    }

    const role = await ctx.prisma.role.create({
      data: { name, type, description },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: role,
    };
  }

  /**
   * 更新角色
   */
  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { name, description, status } = ctx.request.body;

    const role = await ctx.prisma.role.findUnique({
      where: { id },
    });
    if (!role) {
      ctx.throw(404, '角色不存在');
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (status) updateData.status = status;

    const updated = await ctx.prisma.role.update({
      where: { id },
      data: updateData,
    });

    ctx.body = {
      code: 200,
      message: '更新成功',
      data: updated,
    };
  }

  /**
   * 删除角色
   */
  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    const role = await ctx.prisma.role.findUnique({
      where: { id },
    });
    if (!role) {
      ctx.throw(404, '角色不存在');
    }

    await ctx.prisma.role.delete({
      where: { id },
    });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }

  /**
   * 分配权限
   */
  async assignPermissions() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { permissionIds } = ctx.request.body;

    if (!Array.isArray(permissionIds)) {
      ctx.throw(400, 'permissionIds 必须是数组');
    }

    const role = await ctx.prisma.role.findUnique({
      where: { id },
    });
    if (!role) {
      ctx.throw(404, '角色不存在');
    }

    // 删除现有权限关联
    await ctx.prisma.rolePermission.deleteMany({
      where: { roleId: id },
    });

    // 创建新权限关联
    if (permissionIds.length > 0) {
      await ctx.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId: string) => ({
          roleId: id,
          permissionId,
        })),
      });
    }

    const updated = await ctx.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });

    ctx.body = {
      code: 200,
      message: '权限分配成功',
      data: updated,
    };
  }
}
