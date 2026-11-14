// SPEC-010 Task 11: 谈案 API 客户端，逐条对齐 Task 10 冻结路由表（CRM-07）。
// 纪律：仅经 src/api/request 封装（SPEC-006 鉴权/CSRF 拦截器），禁止裸 fetch；
// 包络 { code, message, data }；quotedAmount 以 toFixed(2) 字符串投影，原样渲染不转 number。
import request from './request';
import type { ApiResponse } from '@/types';
import type { PagedResult } from './types';

export const NEGOTIATION_STATUSES = ['NEGOTIATING', 'SIGNED', 'UNSIGNED'] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number];

/** 镜像 apps/server app/application/contract/contract-types.ts NegotiationView（日期传输层为 ISO 串）。 */
export interface NegotiationView {
  id: string;
  negotiationNo: string;
  customerId: string;
  leadId: string | null;
  appointmentId: string | null;
  negotiatorEmployeeId: string;
  quotedAmount: string | null;
  customerConcerns: string | null;
  competitorInfo: string | null;
  status: NegotiationStatus;
  unsignedReason: string | null;
  signedAt: string | null;
  remark: string | null;
  branchId: string | null;
  professionalTeamId: string | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 contract-types.ts CreateNegotiationInput。 */
export interface CreateNegotiationInput {
  customerId: string;
  leadId?: string;
  appointmentId?: string;
  negotiatorEmployeeId: string;
  quotedAmount?: string | number | null;
  customerConcerns?: string;
  competitorInfo?: string;
  remark?: string;
  /** 显式组织锚（显式输入 > leadId 继承 > null 公海语义）。 */
  branchId?: string;
  professionalTeamId?: string;
}

/** 镜像 contract-types.ts UpdateNegotiationInput（仅 NEGOTIATING 可改，仅更新提供字段）。 */
export interface UpdateNegotiationInput {
  negotiatorEmployeeId?: string;
  quotedAmount?: string | number | null;
  customerConcerns?: string;
  competitorInfo?: string;
  remark?: string;
}

/** 镜像 contract-types.ts CloseNegotiationInput（UNSIGNED 时 unsignedReason 必填）。 */
export interface CloseNegotiationInput {
  outcome: 'SIGNED' | 'UNSIGNED';
  unsignedReason?: string;
}

/** 镜像 contract-types.ts NegotiationListQuery。 */
export interface NegotiationListQuery {
  page?: number;
  pageSize?: number;
  status?: NegotiationStatus;
  customerId?: string;
}

export const negotiationApi = {
  /** POST /api/v1/negotiations（negotiation.create）：创建谈案。 */
  create: (data: CreateNegotiationInput) =>
    request.post<ApiResponse<NegotiationView>>('/v1/negotiations', data),
  /** GET /api/v1/negotiations */
  list: (params?: NegotiationListQuery) =>
    request.get<ApiResponse<PagedResult<NegotiationView>>>('/v1/negotiations', { params }),
  /** GET /api/v1/negotiations/:id */
  detail: (id: string) =>
    request.get<ApiResponse<NegotiationView>>(`/v1/negotiations/${id}`),
  /** PATCH /api/v1/negotiations/:id（negotiation.update）：仅 NEGOTIATING 可改。 */
  update: (id: string, data: UpdateNegotiationInput) =>
    request.patch<ApiResponse<NegotiationView>>(`/v1/negotiations/${id}`, data),
  /** POST /api/v1/negotiations/:id/close（negotiation.update）：完结（SIGNED/UNSIGNED）。 */
  close: (id: string, data: CloseNegotiationInput) =>
    request.post<ApiResponse<NegotiationView>>(`/v1/negotiations/${id}/close`, data),
};
