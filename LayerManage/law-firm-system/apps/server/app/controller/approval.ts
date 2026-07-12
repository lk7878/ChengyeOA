import { Controller } from 'egg';

export default class ApprovalController extends Controller {
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, status, type, applicantId } = ctx.query;

    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (applicantId) where.applicantId = applicantId;

    const total = await ctx.prisma.approval.count({ where });
    const list = await ctx.prisma.approval.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
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

    const approval = await ctx.prisma.approval.findUnique({
      where: { id },
    });

    if (!approval) {
      ctx.throw(404, '审批不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: approval,
    };
  }

  async create() {
    const { ctx } = this;
    const { type, title, content } = ctx.request.body;

    if (!type || !title) {
      ctx.throw(400, '类型和标题不能为空');
    }

    const approval = await ctx.prisma.approval.create({
      data: {
        type,
        title,
        content,
        applicantId: ctx.state.user.userId,
      },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: approval,
    };
  }

  async process() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { action, remark } = ctx.request.body;

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      ctx.throw(400, '操作必须是 APPROVED 或 REJECTED');
    }

    const approval = await ctx.prisma.approval.findUnique({
      where: { id },
    });
    if (!approval) {
      ctx.throw(404, '审批不存在');
    }

    if (approval.status !== 'PENDING') {
      ctx.throw(400, '该审批已处理');
    }

    const updated = await ctx.prisma.approval.update({
      where: { id },
      data: {
        status: action,
        approverId: ctx.state.user.userId,
        approvedAt: new Date(),
        remark: remark || approval.remark,
      },
    });

    ctx.body = {
      code: 200,
      message: action === 'APPROVED' ? '审批通过' : '审批已拒绝',
      data: updated,
    };
  }
}
