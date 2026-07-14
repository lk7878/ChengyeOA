import { Prisma } from '@prisma/client';
import { Controller } from 'egg';

export default class EmployeeController extends Controller {
  /**
   * 员工列表
   */
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, keyword, type, status, orgId } = ctx.query;

    const where: Prisma.EmployeeWhereInput = {};
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { employeeNo: { contains: keyword } },
        { phone: { contains: keyword } },
      ];
    }
    if (type) where.type = type;
    if (status) where.status = status;
    if (orgId) where.orgId = orgId;

    const total = await ctx.prisma.employee.count({ where });
    const list = await ctx.prisma.employee.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      include: {
        organization: true,
        position: true,
        user: true,
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
   * 员工详情
   */
  async show() {
    const { ctx } = this;
    const { id } = ctx.params;

    const employee = await ctx.prisma.employee.findUnique({
      where: { id },
      include: {
        organization: true,
        position: true,
        user: {
          include: {
            userRoles: {
              include: { role: true },
            },
          },
        },
        leads: true,
        cases: true,
      },
    });

    if (!employee) {
      ctx.throw(404, '员工不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: employee,
    };
  }

  /**
   * 创建员工
   */
  async create() {
    const { ctx } = this;
    const {
      employeeNo,
      name,
      phone,
      email,
      idCard,
      type,
      entryDate,
      orgId,
      positionId,
    } = ctx.request.body;

    if (!employeeNo || !name || !phone || !type || !entryDate || !orgId || !positionId) {
      ctx.throw(400, '缺少必填字段');
    }

    // 检查工号是否已存在
    const existing = await ctx.prisma.employee.findUnique({
      where: { employeeNo },
    });
    if (existing) {
      ctx.throw(409, '工号已存在');
    }

    const employee = await ctx.prisma.employee.create({
      data: {
        employeeNo,
        name,
        phone,
        email,
        idCard,
        type,
        entryDate: new Date(entryDate),
        orgId,
        positionId,
      },
      include: {
        organization: true,
        position: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: employee,
    };
  }

  /**
   * 更新员工
   */
  async update() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { name, phone, email, type, orgId, positionId } = ctx.request.body;

    const employee = await ctx.prisma.employee.findUnique({
      where: { id },
    });
    if (!employee) {
      ctx.throw(404, '员工不存在');
    }

    const updateData: Prisma.EmployeeUncheckedUpdateInput = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (type) updateData.type = type;
    if (orgId) updateData.orgId = orgId;
    if (positionId) updateData.positionId = positionId;

    const updated = await ctx.prisma.employee.update({
      where: { id },
      data: updateData,
      include: {
        organization: true,
        position: true,
      },
    });

    ctx.body = {
      code: 200,
      message: '更新成功',
      data: updated,
    };
  }

  /**
   * 删除员工
   */
  async destroy() {
    const { ctx } = this;
    const { id } = ctx.params;

    const employee = await ctx.prisma.employee.findUnique({
      where: { id },
      include: {
        user: true,
        leads: true,
        cases: true,
      },
    });
    if (!employee) {
      ctx.throw(404, '员工不存在');
    }

    if (employee.user) {
      ctx.throw(400, '该员工已关联用户账号，无法删除');
    }
    if (employee.leads.length > 0) {
      ctx.throw(400, '该员工负责线索，无法删除');
    }
    if (employee.cases.length > 0) {
      ctx.throw(400, '该员工主办案件，无法删除');
    }

    await ctx.prisma.employee.delete({
      where: { id },
    });

    ctx.body = {
      code: 200,
      message: '删除成功',
      data: null,
    };
  }

  /**
   * 转正
   */
  async formalize() {
    const { ctx } = this;
    const { id } = ctx.params;

    const employee = await ctx.prisma.employee.findUnique({
      where: { id },
    });
    if (!employee) {
      ctx.throw(404, '员工不存在');
    }

    if (employee.status !== 'PROBATION') {
      ctx.throw(400, '只有试用期员工可以转正');
    }

    const updated = await ctx.prisma.employee.update({
      where: { id },
      data: { status: 'FORMAL' },
    });

    ctx.body = {
      code: 200,
      message: '转正成功',
      data: updated,
    };
  }

  /**
   * 离职
   */
  async leave() {
    const { ctx } = this;
    const { id } = ctx.params;
    const { leaveDate } = ctx.request.body;

    const employee = await ctx.prisma.employee.findUnique({
      where: { id },
      include: {
        leads: { where: { status: { not: 'SIGNED' } } },
        cases: { where: { status: { not: 'CLOSED' } } },
      },
    });
    if (!employee) {
      ctx.throw(404, '员工不存在');
    }

    if (employee.leads.length > 0) {
      ctx.throw(400, '该员工有未完成的线索，请先交接');
    }
    if (employee.cases.length > 0) {
      ctx.throw(400, '该员工有未结案的案件，请先交接');
    }

    const updated = await ctx.prisma.employee.update({
      where: { id },
      data: {
        status: 'LEAVED',
        leaveDate: leaveDate ? new Date(leaveDate) : new Date(),
      },
    });

    // 禁用关联用户
    const employeeWithUser = await ctx.prisma.employee.findUnique({
      where: { id },
      include: { user: true },
    });
    if (employeeWithUser?.user) {
      await ctx.prisma.user.update({
        where: { id: employeeWithUser.user.id },
        data: { status: 'DISABLED' },
      });
    }

    ctx.body = {
      code: 200,
      message: '离职处理成功',
      data: updated,
    };
  }
}
