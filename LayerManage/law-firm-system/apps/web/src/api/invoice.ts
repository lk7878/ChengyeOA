// SPEC-011 Task 11: 开票申请 API 客户端，逐条对齐 Task 10 冻结路由表（FIN-02）。
// 纪律：仅经 src/api/request 封装（SPEC-006 鉴权/CSRF 拦截器），禁止裸 fetch；
// 包络 { code, message, data }；金额以 toFixed(2) 字符串投影，前端原样渲染不转 number；
// reject 挂 invoice.approve 权限码（catalog 无独立 reject 码，router.ts:183 先例）。
import request from './request';
import type { ApiResponse } from '@/types';
import type { PagedResult } from './types';

export const INVOICE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** 镜像 apps/server app/application/finance/finance-projection.ts InvoiceRequestView（日期传输层为 ISO 串）。 */
export interface InvoiceView {
  linkedCase?: { id: string; caseNo: string; title: string } | null;
  id: string;
  requestNo: string;
  contractId: string;
  customerId: string;
  amount: string;
  reason: string | null;
  status: InvoiceStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalComment: string | null;
  invoiceNo: string | null;
  completedBy: string | null;
  completedAt: string | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 finance-types.ts CreateInvoiceInput；amount 必填正数 scale≤2。 */
export interface CreateInvoiceInput {
  caseNo?: string;
  contractId: string;
  amount: string | number;
  reason?: string;
  idempotencyKey?: string;
}

/** 镜像 finance-types.ts InvoiceActionInput（approve/reject 共享；comment 可选）。 */
export interface InvoiceActionInput {
  comment?: string;
  idempotencyKey?: string;
}

/** 镜像 finance-types.ts CompleteInvoiceInput；invoiceNo 可选（缺省服务端自动编号）。 */
export interface CompleteInvoiceInput {
  invoiceNo?: string;
  idempotencyKey?: string;
}

/** 镜像 finance-types.ts ListInvoicesQuery。 */
export interface ListInvoicesQuery {
  caseNo?: string;
  page?: number;
  pageSize?: number;
  status?: InvoiceStatus;
  contractId?: string;
  customerId?: string;
}

export const invoiceApi = {
  /** POST /api/v1/invoices（invoice.create）：开票申请（仅 SIGNED/EFFECTIVE 合同），PENDING。 */
  create: (data: CreateInvoiceInput) =>
    request.post<ApiResponse<InvoiceView>>('/v1/invoices', data),
  /** GET /api/v1/invoices */
  list: (params?: ListInvoicesQuery) =>
    request.get<ApiResponse<PagedResult<InvoiceView>>>('/v1/invoices', { params }),
  /** GET /api/v1/invoices/:id */
  detail: (id: string) =>
    request.get<ApiResponse<InvoiceView>>(`/v1/invoices/${id}`),
  /** POST /api/v1/invoices/:id/approve（invoice.approve）：PENDING→APPROVED。 */
  approve: (id: string, data: InvoiceActionInput = {}) =>
    request.post<ApiResponse<InvoiceView>>(`/v1/invoices/${id}/approve`, data),
  /** POST /api/v1/invoices/:id/reject（invoice.approve）：PENDING→REJECTED，comment 必填。 */
  reject: (id: string, data: InvoiceActionInput) =>
    request.post<ApiResponse<InvoiceView>>(`/v1/invoices/${id}/reject`, data),
  /** POST /api/v1/invoices/:id/complete（invoice.complete）：APPROVED→COMPLETED，录发票号。 */
  complete: (id: string, data: CompleteInvoiceInput) =>
    request.post<ApiResponse<InvoiceView>>(`/v1/invoices/${id}/complete`, data),
};
