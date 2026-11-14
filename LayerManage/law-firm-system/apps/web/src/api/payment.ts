// SPEC-010 Task 11: 收款 API 客户端，逐条对齐 Task 10 冻结路由表（FIN-01）。
// 纪律：仅经 src/api/request 封装（SPEC-006 鉴权/CSRF 拦截器），禁止裸 fetch；
// 包络 { code, message, data }；金额以 toFixed(2) 字符串投影，前端原样渲染不转 number；
// 无 delete 端点（收款记录不得业务删除），退款归 SPEC-011 不在本客户端出现。
import request from './request';
import type { ApiResponse } from '@/types';
import type { PagedResult } from './types';

export const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'REFUNDED', 'VOIDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** PaymentPlan.status 存储词汇；OVERDUE 仅为查询推导位，永不落库。
 * CANCELLED 为 SPEC-012 终止联动取消词位（后端 WritablePlanStatus 镜像，PENDING/PARTIAL→CANCELLED）。 */
export const PAYMENT_PLAN_STATUSES = ['PENDING', 'PARTIAL', 'RECEIVED', 'OVERDUE', 'CANCELLED'] as const;
export type PaymentPlanStatus = (typeof PAYMENT_PLAN_STATUSES)[number];

/** 镜像 apps/server app/application/contract/payment-projection.ts PaymentView（日期传输层为 ISO 串）。 */
export interface PaymentView {
  linkedCase?: { id: string; caseNo: string; title: string } | null;
  id: string;
  paymentNo: string;
  contractId: string;
  paymentPlanId: string | null;
  customerId: string;
  amount: string;
  method: string | null;
  account: string | null;
  paidAt: string | null;
  status: PaymentStatus;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** SPEC-011 Task 7：冲销三字段（voidReason 自由文本落行不落审计）。 */
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  remark: string | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 payment-projection.ts PaymentPlanView。 */
export interface PaymentPlanView {
  id: string;
  planNo: string;
  contractId: string;
  period: number;
  dueDate: string;
  amount: string;
  receivedAmount: string;
  status: PaymentPlanStatus;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 contract-types.ts CreatePaymentInput；amount 必填正数 scale≤2。 */
export interface CreatePaymentInput {
  caseNo?: string;
  contractId: string;
  /** 指定冲抵期次；提供时须属该合同。 */
  paymentPlanId?: string;
  amount: string | number;
  method?: string;
  account?: string;
  /** ISO 日期/时间串（到账时间）。 */
  paidAt?: string;
  remark?: string;
  idempotencyKey?: string;
}

/** 镜像 contract-types.ts ConfirmPaymentInput（幂等键接口位，不持久化）。 */
export interface ConfirmPaymentInput {
  idempotencyKey?: string;
}

/** 镜像 contract-types.ts VoidPaymentInput（FIN-03 冲销侧）；reason 必填（缺/空/全空白/超 500 → 400）。 */
export interface VoidPaymentInput {
  reason: string;
  idempotencyKey?: string;
}

/** 镜像 contract-types.ts ListPaymentsQuery。 */
export interface ListPaymentsQuery {
  caseNo?: string;
  page?: number;
  pageSize?: number;
  status?: PaymentStatus;
  contractId?: string;
  customerId?: string;
}

export const paymentApi = {
  /** POST /api/v1/payments（payment.create）：收款登记（仅 SIGNED/EFFECTIVE 合同），PENDING。 */
  create: (data: CreatePaymentInput) =>
    request.post<ApiResponse<PaymentView>>('/v1/payments', data),
  /** GET /api/v1/payments */
  list: (params?: ListPaymentsQuery) =>
    request.get<ApiResponse<PagedResult<PaymentView>>>('/v1/payments', { params }),
  /** GET /api/v1/payments/:id */
  detail: (id: string) =>
    request.get<ApiResponse<PaymentView>>(`/v1/payments/${id}`),
  /** POST /api/v1/payments/:id/confirm（payment.confirm）：PENDING→CONFIRMED + 冲抵 + 合同累计。 */
  confirm: (id: string, data: ConfirmPaymentInput = {}) =>
    request.post<ApiResponse<PaymentView>>(`/v1/payments/${id}/confirm`, data),
  /** POST /api/v1/payments/:id/void（payment.void）：CONFIRMED→VOIDED + 资金回补，reason 必填。 */
  void: (id: string, data: VoidPaymentInput) =>
    request.post<ApiResponse<PaymentView>>(`/v1/payments/${id}/void`, data),
};
