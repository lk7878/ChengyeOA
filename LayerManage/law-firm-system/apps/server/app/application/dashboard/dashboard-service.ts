import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildEmployeeScopeWhere } from '../authorization/resource-scope-resolvers';
import { buildLeadScopeWhere } from '../crm/lead-scope';
import { buildContractScopeWhere, buildCustomerVisibilityWhere } from '../contract/contract-scope';
import { buildCaseScopeWhere } from '../case/case-scope';
import { buildFinancialRecordScopeWhere } from '../finance/financial-record-scope';
import { PermissionCode } from '../../domain/authorization/authorization-types';

// Calendar boundaries are explicit China business time; database timestamps remain UTC.
function calendar(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')!.value),
    month = Number(parts.find((p) => p.type === 'month')!.value);
  const boundary = (index: number) => new Date(Date.UTC(year, index, 1) - 8 * 3600000);
  return { year, month, monthStart: boundary(month - 1), yearStart: boundary(0), boundary };
}
export class DashboardService {
  private readonly auth: AuthorizationService;
  constructor(
    private readonly db: PrismaClient,
    private readonly ctx: AuthorizationContext,
  ) {
    this.auth = new AuthorizationService(new DataScopeService(db));
  }
  private has(code: PermissionCode) {
    return this.ctx.permissionCodes.includes(code);
  }
  private async lead(): Promise<Prisma.LeadWhereInput | null> {
    return this.has('lead.read')
      ? { AND: [{ deletedAt: null }, await buildLeadScopeWhere(this.db, this.auth, this.ctx, 'lead.read')] }
      : null;
  }
  private async customer(): Promise<Prisma.CustomerWhereInput | null> {
    return this.has('customer.read')
      ? {
          AND: [
            { deletedAt: null },
            await buildCustomerVisibilityWhere(this.db, this.auth, this.ctx, 'customer.read'),
          ],
        }
      : null;
  }
  private async contract(): Promise<Prisma.ContractWhereInput | null> {
    return this.has('contract.read')
      ? {
          AND: [
            { deletedAt: null },
            await buildContractScopeWhere(this.db, this.auth, this.ctx, 'contract.read'),
          ],
        }
      : null;
  }
  private async payment(): Promise<Prisma.PaymentWhereInput | null> {
    return this.has('payment.read')
      ? {
          AND: [
            { deletedAt: null, contract: { deletedAt: null } },
            await buildFinancialRecordScopeWhere(this.db, this.auth, this.ctx, 'payment.read', 'payment'),
          ],
        }
      : null;
  }
  private async cases(): Promise<Prisma.CaseWhereInput | null> {
    return this.has('case.read') ? buildCaseScopeWhere(this.db, this.ctx, 'case.read') : null;
  }
  private async employees(): Promise<Prisma.EmployeeWhereInput | null> {
    return this.has('employee.read')
      ? {
          AND: [
            { deletedAt: null },
            buildEmployeeScopeWhere(
              await this.auth.resolveScopeTargets(this.ctx, 'employee', 'employee.read'),
            ),
          ],
        }
      : null;
  }
  private async plans(): Promise<Prisma.PaymentPlanWhereInput | null> {
    const contract = await this.contract();
    if (!contract || !this.has('payment.read')) return null;
    // Plans are anchored to contracts; payment-record creator scope must not be applied to plan IDs.
    return {
      contract: {
        AND: [
          contract,
          await buildContractScopeWhere(this.db, this.auth, this.ctx, 'payment.read', 'payment'),
        ],
      },
    };
  }
  private async paymentAmount(where: Prisma.PaymentWhereInput | null, time?: { gte: Date; lt?: Date }) {
    if (!where) return null;
    const result = await this.db.payment.aggregate({
      where: { AND: [where, { status: 'CONFIRMED', ...(time ? { confirmedAt: time } : {}) }] },
      _sum: { amount: true },
    });
    return new Prisma.Decimal(result._sum.amount ?? 0).toFixed(2);
  }
  async metrics() {
    const [lead, customer, contract, cases, payment, employee] = await Promise.all([
      this.lead(),
      this.customer(),
      this.contract(),
      this.cases(),
      this.payment(),
      this.employees(),
    ]);
    const { monthStart } = calendar(new Date());
    const [
      leadCount,
      customerCount,
      contractCount,
      caseCount,
      totalRevenue,
      employeeCount,
      newLeads,
      newContracts,
      monthRevenue,
    ] = await Promise.all([
      lead ? this.db.lead.count({ where: lead }) : null,
      customer ? this.db.customer.count({ where: customer }) : null,
      contract ? this.db.contract.count({ where: contract }) : null,
      cases ? this.db.case.count({ where: cases }) : null,
      this.paymentAmount(payment),
      employee ? this.db.employee.count({ where: { AND: [employee, { status: 'FORMAL' }] } }) : null,
      lead ? this.db.lead.count({ where: { AND: [lead, { createdAt: { gte: monthStart } }] } }) : null,
      contract
        ? this.db.contract.count({ where: { AND: [contract, { createdAt: { gte: monthStart } }] } })
        : null,
      this.paymentAmount(payment, { gte: monthStart }),
    ]);
    return {
      overview: { leadCount, customerCount, contractCount, caseCount, totalRevenue, employeeCount },
      monthly: { newLeads, newContracts, monthRevenue },
    };
  }
  async funnel() {
    const [lead, customer, contract] = await Promise.all([this.lead(), this.customer(), this.contract()]);
    const [leads, customers, contracts] = await Promise.all([
      lead ? this.db.lead.groupBy({ by: ['status'], where: lead, _count: { id: true } }) : null,
      customer ? this.db.customer.groupBy({ by: ['status'], where: customer, _count: { id: true } }) : null,
      contract ? this.db.contract.groupBy({ by: ['status'], where: contract, _count: { id: true } }) : null,
    ]);
    return { leads, customers, contracts };
  }
  async teamMetrics() {
    const employees = await this.employees();
    if (!employees) return null;
    const people = await this.db.employee.findMany({
      where: {
        AND: [
          employees,
          { status: 'FORMAL', type: { in: ['PARTNER', 'SENIOR_LAWYER', 'JUNIOR_LAWYER', 'LAWYER'] } },
        ],
      },
      select: { id: true, name: true, type: true },
      orderBy: [{ employeeNo: 'asc' }, { id: 'asc' }],
    });
    const [cases, leads] = await Promise.all([this.cases(), this.lead()]);
    const ids = people.map((p) => p.id);
    const [total, active, assigned] = await Promise.all([
      cases
        ? this.db.case.groupBy({
            by: ['lawyerId'],
            where: { AND: [cases, { lawyerId: { in: ids } }] },
            _count: { id: true },
          })
        : null,
      cases
        ? this.db.case.groupBy({
            by: ['lawyerId'],
            where: { AND: [cases, { lawyerId: { in: ids }, status: { notIn: ['CLOSED', 'ARCHIVED'] } }] },
            _count: { id: true },
          })
        : null,
      leads
        ? this.db.lead.groupBy({
            by: ['assignedTo'],
            where: { AND: [leads, { assignedTo: { in: ids } }] },
            _count: { id: true },
          })
        : null,
    ]);
    return people.map((p) => ({
      ...p,
      totalCases: total ? (total.find((r) => r.lawyerId === p.id)?._count.id ?? 0) : null,
      activeCases: active ? (active.find((r) => r.lawyerId === p.id)?._count.id ?? 0) : null,
      assignedLeads: assigned ? (assigned.find((r) => r.assignedTo === p.id)?._count.id ?? 0) : null,
    }));
  }
  async financeMetrics() {
    const now = new Date(),
      c = calendar(now);
    const [payment, contract, plans] = await Promise.all([this.payment(), this.contract(), this.plans()]);
    const [yearRevenue, yearContracts, pendingCount, overdueCount, monthlyBreakdown] = await Promise.all([
      this.paymentAmount(payment, { gte: c.yearStart }),
      contract
        ? this.db.contract.aggregate({
            where: { AND: [contract, { createdAt: { gte: c.yearStart } }] },
            _sum: { amount: true },
          })
        : null,
      payment ? this.db.payment.count({ where: { AND: [payment, { status: 'PENDING' }] } }) : null,
      plans
        ? this.db.paymentPlan.count({
            where: {
              AND: [plans, { status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, dueDate: { lt: now } }],
            },
          })
        : null,
      payment
        ? Promise.all(
            Array.from({ length: c.month }, async (_, index) => ({
              month: c.year + '-' + String(index + 1).padStart(2, '0'),
              amount: await this.paymentAmount(payment, {
                gte: c.boundary(index),
                lt: c.boundary(index + 1),
              }),
            })),
          )
        : null,
    ]);
    return {
      yearRevenue,
      yearContractValue: yearContracts ? new Prisma.Decimal(yearContracts._sum.amount ?? 0).toFixed(2) : null,
      pendingCount,
      overdueCount,
      monthlyBreakdown,
    };
  }
  async caseMetrics() {
    const cases = await this.cases();
    if (!cases) return { byStatus: null, byPriority: null, byType: null, monthNewCases: null };
    const [byStatus, byPriority, byType, monthNewCases] = await Promise.all([
      this.db.case.groupBy({ by: ['status'], where: cases, _count: { id: true } }),
      this.db.case.groupBy({ by: ['priority'], where: cases, _count: { id: true } }),
      this.db.case.groupBy({ by: ['caseType'], where: cases, _count: { id: true } }),
      this.db.case.count({
        where: { AND: [cases, { createdAt: { gte: calendar(new Date()).monthStart } }] },
      }),
    ]);
    return { byStatus, byPriority, byType, monthNewCases };
  }
  async alerts() {
    const now = new Date();
    const [cases, plans, leads] = await Promise.all([this.cases(), this.plans(), this.lead()]);
    const tasks = cases; // Task reading is part of authorized case detail; only task mutations have a separate action.
    const [overdueTasks, payments, unassignedLeads, urgentCases] = await Promise.all([
      tasks
        ? this.db.caseTask.count({
            where: { sopInstanceId: null, case: { AND: [cases!, tasks] }, status: { not: 'COMPLETED' }, dueDate: { lt: now } },
          })
        : null,
      plans
        ? this.db.paymentPlan.findMany({
            where: {
              AND: [plans, { status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, dueDate: { lt: now } }],
            },
            select: {
              id: true,
              planNo: true,
              dueDate: true,
              amount: true,
              receivedAmount: true,
              contractId: true,
              contract: { select: { contractNo: true, title: true } },
            },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
            take: 10,
          })
        : null,
      leads
        ? this.db.lead.count({
            where: { AND: [leads, { assignedTo: null, status: { notIn: ['CONVERTED', 'LOST'] } }] },
          })
        : null,
      cases
        ? this.db.case.findMany({
            where: { AND: [cases, { priority: 'URGENT', status: { notIn: ['CLOSED', 'ARCHIVED'] } }] },
            select: { id: true, caseNo: true, title: true, status: true, priority: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            take: 10,
          })
        : null,
    ]);
    const overduePayments =
      payments?.map((p) => ({
        id: p.id,
        planNo: p.planNo,
        dueDate: p.dueDate,
        amount: p.amount.toFixed(2),
        receivedAmount: p.receivedAmount.toFixed(2),
        contractId: p.contractId,
        contractNo: p.contract.contractNo,
        contractTitle: p.contract.title,
      })) ?? null;
    return { overdueTasks, overduePayments, unassignedLeads, urgentCases };
  }
}
