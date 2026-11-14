// SPEC-009 Task 11: 邀约 API 客户端，对齐 Task 10 路由表 + 2026-07-29 用户裁定的日历范围查询。
// 注意：reschedule 的 body 键为 scheduledAt（与 controller assertExactKeys 逐字一致）。
import request from './request';
import type { ApiResponse } from '@/types';
import type {
  AppointmentRangeQuery,
  AppointmentView,
  CreateAppointmentInput,
  PagedResult,
} from './types';

export const appointmentApi = {
  /** POST /api/v1/appointments */
  create: (data: CreateAppointmentInput) =>
    request.post<ApiResponse<AppointmentView>>('/v1/appointments', data),
  /** POST /api/v1/appointments/:id/visit（确认到访）。 */
  visit: (id: string) =>
    request.post<ApiResponse<AppointmentView>>(`/v1/appointments/${id}/visit`),
  /** POST /api/v1/appointments/:id/reschedule（body { scheduledAt: ISO }）。 */
  reschedule: (id: string, scheduledAt: string) =>
    request.post<ApiResponse<AppointmentView>>(`/v1/appointments/${id}/reschedule`, { scheduledAt }),
  /** GET /api/v1/appointments/:id */
  detail: (id: string) =>
    request.get<ApiResponse<AppointmentView>>(`/v1/appointments/${id}`),
  /** GET /api/v1/appointments?from&to[&page&pageSize]（双端含，跨度 ≤ 366 天）。 */
  range: (params: AppointmentRangeQuery) =>
    request.get<ApiResponse<PagedResult<AppointmentView>>>('/v1/appointments', { params }),
};
