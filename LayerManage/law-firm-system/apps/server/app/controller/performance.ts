// SPEC-037 Task 3: performance HTTP 控制器（替代遗留原型——直连 ctx.prisma、无权限门禁、
// 无校验/审计/测试，本版本替换为薄控制器调正规 service 层）。
// 薄控制器纪律（仿 case.ts / payment.ts）：传输层解析 → 调 performance 服务 → 包络响应
// { code:200, message:'success', data }；业务校验/权限/状态机/审计全在服务层。
// 路由门禁在 router.ts（performance.read×2 / performance.create / performance.confirm）。

import { Controller } from 'egg';

import { performanceService } from '../application/performance/performance-factory';
import { PerformanceListQuery } from '../application/performance/performance-types';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const CREATE_PERFORMANCE_BODY_KEYS = ['employeeId', 'period', 'type', 'kpiData', 'score', 'bonus', 'remark'] as const;
const LIST_QUERY_KEYS = ['page', 'pageSize', 'employeeId', 'period', 'type'] as const;
// SPEC-043：考核流程入参白名单——目标设定 / 自评 / 主管评。
const SET_GOAL_BODY_KEYS = ['goal'] as const;
const SELF_REVIEW_BODY_KEYS = ['selfScore', 'selfComment'] as const;
const MANAGER_REVIEW_BODY_KEYS = ['managerScore', 'managerComment'] as const;

export default class PerformanceController extends Controller {
  /** GET /api/v1/performances（performance.read）：绩效列表（过滤 + 分页）。 */
  async index() {
    this.respond(await performanceService(this.ctx).listPerformances(parsePerformanceListQuery(this.ctx.query)));
  }

  /** GET /api/v1/performances/:id（performance.read）：绩效详情（含员工投影）。 */
  async show() {
    this.respond(await performanceService(this.ctx).getPerformance(this.ctx.params.id));
  }

  /** POST /api/v1/performances（performance.create）：录入绩效。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_PERFORMANCE_BODY_KEYS);
    this.respond(await performanceService(this.ctx).createPerformance(body as never));
  }

  /** POST /api/v1/performances/:id/confirm（performance.confirm）：确认绩效（任意非终态→CONFIRMED）。 */
  async confirm() {
    this.respond(await performanceService(this.ctx).confirmPerformance(this.ctx.params.id));
  }

  /** GET /api/v1/performances/:id/metrics（performance.read，SPEC-044）：业务指标（案件办结数/回款额）。 */
  async metrics() {
    this.respond(await performanceService(this.ctx).getBusinessMetrics(this.ctx.params.id));
  }

  /** POST /api/v1/performances/:id/set-goal（performance.update，SPEC-043）：PENDING 期设目标。 */
  async setGoal() {
    const body = this.ctx.request.body;
    assertExactKeys(body, SET_GOAL_BODY_KEYS);
    this.respond(await performanceService(this.ctx).setGoal(this.ctx.params.id, body as never));
  }

  /** POST /api/v1/performances/:id/self-review（performance.update，SPEC-043）：员工自评（PENDING→SELF_REVIEWED）。 */
  async selfReview() {
    const body = this.ctx.request.body;
    assertExactKeys(body, SELF_REVIEW_BODY_KEYS);
    this.respond(await performanceService(this.ctx).selfReview(this.ctx.params.id, body as never));
  }

  /** POST /api/v1/performances/:id/manager-review（performance.confirm，SPEC-043）：主管评（SELF_REVIEWED→MANAGER_REVIEWED）。 */
  async managerReview() {
    const body = this.ctx.request.body;
    assertExactKeys(body, MANAGER_REVIEW_BODY_KEYS);
    this.respond(await performanceService(this.ctx).managerReview(this.ctx.params.id, body as never));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

/** 绩效列表查询解析：page/pageSize/过滤透传（枚举/数字服务层校验）。 */
function parsePerformanceListQuery(input: unknown): PerformanceListQuery {
  assertExactKeys(input, LIST_QUERY_KEYS);
  const query: PerformanceListQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  if (input.employeeId !== undefined) query.employeeId = input.employeeId as string;
  if (input.period !== undefined) query.period = input.period as string;
  if (input.type !== undefined) query.type = input.type as PerformanceListQuery['type'];
  return query;
}

/** query 数字解析：非法形态 400。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}
