// SPEC-011 Task 11: 退款/减免 API 客户端，逐条对齐 Task 10 冻结路由表（FIN-03）。
// 纪律：仅经 src/api/request 封装（SPEC-006 鉴权/CSRF 拦截器），禁止裸 fetch；
// 包络 { code, message, data }；金额以 toFixed(2) 字符串投影，前端原样渲染不转 number；
// reject 挂 refund.approve 权限码（catalog 无独立 reject 码，router.ts:183 先例）。
// refund.approve 为 SPECIAL/CRITICAL 预存码——按钮语义沿既有 HIGH/CRITICAL 敏感操作形态。
import request from './request';
import type { ApiResponse } from '@/types';
import type { PagedResult } from './types';

export const REFUND_TYPES = ['REFUND', 'WAIVER'] as const;
export type RefundType = (typeof REFUND_TYPES)[number];

export const REFUND_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** 镜像 apps/server app/application/finance/finance-projection.ts RefundRequestView（日期传输层为 ISO 串）。 */
export interface RefundView {
  sourceRecordId?: string | null;
  actualAmount?: string | null;
  paidAt?: string | null;
  voucherFiles?: string[];
  recipientName?: string | null;
  recipientBank?: string | null;
  recipientAccount?: string | null;
  linkedCase?: { id: string; caseNo: string; title: string } | null;
  id: string;
  requestNo: string;
  type: RefundType;
  contractId: string;
  customerId: string;
  paymentId: string | null;
  planId: string | null;
  amount: string;
  reason: string;
  status: RefundStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalComment: string | null;
  executedBy: string | null;
  executedAt: string | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 finance-types.ts CreateRefundRequestInput；type 分流：REFUND 锚 paymentId、WAIVER 锚 planId（交叉锚点禁填）。 */
export interface CreateRefundInput {
  caseNo?: string;
  type: RefundType;
  contractId: string;
  paymentId?: string;
  planId?: string;
  amount: string | number;
  reason: string;
  idempotencyKey?: string;
}

/** 镜像 finance-types.ts RefundActionInput（approve/reject/execute 共享；comment 可选；
 *  expectedVersion 为 approve Step-Up 前置校验专用——客户端所见列表行 version）。 */
export interface RefundActionInput {
  comment?: string;
  expectedVersion?: number;
  idempotencyKey?: string;
}

/** 镜像 finance-types.ts ListRefundRequestsQuery。 */
export interface ListRefundsQuery {
  caseNo?: string;
  page?: number;
  pageSize?: number;
  status?: RefundStatus;
  type?: RefundType;
  contractId?: string;
  customerId?: string;
}

export const refundApi = {
  /** POST /api/v1/refunds（refund.create）：退款/减免申请，PENDING。 */
  create: (data: CreateRefundInput) =>
    request.post<ApiResponse<RefundView>>('/v1/refunds', data),
  /** GET /api/v1/refunds */
  list: (params?: ListRefundsQuery) =>
    request.get<ApiResponse<PagedResult<RefundView>>>('/v1/refunds', { params }),
  /** GET /api/v1/refunds/:id */
  detail: (id: string) =>
    request.get<ApiResponse<RefundView>>(`/v1/refunds/${id}`),
  /** POST /api/v1/refunds/:id/approve（refund.approve，SPECIAL/CRITICAL + Step-Up）：
   *  PENDING→APPROVED；Task 7 起须携带 REFUND_APPROVE 一次性 grant（x-step-up-token 头）。 */
  approve: (id: string, data: RefundActionInput = {}, stepUpToken?: string) =>
    request.post<ApiResponse<RefundView>>(
      `/v1/refunds/${id}/approve`,
      data,
      stepUpToken ? { headers: { 'X-Step-Up-Token': stepUpToken } } : undefined,
    ),
  /** POST /api/v1/refunds/:id/reject（refund.approve）：PENDING→REJECTED，comment 必填。 */
  reject: (id: string, data: RefundActionInput) =>
    request.post<ApiResponse<RefundView>>(`/v1/refunds/${id}/reject`, data),
  /** POST /api/v1/refunds/:id/execute（refund.execute）：APPROVED→EXECUTED + 资金回补/计划冲抵。 */
  execute: (id: string, data: RefundActionInput = {}) =>
    request.post<ApiResponse<RefundView>>(`/v1/refunds/${id}/execute`, data),
};
