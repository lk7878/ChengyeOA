import { Controller } from 'egg';

export default class CaseController extends Controller {
  /**
   * 案件列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, keyword, status, lawyerId, priority } = ctx.query;

    const where: any = {};
    if (keyword) {
      where.OR = [
        { title: { contains: keyword } },
        { caseNo: { contains: keyword } },
        { caseType: { contains: keyword } },
      ];
    }
    if (status) where.status = status;
    if (lawyerId) where.lawyerId = lawyerId;
    if (priority) where.priority = priority;

    const total = await ctx.prisma.case.count({ where });
    const list = await ctx.prisma.case.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      include: {
        customer: true,
        lawyer: {
          include: {
            organization: true,
            position: true,
          },
        },
        contract: true,
        _count: {
          select: { tasks: true, communications: true },
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
   * 案件详情
   */
  async show() {
    const { ctx } = this;
    const { id } = ctx.params;

    const caseItem = await ctx.prisma.case.findUnique({
      where: { id },
      include: {
        customer: true,
        lawyer: {
          include: {
            organization: true,
            position: true,
          },
        },
        contract: true,
        tasks: {
          orderBy: { createdAt: 'asc' },
        },
        communications: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!caseItem) {
      ctx.throw(404, '案件不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: caseItem,
    };
  }

  /**
   * 创建案件
   */
  async create() {
    const { ctx } = this;
    const { caseNo, title, customerId, contractId, lawyerId, caseType, fee, description } = ctx.request.body;

    if (!caseNo || !title || !customerId || !lawyerId || !caseType) {
      ctx.throw(400, '缺少必填字段');
    }

    // 检查案件编号是否已存在
    const existing = await ctx.prisma.case.findUnique({
      where: { caseNo },
    });
    if (existing) {
      ctx.throw(409, '案件编号已存在');
    }

    const caseItem = await ctx.prisma.case.create({
      data: {
        caseNo,
        title,
        customerId,
        contractId,
        lawyerId,
        caseType,
        fee: fee ? Number(fee) : 0,
        description,
      },
      include: {
        customer: true,
        lawyer: true,
        contract: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: caseItem,
    };
  }

  /**
   * 更新案件
   */
  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { title, lawyerId, caseType, status, priority, fee, description, result, satisfaction, isReferrable } = ctx.request.body;

    const caseItem = await ctx.prisma.case.findUnique({
      where: { id },
    });
    if (!caseItem) {
      ctx.throw(404, '案件不存在');
    }

    const updateData: any = {};
    if (title) updateData.title = title;
    if (lawyerId) updateData.lawyerId = lawyerId;
    if (caseType) updateData.caseType = caseType;
    if (status) updateData.status = status;
    if (priority) updateData.priority = priority;
    if (fee !== undefined) updateData.fee = Number(fee);
    if (description !== undefined) updateData.description = description;
    if (result !== undefined) updateData.result = result;
    if (satisfaction !== undefined) updateData.satisfaction = satisfaction;
    if (isReferrable !== undefined) updateData.isReferrable = isReferrable;

    const updated = await ctx.prisma.case.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        lawyer: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '更新成功',
      data: updated,
    };
  }

  /**
   * 删除案件
   */
  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    const caseItem = await ctx.prisma.case.findUnique({
      where: { id },
      include: {
        tasks: true,
        communications: true,
      },
    });
    if (!caseItem) {
      ctx.throw(404, '案件不存在');
    }

    if (caseItem.tasks.length > 0) {
      ctx.throw(400, '该案件有任务记录，无法删除');
    }
    if (caseItem.communications.length > 0) {
      ctx.throw(400, '该案件有沟通记录，无法删除');
    }

    await ctx.prisma.case.delete({
      where: { id },
    });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }

  /**
   * 创建任务
   */
  async createTask() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { name, nodeType, dueDate, remark } = ctx.request.body;

    if (!name || !nodeType) {
      ctx.throw(400, '任务名称和节点类型不能为空');
    }

    const caseItem = await ctx.prisma.case.findUnique({
      where: { id },
    });
    if (!caseItem) {
      ctx.throw(404, '案件不存在');
    }

    const task = await ctx.prisma.caseTask.create({
      data: {
        caseId: id,
        name,
        nodeType,
        dueDate: dueDate ? new Date(dueDate) : null,
        remark,
      },
    });

    ctx.body = {
      code: 200,
      message: '任务创建成功',
      data: task,
    };
  }

  /**
   * 更新任务
   */
  async updateTask() {
    const { ctx } = this;
    const { id, taskId } = ctx.params;
    const { status, completedAt, remark } = ctx.request.body;

    const task = await ctx.prisma.caseTask.findUnique({
      where: { id: taskId },
    });
    if (!task || task.caseId !== id) {
      ctx.throw(404, '任务不存在');
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (completedAt !== undefined) updateData.completedAt = completedAt ? new Date(completedAt) : null;
    if (remark !== undefined) updateData.remark = remark;

    const updated = await ctx.prisma.caseTask.update({
      where: { id: taskId },
      data: updateData,
    });

    ctx.body = {
      code: 200,
      message: '任务更新成功',
      data: updated,
    };
  }

  /**
   * 添加沟通记录
   */
  async createCommunication() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { type, content, isKey } = ctx.request.body;

    if (!type || !content) {
      ctx.throw(400, '沟通类型和内容不能为空');
    }

    const caseItem = await ctx.prisma.case.findUnique({
      where: { id },
    });
    if (!caseItem) {
      ctx.throw(404, '案件不存在');
    }

    const communication = await ctx.prisma.communication.create({
      data: {
        caseId: id,
        type,
        content,
        isKey: isKey || false,
        createdBy: ctx.state.user.userId,
      },
    });

    ctx.body = {
      code: 200,
      message: '沟通记录添加成功',
      data: communication,
    };
  }

  /**
   * 结案
   */
  async close() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { result, satisfaction } = ctx.request.body;

    const caseItem = await ctx.prisma.case.findUnique({
      where: { id },
      include: {
        tasks: {
          where: { status: { not: 'COMPLETED' } },
        },
      },
    });
    if (!caseItem) {
      ctx.throw(404, '案件不存在');
    }

    if (caseItem.status === 'CLOSED' || caseItem.status === 'ARCHIVED') {
      ctx.throw(400, '案件已结案');
    }

    if (caseItem.tasks.length > 0) {
      ctx.throw(400, '该案件有未完成任务，请先完成');
    }

    const updated = await ctx.prisma.case.update({
      where: { id },
      data: {
        status: 'CLOSED',
        result,
        satisfaction,
        closedAt: new Date(),
      },
    });

    ctx.body = {
      code: 200,
      message: '案件已结案',
      data: updated,
    };
  }
}
