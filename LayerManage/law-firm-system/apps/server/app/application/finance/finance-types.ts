// SPEC-011 Task 5: finance 模块 DTO（PagedResult 复用 lead-types 同构形态，不重定义）。
import type { InvoiceStatus, RefundRequestStatus, RefundRequestType, CostCategory } from '../../domain/finance/finance-types';

export type { PagedResult } from '../crm/lead-types';

export interface CreateInvoiceInput {
  caseNo?: string;
  contractId: string;
  amount: string | number;
  reason?: string;
  idempotencyKey?: string;
}

export interface InvoiceActionInput {
  comment?: string;
  idempotencyKey?: string;
}

export interface CompleteInvoiceInput {
  invoiceNo?: string;
  idempotencyKey?: string;
}

export interface ListInvoicesQuery {
  caseNo?: string;
  page?: number;
  pageSize?: number;
  status?: InvoiceStatus;
  contractId?: string;
  customerId?: string;
}

export interface CreateRefundRequestInput {
  caseNo?: string;
  type: RefundRequestType;
  contractId: string;
  paymentId?: string;
  planId?: string;
  amount: string | number;
  reason: string;
  idempotencyKey?: string;
}

export interface RefundActionInput {
  comment?: string;
  /** Task 7 Step-Up（refund.approve）：客户端所见 RefundRequest 版本，approve 前置校验绑定 Step-Up 目标。 */
  expectedVersion?: number;
  idempotencyKey?: string;
}

export interface ListRefundRequestsQuery {
  caseNo?: string;
  page?: number;
  pageSize?: number;
  status?: RefundRequestStatus;
  type?: RefundRequestType;
  contractId?: string;
  customerId?: string;
}

export interface CreateCostEntryInput {
  category: CostCategory;
  amount: string | number;
  occurredAt: string;
  note?: string;
  channelId?: string;
  caseId?: string;
}

export interface UpdateCostEntryInput {
  amount?: string | number;
  occurredAt?: string;
  note?: string;
  version: number;
}

export interface ListCostEntriesQuery {
  page?: number;
  pageSize?: number;
  category?: CostCategory;
  channelId?: string;
  caseId?: string;
}

export interface AnomalyListQuery {
  page?: number;
  pageSize?: number;
}
