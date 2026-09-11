// SPEC-011 Task 11: 成本 API 客户端，逐条对齐 Task 10 冻结路由表（FIN-04）。
// 纪律：仅经 src/api/request 封装（SPEC-006 鉴权/CSRF 拦截器），禁止裸 fetch；
// 包络 { code, message, data }；金额以 toFixed(2) 字符串投影，前端原样渲染不转 number；
// 编辑走 PATCH { amount, occurredAt, note, version }（乐观锁），删除沿 case 先例 destroy。
import request from './request';
import type { ApiResponse } from '@/types';
import type { PagedResult } from './types';

export const COST_CATEGORIES = ['CHANNEL', 'EVIDENCE', 'CASE_HANDLING', 'LABOR', 'OFFICE', 'REIMBURSEMENT'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

/** 镜像 apps/server app/application/finance/finance-projection.ts CostEntryView（日期传输层为 ISO 串；deletedAt 不入视图）。 */
export interface CostView {
  sourceApprovalId?: string | null;
  id: string;
  category: CostCategory;
  amount: string;
  occurredAt: string;
  note: string | null;
  channelId: string | null;
  caseId: string | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 finance-types.ts CreateCostEntryInput；category 驱动锚点（CHANNEL→channelId、EVIDENCE/CASE_HANDLING→caseId）。 */
export interface CreateCostInput {
  category: CostCategory;
  amount: string | number;
  occurredAt: string;
  note?: string;
  channelId?: string;
  caseId?: string;
}

/** 镜像 finance-types.ts UpdateCostEntryInput；version 乐观锁必填。 */
export interface UpdateCostInput {
  amount?: string | number;
  occurredAt?: string;
  note?: string;
  version: number;
}

/** 镜像 finance-types.ts ListCostEntriesQuery。 */
export interface ListCostsQuery {
  page?: number;
  pageSize?: number;
  category?: CostCategory;
  channelId?: string;
  caseId?: string;
}

export const costApi = {
  /** POST /api/v1/costs（cost.create）。 */
  create: (data: CreateCostInput) =>
    request.post<ApiResponse<CostView>>('/v1/costs', data),
  /** GET /api/v1/costs */
  list: (params?: ListCostsQuery) =>
    request.get<ApiResponse<PagedResult<CostView>>>('/v1/costs', { params }),
  /** GET /api/v1/costs/:id */
  detail: (id: string) =>
    request.get<ApiResponse<CostView>>(`/v1/costs/${id}`),
  /** PATCH /api/v1/costs/:id（cost.update）：乐观锁 { amount, occurredAt, note, version }。 */
  update: (id: string, data: UpdateCostInput) =>
    request.patch<ApiResponse<CostView>>(`/v1/costs/${id}`, data),
  /** DELETE /api/v1/costs/:id（cost.delete）：软删，data 为 null。 */
  remove: (id: string) =>
    request.delete<ApiResponse<null>>(`/v1/costs/${id}`),
};
