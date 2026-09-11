import { Prisma } from '@prisma/client';
import { Controller } from 'egg';

export default class ChannelController extends Controller {
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, type, status } = ctx.query;

    const where: Prisma.ChannelWhereInput = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const total = await ctx.prisma.channel.count({ where });
    const list = await ctx.prisma.channel.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      include: {
        _count: { select: { leads: true } },
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

  async show() {
    const { ctx } = this;
    const { id } = ctx.params;

    const channel = await ctx.prisma.channel.findUnique({
      where: { id },
      include: {
        leads: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!channel) {
      ctx.throw(404, '渠道不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: channel,
    };
  }

  async create() {
    const { ctx } = this;
    const { name, type, accountInfo, cost, code } = ctx.request.body;

    if (!name || !type) {
      ctx.throw(400, '名称和类型不能为空');
    }

    // SPEC-001 prototype: channel code is unique. Later SPEC-009 tasks replace
    // this controller with a proper channel service. Use a generated fallback when
    // the caller does not supply one.
    const channelCode = code || `CH${Date.now()}`;
    const channel = await ctx.prisma.channel.create({
      data: { code: channelCode, name, type, accountInfo, cost: cost ? Number(cost) : 0 },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: channel,
    };
  }

  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { name, accountInfo, cost, status } = ctx.request.body;

    const channel = await ctx.prisma.channel.findUnique({
      where: { id },
    });
    if (!channel) {
      ctx.throw(404, '渠道不存在');
    }

    const updateData: Prisma.ChannelUncheckedUpdateInput = {};
    if (name) updateData.name = name;
    if (accountInfo !== undefined) updateData.accountInfo = accountInfo;
    if (cost !== undefined) updateData.cost = Number(cost);
    if (status) updateData.status = status;

    const updated = await ctx.prisma.channel.update({
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

    const channel = await ctx.prisma.channel.findUnique({
      where: { id },
      include: { leads: true },
    });
    if (!channel) {
      ctx.throw(404, '渠道不存在');
    }

    if (channel.leads.length > 0) {
      ctx.throw(400, '该渠道有关联线索，无法删除');
    }

    await ctx.prisma.channel.delete({ where: { id } });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }

  async statistics() {
    const { ctx } = this;
    const { id } = ctx.params;

    const channel = await ctx.prisma.channel.findUnique({
      where: { id },
    });
    if (!channel) {
      ctx.throw(404, '渠道不存在');
    }

    const stats = await ctx.prisma.lead.groupBy({
      by: ['status'],
      where: { channelId: id },
      _count: { id: true },
    });

    const totalLeads = stats.reduce((sum, s) => sum + s._count.id, 0);
    const convertedLeads = stats.find(s => s.status === 'SIGNED')?._count.id || 0;

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        channel,
        totalLeads,
        convertedLeads,
        conversionRate: totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(2) + '%' : '0%',
        byStatus: stats,
      },
    };
  }
}
