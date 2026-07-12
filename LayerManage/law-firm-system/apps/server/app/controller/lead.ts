import { Controller } from 'egg';

export default class LeadController extends Controller {
  /**
   * 线索列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, keyword, status, channelId, assignedTo, intentionLevel } = ctx.query;

    const where: any = {};
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { phone: { contains: keyword } },
        { wechat: { contains: keyword } },
      ];
    }
    if (status) where.status = status;
    if (channelId) where.channelId = channelId;
    if (assignedTo) where.assignedTo = assignedTo;
    if (intentionLevel) where.intentionLevel = Number(intentionLevel);

    const total = await ctx.prisma.lead.count({ where });
    const list = await ctx.prisma.lead.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      include: {
        channel: true,
        assignee: {
          include: {
            organization: true,
            position: true,
          },
        },
        followRecords: {
          orderBy: { createdAt: 'desc' },
          take: 1,
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
   * 线索详情
   */
  async show() {
    const { ctx } = this;
    const { id } = ctx.params;

    const lead = await ctx.prisma.lead.findUnique({
      where: { id },
      include: {
        channel: true,
        assignee: {
          include: {
            organization: true,
            position: true,
          },
        },
        followRecords: {
          orderBy: { createdAt: 'desc' },
        },
        customer: true,
      },
    });

    if (!lead) {
      ctx.throw(404, '线索不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: lead,
    };
  }

  /**
   * 创建线索
   */
  async create() {
    const { ctx } = this;
    const { name, phone, wechat, channelId, sourceDetail, intentionLevel = 3, tags } = ctx.request.body;

    if (!name || !phone) {
      ctx.throw(400, '姓名和电话不能为空');
    }

    const lead = await ctx.prisma.lead.create({
      data: {
        name,
        phone,
        wechat,
        channelId,
        sourceDetail,
        intentionLevel,
        tags,
      },
      include: {
        channel: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: lead,
    };
  }

  /**
   * 更新线索
   */
  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { name, phone, wechat, intentionLevel, status, tags, isValid, invalidReason } = ctx.request.body;

    const lead = await ctx.prisma.lead.findUnique({
      where: { id },
    });
    if (!lead) {
      ctx.throw(404, '线索不存在');
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (wechat !== undefined) updateData.wechat = wechat;
    if (intentionLevel) updateData.intentionLevel = intentionLevel;
    if (status) updateData.status = status;
    if (tags !== undefined) updateData.tags = tags;
    if (isValid !== undefined) updateData.isValid = isValid;
    if (invalidReason !== undefined) updateData.invalidReason = invalidReason;

    const updated = await ctx.prisma.lead.update({
      where: { id },
      data: updateData,
      include: {
        channel: true,
        assignee: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '更新成功',
      data: updated,
    };
  }

  /**
   * 删除线索
   */
  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    const lead = await ctx.prisma.lead.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!lead) {
      ctx.throw(404, '线索不存在');
    }

    if (lead.customer) {
      ctx.throw(400, '该线索已转为客户，无法删除');
    }

    await ctx.prisma.lead.delete({
      where: { id },
    });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }

  /**
   * 分配负责人
   */
  async assign() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { employeeId } = ctx.request.body;

    if (!employeeId) {
      ctx.throw(400, '负责人ID不能为空');
    }

    const lead = await ctx.prisma.lead.findUnique({
      where: { id },
    });
    if (!lead) {
      ctx.throw(404, '线索不存在');
    }

    const employee = await ctx.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) {
      ctx.throw(404, '员工不存在');
    }

    const updated = await ctx.prisma.lead.update({
      where: { id },
      data: { assignedTo: employeeId },
      include: {
        assignee: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '分配成功',
      data: updated,
    };
  }

  /**
   * 跟进
   */
  async follow() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { type, content, nextPlan, nextTime } = ctx.request.body;

    if (!type || !content) {
      ctx.throw(400, '跟进类型和内容不能为空');
    }

    const lead = await ctx.prisma.lead.findUnique({
      where: { id },
    });
    if (!lead) {
      ctx.throw(404, '线索不存在');
    }

    const follow = await ctx.prisma.leadFollow.create({
      data: {
        leadId: id,
        type,
        content,
        nextPlan,
        nextTime: nextTime ? new Date(nextTime) : null,
        createdBy: ctx.state.user.userId,
      },
    });

    // 更新线索状态为已联系
    if (lead.status === 'NEW') {
      await ctx.prisma.lead.update({
        where: { id },
        data: { status: 'CONTACTED' },
      });
    }

    ctx.body = {
      code: 200,
      message: '跟进记录添加成功',
      data: follow,
    };
  }

  /**
   * 转客户
   */
  async convert() {
    const { ctx } = this;
    const { id } = ctx.params;

    const lead = await ctx.prisma.lead.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!lead) {
      ctx.throw(404, '线索不存在');
    }

    if (lead.customer) {
      ctx.throw(400, '该线索已转为客户');
    }

    // 创建客户
    const customer = await ctx.prisma.customer.create({
      data: {
        name: lead.name,
        phone: lead.phone,
        wechat: lead.wechat,
        status: 'POTENTIAL',
        leadId: id,
      },
    });

    // 更新线索状态
    await ctx.prisma.lead.update({
      where: { id },
      data: { status: 'SIGNED' },
    });

    ctx.body = {
      code: 200,
      message: '转客户成功',
      data: { customer },
    };
  }

  /**
   * 跟进记录列表
   */
  async follows() {
    const { ctx } = this;
    const { id } = ctx.params;

    const follows = await ctx.prisma.leadFollow.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: follows,
    };
  }

  /**
   * 回收线索
   */
  async recycle() {
    const { ctx } = this;
    const { id } = ctx.params;

    const lead = await ctx.prisma.lead.findUnique({
      where: { id },
    });
    if (!lead) {
      ctx.throw(404, '线索不存在');
    }

    const updated = await ctx.prisma.lead.update({
      where: { id },
      data: { assignedTo: null, status: 'NEW' },
    });

    ctx.body = {
      code: 200,
      message: '回收成功',
      data: updated,
    };
  }
}
