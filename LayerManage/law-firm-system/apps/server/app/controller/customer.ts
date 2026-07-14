import { Prisma } from '@prisma/client';
import { Controller } from 'egg';

export default class CustomerController extends Controller {
  /**
   * 客户列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, keyword, status } = ctx.query;

    const where: Prisma.CustomerWhereInput = {};
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { phone: { contains: keyword } },
        { wechat: { contains: keyword } },
      ];
    }
    if (status) where.status = status;

    const total = await ctx.prisma.customer.count({ where });
    const list = await ctx.prisma.customer.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      include: {
        lead: {
          include: {
            channel: true,
          },
        },
        _count: {
          select: { contracts: true, cases: true, payments: true },
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
   * 客户详情
   */
  async show() {
    const { ctx } = this;
    const { id } = ctx.params;

    const customer = await ctx.prisma.customer.findUnique({
      where: { id },
      include: {
        lead: {
          include: {
            channel: true,
            followRecords: true,
          },
        },
        contracts: {
          orderBy: { createdAt: 'desc' },
        },
        cases: {
          include: {
            lawyer: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customer) {
      ctx.throw(404, '客户不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: customer,
    };
  }

  /**
   * 创建客户
   */
  async create() {
    const { ctx } = this;
    const { name, phone, wechat, idCard, email, address, status = 'POTENTIAL', tags, remark } = ctx.request.body;

    if (!name || !phone) {
      ctx.throw(400, '姓名和电话不能为空');
    }

    const customer = await ctx.prisma.customer.create({
      data: {
        name,
        phone,
        wechat,
        idCard,
        email,
        address,
        status,
        tags,
        remark,
      },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: customer,
    };
  }

  /**
   * 更新客户
   */
  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { name, phone, wechat, idCard, email, address, status, tags, remark } = ctx.request.body;

    const customer = await ctx.prisma.customer.findUnique({
      where: { id },
    });
    if (!customer) {
      ctx.throw(404, '客户不存在');
    }

    const updateData: Prisma.CustomerUncheckedUpdateInput = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (wechat !== undefined) updateData.wechat = wechat;
    if (idCard !== undefined) updateData.idCard = idCard;
    if (email !== undefined) updateData.email = email;
    if (address !== undefined) updateData.address = address;
    if (status) updateData.status = status;
    if (tags !== undefined) updateData.tags = tags;
    if (remark !== undefined) updateData.remark = remark;

    const updated = await ctx.prisma.customer.update({
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
   * 删除客户
   */
  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    const customer = await ctx.prisma.customer.findUnique({
      where: { id },
      include: {
        contracts: true,
        cases: true,
      },
    });
    if (!customer) {
      ctx.throw(404, '客户不存在');
    }

    if (customer.contracts.length > 0) {
      ctx.throw(400, '该客户有关联合同，无法删除');
    }
    if (customer.cases.length > 0) {
      ctx.throw(400, '该客户有关联案件，无法删除');
    }

    await ctx.prisma.customer.delete({
      where: { id },
    });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }

  /**
   * 客户合同列表
   */
  async contracts() {
    const { ctx } = this;
    const { id } = ctx.params;

    const contracts = await ctx.prisma.contract.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: contracts,
    };
  }

  /**
   * 客户案件列表
   */
  async cases() {
    const { ctx } = this;
    const { id } = ctx.params;

    const cases = await ctx.prisma.case.findMany({
      where: { customerId: id },
      include: {
        lawyer: true,
        contract: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: cases,
    };
  }

  /**
   * 客户收款列表
   */
  async payments() {
    const { ctx } = this;
    const { id } = ctx.params;

    const payments = await ctx.prisma.payment.findMany({
      where: { customerId: id },
      include: {
        contract: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: payments,
    };
  }
}
