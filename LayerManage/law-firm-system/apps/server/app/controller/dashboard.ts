import { Controller } from 'egg';

export default class DashboardController extends Controller {
  /**
   * 核心指标
   */
  async metrics() {
    const { ctx } = this;

    const [
      leadCount,
      customerCount,
      contractCount,
      caseCount,
      paymentTotal,
      employeeCount,
    ] = await Promise.all([
      ctx.prisma.lead.count(),
      ctx.prisma.customer.count(),
      ctx.prisma.contract.count(),
      ctx.prisma.case.count(),
      ctx.prisma.payment.aggregate({
        where: { status: 'RECEIVED' },
        _sum: { receivedAmount: true },
      }),
      ctx.prisma.employee.count({ where: { status: 'FORMAL' } }),
    ]);

    // 本月数据
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      monthLeads,
      monthContracts,
      monthPayments,
    ] = await Promise.all([
      ctx.prisma.lead.count({ where: { createdAt: { gte: monthStart } } }),
      ctx.prisma.contract.count({ where: { createdAt: { gte: monthStart } } }),
      ctx.prisma.payment.aggregate({
        where: {
          status: 'RECEIVED',
          receivedDate: { gte: monthStart },
        },
        _sum: { receivedAmount: true },
      }),
    ]);

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        overview: {
          leadCount,
          customerCount,
          contractCount,
          caseCount,
          totalRevenue: paymentTotal._sum.receivedAmount || 0,
          employeeCount,
        },
        monthly: {
          newLeads: monthLeads,
          newContracts: monthContracts,
          monthRevenue: monthPayments._sum.receivedAmount || 0,
        },
      },
    };
  }

  /**
   * 转化漏斗
   */
  async funnel() {
    const { ctx } = this;

    const leadStats = await ctx.prisma.lead.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const customerStats = await ctx.prisma.customer.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const contractStats = await ctx.prisma.contract.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        leads: leadStats,
        customers: customerStats,
        contracts: contractStats,
      },
    };
  }

  /**
   * 团队指标
   */
  async teamMetrics() {
    const { ctx } = this;

    const lawyers = await ctx.prisma.employee.findMany({
      where: {
        type: { in: ['PARTNER', 'SENIOR_LAWYER', 'JUNIOR_LAWYER'] },
        status: 'FORMAL',
      },
      include: {
        _count: {
          select: { cases: true, leads: true },
        },
        cases: {
          where: { status: { not: 'CLOSED' } },
        },
      },
    });

    const metrics = lawyers.map(l => ({
      id: l.id,
      name: l.name,
      type: l.type,
      totalCases: l._count.cases,
      activeCases: l.cases.length,
      assignedLeads: l._count.leads,
    }));

    ctx.body = {
      code: 200,
      message: 'success',
      data: metrics,
    };
  }

  /**
   * 财务指标
   */
  async financeMetrics() {
    const { ctx } = this;

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [
      yearRevenue,
      yearContracts,
      pendingPayments,
      overduePayments,
    ] = await Promise.all([
      ctx.prisma.payment.aggregate({
        where: {
          status: 'RECEIVED',
          receivedDate: { gte: yearStart },
        },
        _sum: { receivedAmount: true },
      }),
      ctx.prisma.contract.aggregate({
        where: { createdAt: { gte: yearStart } },
        _sum: { amount: true },
      }),
      ctx.prisma.payment.count({ where: { status: 'PENDING' } }),
      ctx.prisma.payment.count({
        where: {
          status: 'PENDING',
          dueDate: { lt: now },
        },
      }),
    ]);

    // 按月统计
    const monthlyData = await ctx.prisma.payment.groupBy({
      by: ['status'],
      where: {
        receivedDate: { gte: yearStart },
      },
      _sum: { receivedAmount: true },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        yearRevenue: yearRevenue._sum.receivedAmount || 0,
        yearContractValue: yearContracts._sum.amount || 0,
        pendingCount: pendingPayments,
        overdueCount: overduePayments,
        monthlyBreakdown: monthlyData,
      },
    };
  }

  /**
   * 案件指标
   */
  async caseMetrics() {
    const { ctx } = this;

    const [
      statusStats,
      priorityStats,
      typeStats,
      monthCases,
    ] = await Promise.all([
      ctx.prisma.case.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      ctx.prisma.case.groupBy({
        by: ['priority'],
        _count: { id: true },
      }),
      ctx.prisma.case.groupBy({
        by: ['caseType'],
        _count: { id: true },
      }),
      ctx.prisma.case.count({
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
    ]);

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        byStatus: statusStats,
        byPriority: priorityStats,
        byType: typeStats,
        monthNewCases: monthCases,
      },
    };
  }

  /**
   * 预警信息
   */
  async alerts() {
    const { ctx } = this;
    const now = new Date();

    const [
      overdueTasks,
      overduePayments,
      unassignedLeads,
      urgentCases,
    ] = await Promise.all([
      ctx.prisma.caseTask.count({
        where: {
          status: { not: 'COMPLETED' },
          dueDate: { lt: now },
        },
      }),
      ctx.prisma.payment.findMany({
        where: {
          status: 'PENDING',
          dueDate: { lt: now },
        },
        include: {
          customer: true,
          contract: true,
        },
        take: 10,
      }),
      ctx.prisma.lead.count({
        where: {
          assignedTo: null,
          status: { notIn: ['SIGNED', 'LOST'] },
        },
      }),
      ctx.prisma.case.findMany({
        where: {
          priority: 'URGENT',
          status: { notIn: ['CLOSED', 'ARCHIVED'] },
        },
        include: {
          customer: true,
          lawyer: true,
        },
        take: 10,
      }),
    ]);

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        overdueTasks,
        overduePayments,
        unassignedLeads,
        urgentCases,
      },
    };
  }
}
