import { SettlementService } from './settlement-service';
import { crmTransaction } from '../crm/crm-transaction';
// SPEC-037 Task 2: performance-service —— 绩效生命周期（create/list/get/confirm）。
// 形态镜像 case-service：3 参构造 (prisma, actor, authorizationContext)；
// requireAction 每公开方法第一行；assertExactKeys 入参白名单；同事务 OperationLog 审计。
// U6-B：读写均校验真实创建人/员工组织范围，业务动作保留状态与版本。

import { Prisma, PrismaClient } from '@prisma/client';
import { performanceScope } from './performance-scope';
import { buildEmployeeScopeWhere } from '../authorization/resource-scope-resolvers';
import { buildCaseScopeWhere } from '../case/case-scope';
import { buildFinancialRecordScopeWhere } from '../finance/financial-record-scope';
import { createOnce } from '../finance/domain-mutation';
import { PermissionCode } from '../../domain/authorization/authorization-types';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE } from '../master-data/employee-projection';
import { AuditActor } from '../master-data/master-data-types';
import { PERFORMANCE_ERROR_CODES, PerformanceError } from '../../domain/performance/performance-errors';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import {
  PERFORMANCE_TYPES,
  PerformanceListQuery,
  PerformanceView,
  PerformanceBusinessMetrics,
  PagedResult,
  CreatePerformanceInput,
  SetGoalInput,
  SelfReviewInput,
  ManagerReviewInput,
  projectPerformance,
} from './performance-types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const PERFORMANCE_WITH_EMPLOYEE = {
  include: { employee: { include: EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE } },
} as const;

export class PerformanceService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  /** 新建绩效：performance.create → 校验（employeeId 存在/period 格式/type 枚举/kpiData JSON）
   * → 唯一探针（employeeId+period+type）→ status PENDING + 审计。 */
  async createPerformance(input: CreatePerformanceInput): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.create');
    assertExactKeys(input, [
      'employeeId',
      'period',
      'type',
      'kpiData',
      'score',
      'bonus',
      'remark',
      'idempotencyKey',
    ]);
    const employeeId = normalizeRequiredText(input.employeeId, 1, 100);
    const period = normalizePeriod(input.period);
    const type = normalizeAllowedValue(input.type, PERFORMANCE_TYPES);
    const kpiData = input.kpiData === undefined ? '{}' : normalizeKpiData(input.kpiData);
    const score = input.score === undefined ? null : normalizePerformanceAmount(input.score);
    const bonus = input.bonus === undefined ? null : normalizePerformanceAmount(input.bonus);
    const remark = normalizeOptionalText(input.remark, 500);

    const targetScope = await this.authorization.resolveScopeTargets(
      this.authorizationContext,
      'employee',
      'employee.read',
    );
    this.authorization.requireAction(this.authorizationContext, 'employee.read');
    const employee = await this.prisma.employee.findFirst({
      where: {
        AND: [
          { id: employeeId, deletedAt: null, status: { not: 'LEAVED' } },
          buildEmployeeScopeWhere(targetScope),
        ],
      },
    });
    const scope = await performanceScope(this.prisma, this.authorizationContext, 'performance.create');
    const key = normalizeOptionalText(input.idempotencyKey, 100);
    if (!employee) throw new MasterDataError('VALIDATION_FAILED', 400);

    return createOnce(
      this.prisma,
      {
        actorId: this.actor.actorUserId,
        key,
        operation: 'performance.create',
        normalized: { employeeId, period, type, kpiData, score, bonus, remark },
      },
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance:' + employeeId + ':' + period + ':' + type}, 0))`;
        if (await tx.performance.findFirst({ where: { employeeId, period, type }, select: { id: true } }))
          throw new PerformanceError(
            PERFORMANCE_ERROR_CODES.PERFORMANCE_DUPLICATE,
            409,
            'performance record already exists',
          );
        const created = await tx.performance.create({
          data: {
            employeeId,
            period,
            type,
            kpiData,
            score,
            bonus,
            remark,
            status: 'PENDING',
            createdBy: this.actor.actorUserId,
            updatedBy: this.actor.actorUserId,
          },
          ...PERFORMANCE_WITH_EMPLOYEE,
        });
        await this.probe(tx, created.id, scope);
        await tx.operationLog.create({
          data: {
            userId: this.actor.actorUserId,
            action: 'PERFORMANCE_CREATE',
            targetType: 'PERFORMANCE',
            targetId: created.id,
            newValues: JSON.stringify({ performanceId: created.id, employeeId, period, type }),
            ip: this.actor.ip,
          },
        });
        return projectPerformance(created);
      },
      async (tx, targetId) => projectPerformance(await this.probe(tx, targetId, scope)),
    );
  }

  /** 绩效列表：performance.read → 过滤（employeeId/period/type）+ 分页 createdAt DESC。 */
  async listPerformances(query: PerformanceListQuery): Promise<PagedResult<PerformanceView>> {
    this.authorization.requireAction(this.authorizationContext, 'performance.read');
    const rawPage = query.page;
    const rawPageSize = query.pageSize;
    assertExactKeys(query, ['page', 'pageSize', 'employeeId', 'period', 'type']);
    const page = rawPage === undefined ? 1 : rawPage;
    const pageSize = rawPageSize === undefined ? DEFAULT_PAGE_SIZE : rawPageSize;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_PAGE_SIZE
    ) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }

    const where: Prisma.PerformanceWhereInput = {
      AND: [await performanceScope(this.prisma, this.authorizationContext, 'performance.read')],
    };
    if (query.employeeId !== undefined) where.employeeId = normalizeRequiredText(query.employeeId, 1, 100);
    if (query.period !== undefined) where.period = normalizeRequiredText(query.period, 1, 20);
    if (query.type !== undefined) where.type = normalizeAllowedValue(query.type, PERFORMANCE_TYPES);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.performance.count({ where }),
      this.prisma.performance.findMany({
        where,
        ...PERFORMANCE_WITH_EMPLOYEE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { list: rows.map((row) => projectPerformance(row)), page, pageSize, total };
  }

  /** 绩效详情：performance.read → 含 employee 主职投影。 */
  async getPerformance(performanceId: string): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.read');
    const id = normalizeRequiredText(performanceId, 1, 100);
    const row = await this.probe(
      this.prisma,
      id,
      await performanceScope(this.prisma, this.authorizationContext, 'performance.read'),
    );
    return projectPerformance(row);
  }

  /** 业务指标：performance.read → 该员工考核周期案件办结数/回款额（纯读聚合）。 */
  async getBusinessMetrics(performanceId: string): Promise<PerformanceBusinessMetrics> {
    this.authorization.requireAction(this.authorizationContext, 'performance.read');
    const id = normalizeRequiredText(performanceId, 1, 100);
    const record = await this.probe(
      this.prisma,
      id,
      await performanceScope(this.prisma, this.authorizationContext, 'performance.read'),
    );
    const { start, end } = parsePeriodRange(record.period);
    const canReadCases = this.authorizationContext.permissionCodes.includes('case.read');
    const canReadPayments =
      canReadCases && this.authorizationContext.permissionCodes.includes('payment.read');
    const caseScope = canReadCases
      ? await buildCaseScopeWhere(this.prisma, this.authorizationContext, 'case.read')
      : { id: { in: [] as string[] } };
    const closedCases = canReadCases
      ? await this.prisma.case.count({
          where: {
            AND: [
              { lawyerId: record.employeeId, status: 'CLOSED', closedAt: { gte: start, lt: end } },
              caseScope,
            ],
          },
        })
      : null;
    const revenue = canReadPayments
      ? await this.prisma.payment.aggregate({
          _sum: { amount: true },
          where: {
            AND: [
              {
                deletedAt: null,
                status: 'CONFIRMED',
                confirmedAt: { gte: start, lt: end },
                contract: { deletedAt: null, case: { AND: [{ lawyerId: record.employeeId }, caseScope] } },
              },
              await buildFinancialRecordScopeWhere(
                this.prisma,
                this.authorization,
                this.authorizationContext,
                'payment.read',
                'payment',
              ),
            ],
          },
        })
      : null;
    const amount = revenue ? new Prisma.Decimal(revenue._sum.amount ?? 0) : null;
    const autoScore =
      closedCases !== null && amount !== null
        ? Math.max(
            0,
            Math.min(
              100,
              amount
                .div(10000)
                .plus(closedCases * 10)
                .toDecimalPlaces(0)
                .toNumber(),
            ),
          )
        : null;
    const rights = await new SettlementService(this.prisma, this.authorizationContext).rights();
    const width = record.type === 'YEARLY' ? 12 : record.type === 'QUARTERLY' ? 3 : 1;
    const first = Math.floor(start.getUTCMonth() / width) * width;
    const month = (n: number) => record.period.slice(0,4) + '-' + String(n).padStart(2,'0');
    const visible = this.authorizationContext.employeeId === record.employeeId ? {} : rights.visible;
    const earnings = await this.prisma.casePayLine.aggregate({
      where:{employeeId:record.employeeId,settlement:{AND:[visible,{status:{in:['CONFIRMED','IN_PAYROLL','PAID']},period:{gte:month(first+1),lte:month(first+width)}}]}},
      _sum:{amount:true},
    });
    return { ...(earnings._sum.amount ? { caseEarnings: earnings._sum.amount.toFixed(2) } : {}), closedCases, confirmedRevenue: amount?.toFixed(2) ?? null, autoScore };
  }

  /** 确认绩效：performance.confirm → PENDING → CONFIRMED（终态，重复确认 409）+ 审计。 */
  async confirmPerformance(
    performanceId: string,
    input: { version?: number } = {},
  ): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.confirm');
    assertExactKeys(input, ['version']);
    const id = normalizeRequiredText(performanceId, 1, 100);
    return this.transitionPerformance(
      id,
      null,
      'PERFORMANCE_CONFIRM',
      { status: 'CONFIRMED' },
      'performance.confirm',
      input.version,
    );
  }

  /** 目标设定：performance.update → 仅 PENDING 期可设 → goal + 审计。 */
  async setGoal(performanceId: string, input: SetGoalInput, transaction?: Prisma.TransactionClient): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.update');
    const id = normalizeRequiredText(performanceId, 1, 100);
    assertExactKeys(input, ['goal', 'version']);
    const goal = normalizeRequiredText(input.goal, 1, 2000);

    return this.transitionPerformance(
      id,
      'PENDING',
      'PERFORMANCE_GOAL_SET',
      { goal },
      'performance.update',
      input.version,
      transaction,
    );
  }

  /** 自评：performance.update → PENDING → SELF_REVIEWED + selfScore/selfComment + 审计。 */
  async selfReview(performanceId: string, input: SelfReviewInput): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.update');
    const id = normalizeRequiredText(performanceId, 1, 100);
    assertExactKeys(input, ['selfScore', 'selfComment', 'version']);
    const selfScore = normalizeReviewScore(input.selfScore);
    const selfComment = normalizeOptionalText(input.selfComment, 2000);

    return this.transitionPerformance(
      id,
      'PENDING',
      'PERFORMANCE_SELF_REVIEW',
      { selfScore, selfComment, status: 'SELF_REVIEWED' },
      'performance.update',
      input.version,
    );
  }

  /** 主管评：performance.confirm → SELF_REVIEWED → MANAGER_REVIEWED + managerScore/managerComment/reviewerId/reviewedAt + 审计。 */
  async managerReview(performanceId: string, input: ManagerReviewInput): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.confirm');
    const id = normalizeRequiredText(performanceId, 1, 100);
    assertExactKeys(input, ['managerScore', 'managerComment', 'version']);
    const managerScore = normalizeReviewScore(input.managerScore);
    const managerComment = normalizeOptionalText(input.managerComment, 2000);

    return this.transitionPerformance(
      id,
      'SELF_REVIEWED',
      'PERFORMANCE_MANAGER_REVIEW',
      {
        managerScore,
        managerComment,
        status: 'MANAGER_REVIEWED',
        reviewerId: this.actor.actorUserId,
        reviewedAt: new Date(),
      },
      'performance.confirm',
      input.version,
    );
  }

  private async probe(tx: Prisma.TransactionClient, id: string, scope: Prisma.PerformanceWhereInput) {
    const row = await tx.performance.findFirst({
      where: { AND: [{ id }, scope] },
      ...PERFORMANCE_WITH_EMPLOYEE,
    });
    if (!row)
      throw new PerformanceError(PERFORMANCE_ERROR_CODES.PERFORMANCE_NOT_FOUND, 404, 'performance not found');
    return row;
  }
  private async transitionPerformance(
    id: string,
    fromStatus: string | null,
    action: string,
    data: Prisma.PerformanceUpdateManyMutationInput,
    permission: PermissionCode,
    expectedVersion?: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<PerformanceView> {
    const scope = await performanceScope(this.prisma, this.authorizationContext, permission);
    const version = expectedVersion === undefined ? undefined : normalizeVersion(expectedVersion);
    return crmTransaction(this.prisma, transaction, async (tx) => {
      await tx.$queryRaw`SELECT id FROM performance WHERE id = ${id} FOR UPDATE`;
      const current = await this.probe(tx, id, scope);
      if (version !== undefined && current.version !== version)
        throw new MasterDataError('VERSION_CONFLICT', 409);
      if (action === 'PERFORMANCE_SELF_REVIEW' && current.employeeId !== this.authorizationContext.employeeId)
        throw new MasterDataError('PERFORMANCE_SELF_REVIEW_FORBIDDEN', 403);
      if (current.status === 'CONFIRMED' || (fromStatus && current.status !== fromStatus))
        throw new PerformanceError(
          PERFORMANCE_ERROR_CODES.PERFORMANCE_STATE_INVALID,
          409,
          'performance state invalid',
        );
      const flipped = await tx.performance.updateMany({
        where: { id, version: current.version, status: current.status },
        data: { ...data, version: { increment: 1 }, updatedBy: this.actor.actorUserId },
      });
      if (!flipped.count) throw new MasterDataError('VERSION_CONFLICT', 409);
      const row = await this.probe(tx, id, scope);
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action,
          targetType: 'PERFORMANCE',
          targetId: row.id,
          newValues: JSON.stringify({
            performanceId: row.id,
            fromStatus: current.status,
            toStatus: row.status,
            version: row.version,
          }),
          ip: this.actor.ip,
        },
      });
      return projectPerformance(row);
    });
  }
}

/** 考核周期校验：格式 "YYYY-MM"（如 "2026-04"），非法 → 400。 */
function normalizePeriod(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}

/** kpiData JSON 校验：非空字符串 ≤2000 且合法 JSON，非法 → 400。 */
function normalizeKpiData(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  try {
    JSON.parse(value);
  } catch {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}

/** 金额校验（score/bonus）：非负数字字符串（≤ Decimal(18,2)），非法 → 400。 */
function normalizePerformanceAmount(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,16}(\.\d{1,2})?$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return new Prisma.Decimal(value).toFixed(2);
}

/** 考核评分校验（selfScore/managerScore）：整数 0-100，非法 → 400。 */
function normalizeReviewScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}

/** 考核周期解析（SPEC-044）："YYYY-MM" → [start, end) 月份边界，非法 → 400。 */
function parsePeriodRange(period: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new MasterDataError('VALIDATION_FAILED', 400);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new MasterDataError('VALIDATION_FAILED', 400);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}
