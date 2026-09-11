// SPEC-010 Task 10: payment HTTP 控制器（整体替代 SPEC-001 原型——原型控制器随 Task 1 移除）。
// 薄控制器纪律（仿 SPEC-009 T10 lead.ts/customer.ts）：传输层解析 → 调 Task 9 冻结服务 →
// 包络响应；三方同事务联动/冲抵/幂等重放全部在服务层。无 delete 端点
// （FTN-001 §3.6：收款记录不得业务删除）；退款归 SPEC-011，原型 /refund 路径 404 锁死。

import { Controller } from 'egg';

import { receivableService } from '../application/contract/contract-factory';
import {
  ConfirmPaymentInput,
  CreatePaymentInput,
  ListPaymentsQuery,
  VoidPaymentInput,
} from '../application/contract/contract-types';
import { PaymentStatus } from '../domain/events/event-types';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const CREATE_BODY_KEYS = [
  'contractId', 'caseNo', 'paymentPlanId', 'amount', 'method', 'account', 'paidAt', 'remark', 'idempotencyKey',
] as const;
const CONFIRM_BODY_KEYS = ['idempotencyKey'] as const;
// SPEC-011 Task 10（FIN-03 冲销侧）：voidPayment 白名单（brief 逐字）。
const VOID_BODY_KEYS = ['reason', 'idempotencyKey'] as const;

export default class PaymentController extends Controller {
  /** POST /api/v1/payments（payment.create）：收款登记（仅 SIGNED/EFFECTIVE 合同），PENDING。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_BODY_KEYS);
    this.respond(await receivableService(this.ctx).createPayment(body as unknown as CreatePaymentInput));
  }

  /** GET /api/v1/payments（payment.read）：范围列表（经合同包裹）+ status/contractId/customerId 过滤。 */
  async index() {
    this.respond(await receivableService(this.ctx).listPayments(parsePaymentListQuery(this.ctx.query)));
  }

  /** GET /api/v1/payments/:id（payment.read）：详情，不存在/越权统一 404。 */
  async show() {
    this.respond(await receivableService(this.ctx).getPayment(this.ctx.params.id));
  }

  /** POST /api/v1/payments/:id/confirm（payment.confirm）：PENDING→CONFIRMED + 冲抵 + 合同累计。 */
  async confirm() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CONFIRM_BODY_KEYS);
    this.respond(await receivableService(this.ctx).confirmPayment(
      this.ctx.params.id,
      body as unknown as ConfirmPaymentInput,
    ));
  }

  /** POST /api/v1/payments/:id/void（payment.void，SPEC-011 Task 10）：CONFIRMED→VOIDED + 资金回补。 */
  async void() {
    const body = this.ctx.request.body;
    assertExactKeys(body, VOID_BODY_KEYS);
    this.respond(await receivableService(this.ctx).voidPayment(
      this.ctx.params.id,
      body as unknown as VoidPaymentInput,
    ));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parsePaymentListQuery(input: unknown): ListPaymentsQuery {
  assertExactKeys(input, ['page', 'pageSize', 'status', 'contractId', 'customerId', 'caseNo']);
  const query: ListPaymentsQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  if (input.status !== undefined) query.status = input.status as PaymentStatus;
  if (input.contractId !== undefined) query.contractId = input.contractId as string;
  if (input.customerId !== undefined) query.customerId = input.customerId as string;
  if (input.caseNo !== undefined) query.caseNo = input.caseNo as string;
  return query;
}

/** query 数字解析：非法形态 400（与 lead/customer 控制器同一纪律）。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}
