// SPEC-037 Task 2: performance-service —— 绩效生命周期（create/list/get/confirm）。
// 形态镜像 case-service：3 参构造 (prisma, actor, authorizationContext)；
// requireAction 每公开方法第一行；assertExactKeys 入参白名单；同事务 OperationLog 审计。
// 绩效为业务资源（员工考核记录），仅权限门控（performance.* 码）不做行级 scope。

import { Prisma, PrismaClient } from '@prisma/client';

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
    assertExactKeys(input, ['employeeId', 'period', 'type', 'kpiData', 'score', 'bonus', 'remark']);
    const employeeId = normalizeRequiredText(input.employeeId, 1, 100);
    const period = normalizePeriod(input.period);
    const type = normalizeAllowedValue(input.type, PERFORMANCE_TYPES);
    const kpiData = input.kpiData === undefined ? '{}' : normalizeKpiData(input.kpiData);
    const score = input.score === undefined ? null : normalizePerformanceAmount(input.score);
    const bonus = input.bonus === undefined ? null : normalizePerformanceAmount(input.bonus);
    const remark = normalizeOptionalText(input.remark, 500);

    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId } });
    if (!employee) throw new MasterDataError('VALIDATION_FAILED', 400);

    // 唯一探针：employeeId+period+type 已存在 → 409（避免 FK/唯一约束 P2002 落 500）。
    const existing = await this.prisma.performance.findFirst({ where: { employeeId, period, type } });
    if (existing) {
      throw new PerformanceError(PERFORMANCE_ERROR_CODES.PERFORMANCE_DUPLICATE, 409, 'performance record already exists');
    }

    return this.prisma.$transaction(async tx => {
      const created = await tx.performance.create({
        data: { employeeId, period, type, kpiData, score, bonus, remark, status: 'PENDING' },
        ...PERFORMANCE_WITH_EMPLOYEE,
      });
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
    });
  }

  /** 绩效列表：performance.read → 过滤（employeeId/period/type）+ 分页 createdAt DESC。 */
  async listPerformances(query: PerformanceListQuery): Promise<PagedResult<PerformanceView>> {
    this.authorization.requireAction(this.authorizationContext, 'performance.read');
    const rawPage = query.page;
    const rawPageSize = query.pageSize;
    assertExactKeys(query, ['page', 'pageSize', 'employeeId', 'period', 'type']);
    const page = rawPage === undefined ? 1 : rawPage;
    const pageSize = rawPageSize === undefined ? DEFAULT_PAGE_SIZE : rawPageSize;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }

    const where: Prisma.PerformanceWhereInput = {};
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
    return { list: rows.map(row => projectPerformance(row)), page, pageSize, total };
  }

  /** 绩效详情：performance.read → 含 employee 主职投影。 */
  async getPerformance(performanceId: string): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.read');
    const id = normalizeRequiredText(performanceId, 1, 100);
    const row = await this.prisma.performance.findUnique({
      where: { id },
      ...PERFORMANCE_WITH_EMPLOYEE,
    });
    if (!row) throw new PerformanceError(PERFORMANCE_ERROR_CODES.PERFORMANCE_NOT_FOUND, 404, 'performance not found');
    return projectPerformance(row);
  }

  /** 业务指标：performance.read → 该员工考核周期案件办结数/回款额（纯读聚合）。 */
  async getBusinessMetrics(performanceId: string): Promise<PerformanceBusinessMetrics> {
    this.authorization.requireAction(this.authorizationContext, 'performance.read');
    const id = normalizeRequiredText(performanceId, 1, 100);
    const record = await this.prisma.performance.findUnique({ where: { id } });
    if (!record) throw new PerformanceError(PERFORMANCE_ERROR_CODES.PERFORMANCE_NOT_FOUND, 404, 'performance not found');
    const { start, end } = parsePeriodRange(record.period);

    const closedCases = await this.prisma.case.count({
      where: { lawyerId: record.employeeId, status: 'CLOSED', closedAt: { gte: start, lt: end } },
    });
    const revenue = await this.prisma.payment.aggregate({
      _sum: { amount: true },
      where: {
        status: 'CONFIRMED',
        confirmedAt: { gte: start, lt: end },
        contract: { case: { lawyerId: record.employeeId } },
      },
    });
    const confirmedRevenue = (revenue._sum.amount ?? 0).toFixed(2);
    // SPEC-045：自动计分——每办结 1 案 +10 分；每回款 1 万 +1 分；clamp 0-100。
    const autoScore = Math.max(0, Math.min(100, Math.round(closedCases * 10 + Number(revenue._sum.amount ?? 0) / 10000)));
    return {
      closedCases,
      confirmedRevenue,
      autoScore,
    };
  }

  /** 确认绩效：performance.confirm → PENDING → CONFIRMED（终态，重复确认 409）+ 审计。 */
  async confirmPerformance(performanceId: string): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.confirm');
    const id = normalizeRequiredText(performanceId, 1, 100);

    return this.prisma.$transaction(async tx => {
      const flipped = await tx.performance.updateMany({
        where: { id, status: { not: 'CONFIRMED' } },
        data: { status: 'CONFIRMED' },
      });
      if (flipped.count === 0) {
        const existing = await tx.performance.findUnique({ where: { id } });
        if (!existing) throw new PerformanceError(PERFORMANCE_ERROR_CODES.PERFORMANCE_NOT_FOUND, 404, 'performance not found');
        throw new PerformanceError(PERFORMANCE_ERROR_CODES.PERFORMANCE_STATE_INVALID, 409, 'performance is already confirmed');
      }
      const row = await tx.performance.findUniqueOrThrow({ where: { id }, ...PERFORMANCE_WITH_EMPLOYEE });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'PERFORMANCE_CONFIRM',
          targetType: 'PERFORMANCE',
          targetId: row.id,
          newValues: JSON.stringify({ performanceId: row.id, status: 'CONFIRMED' }),
          ip: this.actor.ip,
        },
      });
      return projectPerformance(row);
    });
  }

  /** 目标设定：performance.update → 仅 PENDING 期可设 → goal + 审计。 */
  async setGoal(performanceId: string, input: SetGoalInput): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.update');
    const id = normalizeRequiredText(performanceId, 1, 100);
    assertExactKeys(input, ['goal']);
    const goal = normalizeRequiredText(input.goal, 1, 2000);

    return this.transitionPerformance(id, 'PENDING', 'PERFORMANCE_GOAL_SET', { goal });
  }

  /** 自评：performance.update → PENDING → SELF_REVIEWED + selfScore/selfComment + 审计。 */
  async selfReview(performanceId: string, input: SelfReviewInput): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.update');
    const id = normalizeRequiredText(performanceId, 1, 100);
    assertExactKeys(input, ['selfScore', 'selfComment']);
    const selfScore = normalizeReviewScore(input.selfScore);
    const selfComment = normalizeOptionalText(input.selfComment, 2000);

    return this.transitionPerformance(id, 'PENDING', 'PERFORMANCE_SELF_REVIEW', { selfScore, selfComment, status: 'SELF_REVIEWED' });
  }

  /** 主管评：performance.confirm → SELF_REVIEWED → MANAGER_REVIEWED + managerScore/managerComment/reviewerId/reviewedAt + 审计。 */
  async managerReview(performanceId: string, input: ManagerReviewInput): Promise<PerformanceView> {
    this.authorization.requireAction(this.authorizationContext, 'performance.confirm');
    const id = normalizeRequiredText(performanceId, 1, 100);
    assertExactKeys(input, ['managerScore', 'managerComment']);
    const managerScore = normalizeReviewScore(input.managerScore);
    const managerComment = normalizeOptionalText(input.managerComment, 2000);

    return this.transitionPerformance(
      id,
      'SELF_REVIEWED',
      'PERFORMANCE_MANAGER_REVIEW',
      { managerScore, managerComment, status: 'MANAGER_REVIEWED', reviewerId: this.actor.actorUserId, reviewedAt: new Date() },
    );
  }

  /**
   * 状态守卫翻转通用实现：updateMany {id, status: fromStatus} → count=0 → 404 或 409 STATE_INVALID；
   * 成功后落审计 + 重读投影。
   */
  private async transitionPerformance(
    performanceId: string,
    fromStatus: string,
    action: string,
    data: Prisma.PerformanceUpdateManyMutationInput,
  ): Promise<PerformanceView> {
    return this.prisma.$transaction(async tx => {
      const flipped = await tx.performance.updateMany({
        where: { id: performanceId, status: fromStatus },
        data,
      });
      if (flipped.count === 0) {
        const existing = await tx.performance.findUnique({ where: { id: performanceId } });
        if (!existing) throw new PerformanceError(PERFORMANCE_ERROR_CODES.PERFORMANCE_NOT_FOUND, 404, 'performance not found');
        throw new PerformanceError(PERFORMANCE_ERROR_CODES.PERFORMANCE_STATE_INVALID, 409, `performance is not in ${fromStatus}`);
      }
      const row = await tx.performance.findUniqueOrThrow({ where: { id: performanceId }, ...PERFORMANCE_WITH_EMPLOYEE });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action,
          targetType: 'PERFORMANCE',
          targetId: row.id,
          newValues: JSON.stringify({ performanceId: row.id, fromStatus, toStatus: row.status }),
          ip: this.actor.ip,
        },
      });
      return projectPerformance(row);
    });
  }
}

/** 考核周期校验：格式 "YYYY-MM"（如 "2026-04"），非法 → 400。 */
function normalizePeriod(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) {
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
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value) || value.length > 18) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
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
