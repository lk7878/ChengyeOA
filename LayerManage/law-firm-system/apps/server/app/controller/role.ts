import { Prisma } from '@prisma/client';
import { Controller } from 'egg';
import { rethrowKnownUniqueConflict } from '../application/system/prisma-unique-conflict';
import { SAFE_USER_SELECT } from '../application/system/safe-user-projection';
import {
  assertMutableRole,
  SYSTEM_SUPER_ADMIN_ROLE_CODE,
  TrustRootProtectedError,
} from '../application/system/trust-root-guard';

const ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

export default class RoleController extends Controller {
  /**
   * 角色列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, keyword } = ctx.query;

    const where: Prisma.RoleWhereInput = {};
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
          include: { user: { select: SAFE_USER_SELECT } },
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
    const { name, code, description } = ctx.request.body as {
      name?: unknown;
      code?: unknown;
      description?: string;
    };

    if (typeof name !== 'string' || !name.trim() || typeof code !== 'string') {
      ctx.throw(400, '角色名称和代码不能为空');
      return;
    }
    const normalizedName = name.trim();
    const normalizedCode = code.trim().toUpperCase();
    if (!ROLE_CODE_PATTERN.test(normalizedCode)) {
      ctx.throw(400, 'ROLE_CODE_INVALID');
    }
    if (normalizedCode === SYSTEM_SUPER_ADMIN_ROLE_CODE) {
      throw new TrustRootProtectedError();
    }

    const existing = await ctx.prisma.role.findFirst({
      where: { OR: [{ name: normalizedName }, { code: normalizedCode }] },
    });
    if (existing) {
      ctx.throw(409, '角色名称或代码已存在');
    }

    const role = await ctx.prisma.role.create({
      data: { name: normalizedName, code: normalizedCode, type: 'BUSINESS', description },
    }).catch(error => rethrowKnownUniqueConflict(error, ['name', 'code'], '角色名称或代码已存在'));

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

    await assertMutableRole(ctx.prisma, id);
    const role = await ctx.prisma.role.findUnique({
      where: { id },
    });
    if (!role) {
      ctx.throw(404, '角色不存在');
    }

    const updateData: Prisma.RoleUncheckedUpdateInput = {};
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

    await assertMutableRole(ctx.prisma, id);
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

    const updated = await ctx.prisma.$transaction(async tx => {
      await assertMutableRole(tx, id);
      const role = await tx.role.findUnique({ where: { id }, select: { id: true } });
      if (!role) {
        ctx.throw(404, '角色不存在');
      }

      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: (permissionIds as string[]).map(permissionId => ({ roleId: id, permissionId })),
        });
      }

      return tx.role.findUnique({
        where: { id },
        include: { permissions: { include: { permission: true } } },
      });
    });

    ctx.body = {
      code: 200,
      message: '权限分配成功',
      data: updated,
    };
  }
}
