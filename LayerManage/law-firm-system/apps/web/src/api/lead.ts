// SPEC-009 Task 11: 线索 API 客户端，逐条对齐 Task 10 冻结路由表。
// 纪律：仅经 src/api/request 封装（SPEC-006 鉴权/CSRF/Step-Up 拦截器），禁止裸 fetch；
// PATCH 非 PUT、follows 复数、无 DELETE /leads/:id；包络 { code, message, data }。
import request from './request';
import type { ApiResponse } from '@/types';
import type {
  AppointmentView,
  AssignLeadInput,
  ConvertLeadInput,
  CreateLeadInput,
  CreateLeadResult,
  CustomerView,
  LeadFollowView,
  LeadListQuery,
  LeadView,
  PagedResult,
  RecordFollowInput,
  TransitionLeadInput,
} from './types';

function idempotencyHeaders(key: string | undefined) {
  return key ? { headers: { 'Idempotency-Key': key } } : undefined;
}

export const leadApi = {
  /** POST /api/v1/leads（可携带 Idempotency-Key 头）。 */
  create: (data: CreateLeadInput, idempotencyKey?: string) =>
    request.post<ApiResponse<CreateLeadResult>>('/v1/leads', data, idempotencyHeaders(idempotencyKey)),
  /** GET /api/v1/leads */
  list: (params?: LeadListQuery) =>
    request.get<ApiResponse<PagedResult<LeadView>>>('/v1/leads', { params }),
  /** GET /api/v1/leads/pool（poolStatus 缺省 PUBLIC，?poolStatus=RECYCLED 为回收池）。 */
  pool: (params?: LeadListQuery) =>
    request.get<ApiResponse<PagedResult<LeadView>>>('/v1/leads/pool', { params }),
  /** GET /api/v1/leads/:id */
  detail: (id: string) =>
    request.get<ApiResponse<LeadView>>(`/v1/leads/${id}`),
  /** PATCH /api/v1/leads/:id（仅状态流转 { targetStatus, reason }）。 */
  transition: (id: string, data: TransitionLeadInput) =>
    request.patch<ApiResponse<LeadView>>(`/v1/leads/${id}`, data),
  /** POST /api/v1/leads/:id/assign */
  assign: (id: string, data: AssignLeadInput) =>
    request.post<ApiResponse<LeadView>>(`/v1/leads/${id}/assign`, data),
  /** POST /api/v1/leads/:id/recycle */
  recycle: (id: string, data: { reason?: string } = {}) =>
    request.post<ApiResponse<LeadView>>(`/v1/leads/${id}/recycle`, data),
  /** POST /api/v1/leads/:id/convert（body { customer, contact }，可携带 Idempotency-Key）。 */
  convert: (id: string, data: ConvertLeadInput, idempotencyKey?: string) =>
    request.post<ApiResponse<CustomerView>>(`/v1/leads/${id}/convert`, data, idempotencyHeaders(idempotencyKey)),
  /** POST /api/v1/leads/:id/follows（复数）。 */
  addFollow: (id: string, data: RecordFollowInput) =>
    request.post<ApiResponse<LeadFollowView>>(`/v1/leads/${id}/follows`, data),
  /** GET /api/v1/leads/:id/follows */
  follows: (id: string) =>
    request.get<ApiResponse<LeadFollowView[]>>(`/v1/leads/${id}/follows`),
  /** POST /api/v1/leads/pool/claim */
  claim: (leadId: string) =>
    request.post<ApiResponse<LeadView>>('/v1/leads/pool/claim', { leadId }),
  /** GET /api/v1/leads/:id/appointments */
  appointments: (id: string) =>
    request.get<ApiResponse<AppointmentView[]>>(`/v1/leads/${id}/appointments`),
};
