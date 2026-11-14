// SPEC-011 Task 10: cost HTTP 控制器（成本台账 CRUD + 软删）。
// 薄控制器纪律（逐字仿 SPEC-010 T10 payment.ts）：传输层解析 → 调 Task 8 冻结服务 →
// 包络响应。delete 方法名 destroy 沿 case controller 先例（router.ts:199）。

import { Controller } from 'egg';

import { costService } from '../application/finance/finance-factory';
import {
  CreateCostEntryInput,
  ListCostEntriesQuery,
  UpdateCostEntryInput,
} from '../application/finance/finance-types';
import { CostCategory } from '../domain/finance/finance-types';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const CREATE_BODY_KEYS = ['category', 'amount', 'occurredAt', 'note', 'channelId', 'caseId', 'idempotencyKey'] as const;
const UPDATE_BODY_KEYS = ['amount', 'occurredAt', 'note', 'version'] as const;

export default class CostController extends Controller {
  /** POST /api/v1/costs（cost.create）：成本登记。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_BODY_KEYS);
    this.respond(await costService(this.ctx).createCostEntry(body as unknown as CreateCostEntryInput));
  }

  /** GET /api/v1/costs（cost.read）：未删列表 + category/channelId/caseId 过滤。 */
  async index() {
    this.respond(await costService(this.ctx).listCostEntries(parseCostListQuery(this.ctx.query)));
  }

  /** GET /api/v1/costs/:id（cost.read）：详情，不存在/已软删统一 404。 */
  async show() {
    this.respond(await costService(this.ctx).getCostEntry(this.ctx.params.id));
  }

  /** PATCH /api/v1/costs/:id（cost.update）：乐观锁更新（仅 amount/occurredAt/note）。 */
  async update() {
    const body = this.ctx.request.body;
    assertExactKeys(body, UPDATE_BODY_KEYS);
    this.respond(await costService(this.ctx).updateCostEntry(
      this.ctx.params.id,
      body as unknown as UpdateCostEntryInput,
    ));
  }

  /** DELETE /api/v1/costs/:id（cost.delete）：软删（方法名 destroy 沿 case 先例）。 */
  async destroy() {
    this.respond(await costService(this.ctx).deleteCostEntry(this.ctx.params.id));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseCostListQuery(input: unknown): ListCostEntriesQuery {
  assertExactKeys(input, ['page', 'pageSize', 'category', 'channelId', 'caseId']);
  const query: ListCostEntriesQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  if (input.category !== undefined) query.category = input.category as CostCategory;
  if (input.channelId !== undefined) query.channelId = input.channelId as string;
  if (input.caseId !== undefined) query.caseId = input.caseId as string;
  return query;
}

/** query 数字解析：非法形态 400（与 payment/lead/customer 控制器同一纪律）。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}
