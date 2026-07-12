import { Controller } from 'egg';

export default class ContractController extends Controller {
  /**
   * 合同列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, keyword, status, type, customerId } = ctx.query;

    const where: any = {};
    if (keyword) {
      where.OR = [
        { title: { contains: keyword } },
        { contractNo: { contains: keyword } },
      ];
    }
    if (status) where.status = status;
    if (type) where.type = type;
    if (customerId) where.customerId = customerId;

    const total = await ctx.prisma.contract.count({ where });
    const list = await ctx.prisma.contract.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      include: {
        customer: true,
        payments: true,
        case: true,
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
   * 合同详情
   */
  async show() {
    const { ctx } = this;
    const { id } = ctx.params;

    const contract = await ctx.prisma.contract.findUnique({
      where: { id },
      include: {
        customer: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        case: {
          include: {
            lawyer: true,
            tasks: true,
          },
        },
      },
    });

    if (!contract) {
      ctx.throw(404, '合同不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: contract,
    };
  }

  /**
   * 创建合同
   */
  async create() {
    const { ctx } = this;
    const { contractNo, title, type, customerId, amount, paymentTerms, terms, startDate, endDate } = ctx.request.body;

    if (!contractNo || !title || !type || !customerId) {
      ctx.throw(400, '缺少必填字段');
    }

    // 检查合同编号是否已存在
    const existing = await ctx.prisma.contract.findUnique({
      where: { contractNo },
    });
    if (existing) {
      ctx.throw(409, '合同编号已存在');
    }

    const contract = await ctx.prisma.contract.create({
      data: {
        contractNo,
        title,
        type,
        customerId,
        amount: amount ? Number(amount) : 0,
        paymentTerms,
        terms,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        createdBy: ctx.state.user.userId,
      },
      include: {
        customer: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: contract,
    };
  }

  /**
   * 更新合同
   */
  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { title, amount, paymentTerms, terms, startDate, endDate } = ctx.request.body;

    const contract = await ctx.prisma.contract.findUnique({
      where: { id },
    });
    if (!contract) {
      ctx.throw(404, '合同不存在');
    }

    // 只有草稿状态可以编辑
    if (contract.status !== 'DRAFT') {
      ctx.throw(400, '只有草稿状态的合同可以编辑');
    }

    const updateData: any = {};
    if (title) updateData.title = title;
    if (amount !== undefined) updateData.amount = Number(amount);
    if (paymentTerms !== undefined) updateData.paymentTerms = paymentTerms;
    if (terms !== undefined) updateData.terms = terms;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;

    const updated = await ctx.prisma.contract.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '更新成功',
      data: updated,
    };
  }

  /**
   * 删除合同
   */
  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    const contract = await ctx.prisma.contract.findUnique({
      where: { id },
      include: { payments: true, case: true },
    });
    if (!contract) {
      ctx.throw(404, '合同不存在');
    }

    if (contract.payments.length > 0) {
      ctx.throw(400, '该合同有收款记录，无法删除');
    }
    if (contract.case) {
      ctx.throw(400, '该合同已关联案件，无法删除');
    }

    await ctx.prisma.contract.delete({
      where: { id },
    });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }

  /**
   * 提交审批
   */
  async submit() {
    const { ctx } = this;
    const { id } = ctx.params;

    const contract = await ctx.prisma.contract.findUnique({
      where: { id },
    });
    if (!contract) {
      ctx.throw(404, '合同不存在');
    }

    if (contract.status !== 'DRAFT') {
      ctx.throw(400, '只有草稿状态的合同可以提交审批');
    }

    const updated = await ctx.prisma.contract.update({
      where: { id },
      data: { status: 'PENDING' },
    });

    ctx.body = {
      code: 200,
      message: '提交审批成功',
      data: updated,
    };
  }

  /**
   * 审批通过
   */
  async approve() {
    const { ctx } = this;
    const { id } = ctx.params;

    const contract = await ctx.prisma.contract.findUnique({
      where: { id },
    });
    if (!contract) {
      ctx.throw(404, '合同不存在');
    }

    if (contract.status !== 'PENDING') {
      ctx.throw(400, '只有待审批状态的合同可以审批');
    }

    const updated = await ctx.prisma.contract.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: ctx.state.user.userId,
        approvedAt: new Date(),
      },
    });

    ctx.body = {
      code: 200,
      message: '审批通过',
      data: updated,
    };
  }

  /**
   * 签署合同
   */
  async sign() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { signDate } = ctx.request.body;

    const contract = await ctx.prisma.contract.findUnique({
      where: { id },
    });
    if (!contract) {
      ctx.throw(404, '合同不存在');
    }

    if (contract.status !== 'APPROVED') {
      ctx.throw(400, '只有已审批的合同可以签署');
    }

    const updated = await ctx.prisma.contract.update({
      where: { id },
      data: {
        status: 'SIGNED',
        signDate: signDate ? new Date(signDate) : new Date(),
      },
    });

    ctx.body = {
      code: 200,
      message: '签署成功',
      data: updated,
    };
  }

  /**
   * 终止合同
   */
  async terminate() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { reason } = ctx.request.body;

    const contract = await ctx.prisma.contract.findUnique({
      where: { id },
      include: { case: true },
    });
    if (!contract) {
      ctx.throw(404, '合同不存在');
    }

    if (contract.case && contract.case.status !== 'CLOSED') {
      ctx.throw(400, '该合同有关联未结案案件，请先结案');
    }

    const updated = await ctx.prisma.contract.update({
      where: { id },
      data: {
        status: 'TERMINATED',
        terms: reason ? `${contract.terms || ''}\n[终止原因: ${reason}]` : contract.terms,
      },
    });

    ctx.body = {
      code: 200,
      message: '合同已终止',
      data: updated,
    };
  }

  /**
   * 合同台账
   */
  async ledger() {
    const { ctx } = this;
    const { status, year } = ctx.query;

    const where: any = {};
    if (status) where.status = status;
    if (year) {
      where.createdAt = {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${Number(year) + 1}-01-01`),
      };
    }

    const contracts = await ctx.prisma.contract.findMany({
      where,
      include: {
        customer: true,
        payments: true,
        case: {
          include: {
            lawyer: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 统计
    const stats = {
      total: contracts.length,
      totalAmount: contracts.reduce((sum, c) => sum + Number(c.amount), 0),
      totalPaid: contracts.reduce((sum, c) => sum + Number(c.paidAmount), 0),
      byStatus: {} as Record<string, number>,
    };

    contracts.forEach(c => {
      stats.byStatus[c.status] = (stats.byStatus[c.status] || 0) + 1;
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        list: contracts,
        stats,
      },
    };
  }
}
