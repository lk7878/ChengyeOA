import { Prisma } from '@prisma/client';
import { Controller } from 'egg';
import {
  EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE,
  projectEmployeeWithPrimaryAssignment,
} from '../application/master-data/employee-projection';

export default class PerformanceController extends Controller {
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, employeeId, period, type } = ctx.query;

    const where: Prisma.PerformanceWhereInput = {};
    if (employeeId) where.employeeId = employeeId;
    if (period) where.period = period;
    if (type) where.type = type;

    const total = await ctx.prisma.performance.count({ where });
    const list = await ctx.prisma.performance.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      include: {
        employee: {
          include: EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        list: list.map(performance => ({
          ...performance,
          employee: projectEmployeeWithPrimaryAssignment(performance.employee),
        })),
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

    const performance = await ctx.prisma.performance.findUnique({
      where: { id },
      include: {
        employee: {
          include: EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE,
        },
      },
    });

    if (!performance) {
      ctx.throw(404, '绩效记录不存在');
    }

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        ...performance,
        employee: projectEmployeeWithPrimaryAssignment(performance.employee),
      },
    };
  }

  async create() {
    const { ctx } = this;
    const { employeeId, period, type, kpiData, score, bonus, remark } = ctx.request.body;

    if (!employeeId || !period || !type) {
      ctx.throw(400, '员工、周期和类型不能为空');
    }

    const performance = await ctx.prisma.performance.create({
      data: {
        employeeId,
        period,
        type,
        kpiData,
        score: score ? Number(score) : null,
        bonus: bonus ? Number(bonus) : null,
        remark,
      },
      include: {
        employee: { include: EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE },
      },
    });

    ctx.body = {
      code: 200,
      message: '创建成功',
      data: {
        ...performance,
        employee: projectEmployeeWithPrimaryAssignment(performance.employee),
      },
    };
  }

  async confirm() {
    const { ctx } = this;
    const { id } = ctx.params;

    const performance = await ctx.prisma.performance.findUnique({
      where: { id },
    });
    if (!performance) {
      ctx.throw(404, '绩效记录不存在');
    }

    if (performance.status === 'CONFIRMED') {
      ctx.throw(400, '绩效已确认');
    }

    const updated = await ctx.prisma.performance.update({
      where: { id },
      data: { status: 'CONFIRMED' },
    });

    ctx.body = {
      code: 200,
      message: '绩效确认成功',
      data: updated,
    };
  }
}
