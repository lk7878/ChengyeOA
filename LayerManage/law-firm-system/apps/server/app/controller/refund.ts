// SPEC-011 Task 10: refund HTTP 控制器（退款/减免申请全生命周期）。
// 薄控制器纪律（逐字仿 SPEC-010 T10 payment.ts）：传输层解析 → 调 Task 6 冻结服务 →
// 包络响应。refund.approve/reject 挂 SPECIAL/CRITICAL 预存码（catalog 无 refund.reject 码，
// router.ts:183 先例）；approve/reject/execute body 白名单同形（comment 可选）。

import { Controller } from 'egg';

import { GovernanceStepUpAuthorization } from '../application/admin-governance/governance-step-up';
import { refundService } from '../application/finance/finance-factory';
import {
  CreateRefundRequestInput,
  ListRefundRequestsQuery,
  RefundActionInput,
} from '../application/finance/finance-types';
import { RefundRequestStatus, RefundRequestType } from '../domain/finance/finance-types';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const CREATE_BODY_KEYS = ['type', 'contractId', 'caseNo', 'paymentId', 'planId', 'amount', 'reason', 'idempotencyKey'] as const;
const ACTION_BODY_KEYS = ['comment', 'expectedVersion', 'idempotencyKey'] as const;

export default class RefundController extends Controller {
  /** POST /api/v1/refunds（refund.create）：退款/减免申请，PENDING。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_BODY_KEYS);
    this.respond(await refundService(this.ctx).createRefundRequest(body as unknown as CreateRefundRequestInput));
  }

  /** GET /api/v1/refunds（refund.read）：范围列表 + status/type/contractId/customerId 过滤。 */
  async index() {
    this.respond(await refundService(this.ctx).listRefundRequests(parseRefundListQuery(this.ctx.query)));
  }

  /** GET /api/v1/refunds/:id（refund.read）：详情，不存在/越权统一 404。 */
  async show() {
    this.respond(await refundService(this.ctx).getRefundRequest(this.ctx.params.id));
  }

  /** POST /api/v1/refunds/:id/approve（refund.approve，SPECIAL/CRITICAL）：PENDING→APPROVED。
   *  Task 7 接线：Step-Up 证明经 `x-step-up-token` HTTP 头 + ctx.state.user（claims）提取，
   *  透传服务层同事务消费（沿 adminGovernance.stepUpAuthorization 形态）。 */
  async approve() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ACTION_BODY_KEYS);
    this.respond(await refundService(this.ctx).approveRefundRequest(
      this.ctx.params.id,
      body as unknown as RefundActionInput,
      this.stepUpAuthorization(),
    ));
  }

  /** POST /api/v1/refunds/:id/reject（refund.approve 权限码）：PENDING→REJECTED。 */
  async reject() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ACTION_BODY_KEYS);
    this.respond(await refundService(this.ctx).rejectRefundRequest(
      this.ctx.params.id,
      body as unknown as RefundActionInput,
    ));
  }

  /** POST /api/v1/refunds/:id/execute（refund.execute）：APPROVED→EXECUTED + 资金回补/计划豁免。 */
  async execute() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ACTION_BODY_KEYS);
    this.respond(await refundService(this.ctx).executeRefundRequest(
      this.ctx.params.id,
      body as unknown as RefundActionInput,
    ));
  }

  /** Step-Up 授权提取（沿 adminGovernance.ts stepUpAuthorization 逐字形态）：claims 取
   *  ctx.state.user（鉴权中间件载入），token 取 `x-step-up-token` HTTP 头。 */
  private stepUpAuthorization(): GovernanceStepUpAuthorization {
    return {
      claims: this.ctx.state.user,
      token: this.ctx.get('x-step-up-token').trim(),
    };
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseRefundListQuery(input: unknown): ListRefundRequestsQuery {
  assertExactKeys(input, ['page', 'pageSize', 'status', 'type', 'contractId', 'customerId', 'caseNo']);
  const query: ListRefundRequestsQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  if (input.status !== undefined) query.status = input.status as RefundRequestStatus;
  if (input.type !== undefined) query.type = input.type as RefundRequestType;
  if (input.contractId !== undefined) query.contractId = input.contractId as string;
  if (input.customerId !== undefined) query.customerId = input.customerId as string;
  if (input.caseNo !== undefined) query.caseNo = input.caseNo as string;
  return query;
}

/** query 数字解析：非法形态 400（与 payment/lead/customer 控制器同一纪律）。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}
