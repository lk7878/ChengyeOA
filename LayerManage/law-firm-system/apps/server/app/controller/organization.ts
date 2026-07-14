import { Prisma } from '@prisma/client';
import { Controller } from 'egg';

export default class OrganizationController extends Controller {
  /**
   * 组织列表
   */
  async index() {
    const { ctx } = this;
    const { type, status } = ctx.query;

    const where: Prisma.OrganizationWhereInput = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const list = await ctx.prisma.organization.findMany({
      where,
      include: {
        parent: true,
        _count: {
          select: { employees: true, positions: true },
        },
      },
      orderBy: { sort: 'asc' },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: list,
    };
  }

  /**
   * 组织树
   */
  async tree() {
    const { ctx } = this;

    const orgs = await ctx.prisma.organization.findMany({
      where: { status: 'ENABLED' },
      include: {
        _count: {
          select: { employees: true },
        },
      },
      orderBy: { sort: 'asc' },
    });

    const buildTree = (items: Prisma.OrganizationGetPayload<Record<never, never>>[], parentId: string | null = null): Prisma.OrganizationGetPayload<Record<never, never>>[] => {
      return items
        .filter(item => item.parentId === parentId)
        .map(item => ({
          ...item,
          children: buildTree(items, item.id),
        }));
    };

    const tree = buildTree(orgs);

    ctx.body = {
      code: 200,
      message: 'success',
      data: tree,
    };
  }

  /**
   * 组织详情
   */
  async show() {
    const { ctx } = this;
    const { id } = ctx.params;

    const org = await ctx.prisma.organization.findUnique({
      where: { id },
      include: {
        parent: true,
        children: true,
        positions: true,
        employees: {
          include: {
            position: true,
          },
        },
      },
    });

    if (!org) {
      ctx.throw(404, '组织不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: org,
    };
  }

  /**
   * 创建组织
   */
  async create() {
    const { ctx } = this;
    const { name, type, parentId, sort = 0 } = ctx.request.body;

    if (!name || !type) {
      ctx.throw(400, '名称和类型不能为空');
    }

    const org = await ctx.prisma.organization.create({
      data: { name, type, parentId, sort },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: org,
    };
  }

  /**
   * 更新组织
   */
  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { name, type, parentId, sort, status } = ctx.request.body;

    const org = await ctx.prisma.organization.findUnique({
      where: { id },
    });
    if (!org) {
      ctx.throw(404, '组织不存在');
    }

    const updateData: Prisma.OrganizationUncheckedUpdateInput = {};
    if (name) updateData.name = name;
    if (type) updateData.type = type;
    if (parentId !== undefined) updateData.parentId = parentId;
    if (sort !== undefined) updateData.sort = sort;
    if (status) updateData.status = status;

    const updated = await ctx.prisma.organization.update({
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
   * 删除组织
   */
  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    const org = await ctx.prisma.organization.findUnique({
      where: { id },
      include: {
        children: true,
        employees: true,
      },
    });
    if (!org) {
      ctx.throw(404, '组织不存在');
    }

    if (org.children.length > 0) {
      ctx.throw(400, '该组织下有子组织，无法删除');
    }
    if (org.employees.length > 0) {
      ctx.throw(400, '该组织下有员工，无法删除');
    }

    await ctx.prisma.organization.delete({
      where: { id },
    });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }
}
