// SPEC-011 Task 10: invoice HTTP 控制器（开票申请全生命周期）。
// 薄控制器纪律（逐字仿 SPEC-010 T10 payment.ts）：传输层解析 → 调 Task 5 冻结服务 →
// 包络响应；白名单 assertExactKeys、query 数字解析 parseQueryInteger、respond 包络
// { code:200, message:'success', data } 全同母版。业务校验/权限/范围/幂等全在服务层。

import { Controller } from 'egg';

import { invoiceService } from '../application/finance/finance-factory';
import {
  CompleteInvoiceInput,
  CreateInvoiceInput,
  InvoiceActionInput,
  ListInvoicesQuery,
} from '../application/finance/finance-types';
import { InvoiceStatus } from '../domain/finance/finance-types';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const CREATE_BODY_KEYS = ['contractId', 'caseNo', 'amount', 'reason', 'idempotencyKey'] as const;
const ACTION_BODY_KEYS = ['comment', 'idempotencyKey'] as const;
const COMPLETE_BODY_KEYS = ['invoiceNo', 'idempotencyKey'] as const;

export default class InvoiceController extends Controller {
  /** POST /api/v1/invoices（invoice.create）：开票申请，PENDING。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_BODY_KEYS);
    this.respond(await invoiceService(this.ctx).createInvoice(body as unknown as CreateInvoiceInput));
  }

  /** GET /api/v1/invoices（invoice.read）：范围列表 + status/contractId/customerId 过滤。 */
  async index() {
    this.respond(await invoiceService(this.ctx).listInvoices(parseInvoiceListQuery(this.ctx.query)));
  }

  /** GET /api/v1/invoices/:id（invoice.read）：详情，不存在/越权统一 404。 */
  async show() {
    this.respond(await invoiceService(this.ctx).getInvoice(this.ctx.params.id));
  }

  /** POST /api/v1/invoices/:id/approve（invoice.approve）：PENDING→APPROVED。 */
  async approve() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ACTION_BODY_KEYS);
    this.respond(await invoiceService(this.ctx).approveInvoice(
      this.ctx.params.id,
      body as unknown as InvoiceActionInput,
    ));
  }

  /** POST /api/v1/invoices/:id/reject（invoice.approve 权限码，router.ts:183 先例）：PENDING→REJECTED。 */
  async reject() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ACTION_BODY_KEYS);
    this.respond(await invoiceService(this.ctx).rejectInvoice(
      this.ctx.params.id,
      body as unknown as InvoiceActionInput,
    ));
  }

  /** POST /api/v1/invoices/:id/complete（invoice.complete）：APPROVED→COMPLETED。 */
  async complete() {
    const body = this.ctx.request.body;
    assertExactKeys(body, COMPLETE_BODY_KEYS);
    this.respond(await invoiceService(this.ctx).completeInvoice(
      this.ctx.params.id,
      body as unknown as CompleteInvoiceInput,
    ));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseInvoiceListQuery(input: unknown): ListInvoicesQuery {
  assertExactKeys(input, ['page', 'pageSize', 'status', 'contractId', 'customerId', 'caseNo']);
  const query: ListInvoicesQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  if (input.status !== undefined) query.status = input.status as InvoiceStatus;
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
