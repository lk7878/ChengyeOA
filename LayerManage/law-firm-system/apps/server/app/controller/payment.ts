import { Prisma } from '@prisma/client';
import { Controller } from 'egg';

export default class PaymentController extends Controller {
  /**
   * 收款列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, status, customerId, contractId } = ctx.query;

    const where: Prisma.PaymentWhereInput = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (contractId) where.contractId = contractId;

    const total = await ctx.prisma.payment.count({ where });
    const list = await ctx.prisma.payment.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      include: {
        customer: true,
        contract: true,
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
   * 收款详情
   */
  async show() {
    const { ctx } = this;
    const { id } = ctx.params;

    const payment = await ctx.prisma.payment.findUnique({
      where: { id },
      include: {
        customer: true,
        contract: true,
      },
    });

    if (!payment) {
      ctx.throw(404, '收款记录不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: payment,
    };
  }

  /**
   * 创建收款
   */
  async create() {
    const { ctx } = this;
    const { contractId, customerId, amount, dueDate, remark } = ctx.request.body;

    if (!customerId || !amount) {
      ctx.throw(400, '客户和金额不能为空');
    }

    const payment = await ctx.prisma.payment.create({
      data: {
        contractId,
        customerId,
        amount: Number(amount),
        dueDate: dueDate ? new Date(dueDate) : null,
        remark,
      },
      include: {
        customer: true,
        contract: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: payment,
    };
  }

  /**
   * 更新收款
   */
  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { amount, dueDate, remark } = ctx.request.body;

    const payment = await ctx.prisma.payment.findUnique({
      where: { id },
    });
    if (!payment) {
      ctx.throw(404, '收款记录不存在');
    }

    // 只有待收款状态可以编辑
    if (payment.status !== 'PENDING') {
      ctx.throw(400, '只有待收款状态的记录可以编辑');
    }

    const updateData: Prisma.PaymentUncheckedUpdateInput = {};
    if (amount !== undefined) updateData.amount = Number(amount);
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (remark !== undefined) updateData.remark = remark;

    const updated = await ctx.prisma.payment.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        contract: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '更新成功',
      data: updated,
    };
  }

  /**
   * 删除收款
   */
  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    const payment = await ctx.prisma.payment.findUnique({
      where: { id },
    });
    if (!payment) {
      ctx.throw(404, '收款记录不存在');
    }

    if (payment.status === 'RECEIVED') {
      ctx.throw(400, '已收款记录无法删除');
    }

    await ctx.prisma.payment.delete({
      where: { id },
    });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }

  /**
   * 确认收款
   */
  async confirm() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { receivedAmount, receivedDate, paymentMethod, paymentAccount } = ctx.request.body;

    const payment = await ctx.prisma.payment.findUnique({
      where: { id },
      include: { contract: true },
    });
    if (!payment) {
      ctx.throw(404, '收款记录不存在');
    }

    if (payment.status === 'RECEIVED') {
      ctx.throw(400, '该记录已收款');
    }

    const updated = await ctx.prisma.payment.update({
      where: { id },
      data: {
        status: 'RECEIVED',
        receivedAmount: receivedAmount ? Number(receivedAmount) : payment.amount,
        receivedDate: receivedDate ? new Date(receivedDate) : new Date(),
        paymentMethod,
        paymentAccount,
      },
      include: {
        customer: true,
        contract: true,
      },
    });

    // 更新合同已付款金额
    if (payment.contractId) {
      const contractPayments = await ctx.prisma.payment.findMany({
        where: {
          contractId: payment.contractId,
          status: 'RECEIVED',
        },
      });
      const totalPaid = contractPayments.reduce((sum, p) => sum + Number(p.receivedAmount), 0);

      await ctx.prisma.contract.update({
        where: { id: payment.contractId },
        data: { paidAmount: totalPaid },
      });
    }

    ctx.body = {
      code: 200,
      message: '收款确认成功',
      data: updated,
    };
  }

  /**
   * 退款
   */
  async refund() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { refundAmount, reason } = ctx.request.body;

    const payment = await ctx.prisma.payment.findUnique({
      where: { id },
    });
    if (!payment) {
      ctx.throw(404, '收款记录不存在');
    }

    if (payment.status !== 'RECEIVED') {
      ctx.throw(400, '只有已收款记录可以退款');
    }

    const updated = await ctx.prisma.payment.update({
      where: { id },
      data: {
        status: 'REFUNDED',
        remark: reason ? `${payment.remark || ''}\n[退款原因: ${reason}, 金额: ${refundAmount}]` : payment.remark,
      },
    });

    ctx.body = {
      code: 200,
      message: '退款处理成功',
      data: updated,
    };
  }
}
