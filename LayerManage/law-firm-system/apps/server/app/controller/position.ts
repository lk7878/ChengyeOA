import { Prisma } from '@prisma/client';
import { Controller } from 'egg';

export default class PositionController extends Controller {
  async index() {
    const { ctx } = this;
    const { orgId } = ctx.query;

    const where: Prisma.PositionWhereInput = {};
    if (orgId) where.organizationId = orgId;

    const list = await ctx.prisma.position.findMany({
      where,
      include: {
        organization: true,
        _count: { select: { employees: true } },
      },
      orderBy: { level: 'desc' },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: list,
    };
  }

  async show() {
    const { ctx } = this;
    const { id } = ctx.params;

    const position = await ctx.prisma.position.findUnique({
      where: { id },
      include: {
        organization: true,
        employees: {
          where: { status: 'FORMAL' },
        },
      },
    });

    if (!position) {
      ctx.throw(404, '岗位不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: position,
    };
  }

  async create() {
    const { ctx } = this;
    const { name, orgId, organizationId = orgId, code, categoryCode, level, responsibilities } = ctx.request.body;

    if (!name || !organizationId || !code || !categoryCode) {
      ctx.throw(400, '名称、组织、编码和岗位分类不能为空');
    }

    const position = await ctx.prisma.position.create({
      data: { name, organizationId, code, categoryCode, level: level || 0, responsibilities },
      include: { organization: true },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: position,
    };
  }

  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { name, level, responsibilities, status } = ctx.request.body;

    const position = await ctx.prisma.position.findUnique({
      where: { id },
    });
    if (!position) {
      ctx.throw(404, '岗位不存在');
    }

    const updateData: Prisma.PositionUncheckedUpdateInput = {};
    if (name) updateData.name = name;
    if (level !== undefined) updateData.level = level;
    if (responsibilities !== undefined) updateData.responsibilities = responsibilities;
    if (status) updateData.status = status;

    const updated = await ctx.prisma.position.update({
      where: { id },
      data: updateData,
    });

    ctx.body = {
      code: 200,
      message: '更新成功',
      data: updated,
    };
  }

  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    const position = await ctx.prisma.position.findUnique({
      where: { id },
      include: { employees: true },
    });
    if (!position) {
      ctx.throw(404, '岗位不存在');
    }

    if (position.employees.length > 0) {
      ctx.throw(400, '该岗位下有员工，无法删除');
    }

    await ctx.prisma.position.delete({ where: { id } });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }
}
