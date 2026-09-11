// SPEC-010 Task 10: negotiation HTTP 控制器（CRM-07 谈案）。
// 薄控制器纪律（仿 SPEC-009 T10 lead.ts/customer.ts）：只做传输层解析（query 数字/键名白名单）
// → 调 Task 6 冻结服务 → 包络响应；业务校验/权限/范围全部在服务层；服务抛出的
// MasterDataError/ContractError 原样传播给 errorHandler（ContractError 按实例 httpStatus 映射，
// 不切换 code 字符串）。组织锚/邀约/线索探针均在服务层（4a 模式），控制器零新增校验。

import { Controller } from 'egg';

import { negotiationService } from '../application/contract/contract-factory';
import {
  CloseNegotiationInput,
  CreateNegotiationInput,
  NegotiationListQuery,
  UpdateNegotiationInput,
} from '../application/contract/contract-types';
import { NegotiationStatus } from '../domain/events/event-types';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const CREATE_BODY_KEYS = [
  'customerId', 'leadId', 'appointmentId', 'negotiatorEmployeeId',
  'quotedAmount', 'customerConcerns', 'competitorInfo', 'remark',
  'branchId', 'professionalTeamId',
] as const;
const UPDATE_BODY_KEYS = [
  'negotiatorEmployeeId', 'quotedAmount', 'customerConcerns', 'competitorInfo', 'remark',
] as const;
const CLOSE_BODY_KEYS = ['outcome', 'unsignedReason'] as const;

export default class NegotiationController extends Controller {
  /** POST /api/v1/negotiations（negotiation.create）：创建谈案。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_BODY_KEYS);
    this.respond(await negotiationService(this.ctx).createNegotiation(body as unknown as CreateNegotiationInput));
  }

  /** GET /api/v1/negotiations（negotiation.read）：范围列表 + status/customerId 过滤 + 分页。 */
  async index() {
    this.respond(await negotiationService(this.ctx).listNegotiations(parseNegotiationListQuery(this.ctx.query)));
  }

  /** GET /api/v1/negotiations/:id（negotiation.read）：详情，不存在/越权统一 404。 */
  async show() {
    this.respond(await negotiationService(this.ctx).getNegotiation(this.ctx.params.id));
  }

  /** PATCH /api/v1/negotiations/:id（negotiation.update）：仅 NEGOTIATING 可改，仅更新提供字段。 */
  async update() {
    const body = this.ctx.request.body;
    assertExactKeys(body, UPDATE_BODY_KEYS);
    this.respond(await negotiationService(this.ctx).updateNegotiation(
      this.ctx.params.id,
      body as unknown as UpdateNegotiationInput,
    ));
  }

  /** POST /api/v1/negotiations/:id/close（negotiation.update）：完结（SIGNED/UNSIGNED）。 */
  async close() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CLOSE_BODY_KEYS);
    this.respond(await negotiationService(this.ctx).closeNegotiation(
      this.ctx.params.id,
      body as unknown as CloseNegotiationInput,
    ));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseNegotiationListQuery(input: unknown): NegotiationListQuery {
  assertExactKeys(input, ['page', 'pageSize', 'status', 'customerId']);
  const query: NegotiationListQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  if (input.status !== undefined) query.status = input.status as NegotiationStatus;
  if (input.customerId !== undefined) query.customerId = input.customerId as string;
  return query;
}

/** query 数字解析：非法形态 400（与 lead/customer 控制器同一纪律）。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}
