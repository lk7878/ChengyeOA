import type { ChannelStatistics } from '@/types';
import request from './request';
export { masterDataApi } from '@/features/master-data/api';
import type {
  ApiResponse,
  PaginatedData,
  Employee,
  Organization,
  Position,
  Channel,
  Notification,
  Performance,
  PerformanceBusinessMetrics,
} from '@/types';
import type { PagedResult } from './types';

type QueryParams = Record<string, unknown>;

export const employeeApi = {
  list: (params?: QueryParams) =>
    request.get<ApiResponse<PaginatedData<Employee>>>('/v1/employees', { params }),
  detail: (id: string) => request.get<ApiResponse<Employee>>(`/v1/employees/${id}`),
  create: (data: Partial<Employee>) => request.post<ApiResponse<Employee>>('/v1/employees', data),
  update: (id: string, data: Partial<Employee>) =>
    request.put<ApiResponse<Employee>>(`/v1/employees/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/employees/${id}`),
  formalize: (id: string) => request.post<ApiResponse<Employee>>(`/v1/employees/${id}/formalize`),
  leave: (id: string, leaveDate: string) =>
    request.post<ApiResponse<Employee>>(`/v1/employees/${id}/leave`, { leaveDate }),
};

export const organizationApi = {
  list: () => request.get<ApiResponse<Organization[]>>('/v1/organizations'),
  tree: () => request.get<ApiResponse<Organization[]>>('/v1/organizations/options'),
  detail: (id: string) => request.get<ApiResponse<Organization>>(`/v1/organizations/${id}`),
  create: (data: Partial<Organization>) => request.post<ApiResponse<Organization>>('/v1/organizations', data),
  update: (id: string, data: Partial<Organization>) =>
    request.put<ApiResponse<Organization>>(`/v1/organizations/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/organizations/${id}`),
};

export const positionApi = {
  list: () => request.get<ApiResponse<Position[]>>('/v1/positions'),
  detail: (id: string) => request.get<ApiResponse<Position>>(`/v1/positions/${id}`),
  create: (data: Partial<Position>) => request.post<ApiResponse<Position>>('/v1/positions', data),
  update: (id: string, data: Partial<Position>) =>
    request.put<ApiResponse<Position>>(`/v1/positions/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/positions/${id}`),
};

export const channelApi = {
  list: (params?: { page?: number; pageSize?: number; keyword?: string; branchId?: string }) =>
    request.get<ApiResponse<PaginatedData<Channel>>>('/v1/channels', { params }),
  detail: (id: string) => request.get<ApiResponse<Channel>>(`/v1/channels/${id}`),
  create: (data: Partial<Channel> & { idempotencyKey?: string }) =>
    request.post<ApiResponse<Channel>>('/v1/channels', data),
  update: (id: string, data: Partial<Channel>) =>
    request.put<ApiResponse<Channel>>(`/v1/channels/${id}`, data),
  delete: (id: string, version?: number) =>
    request.delete<ApiResponse<null>>(`/v1/channels/${id}`, { data: { version } }),
  statistics: (id: string) => request.get<ApiResponse<ChannelStatistics>>(`/v1/channels/${id}/statistics`),
};

export const notificationApi = {
  list: (params?: QueryParams) =>
    request.get<ApiResponse<PaginatedData<Notification>>>('/v1/notifications', { params }),
  read: (id: string) => request.patch<ApiResponse<Notification>>(`/v1/notifications/${id}/read`),
  readAll: () => request.post<ApiResponse<null>>('/v1/notifications/read-all'),
  unreadCount: () => request.get<ApiResponse<{ count: number }>>('/v1/notifications/unread-count'),
};

export const performanceApi = {
  list: (params?: QueryParams) =>
    request.get<ApiResponse<PagedResult<Performance>>>('/v1/performances', { params }),
  detail: (id: string) => request.get<ApiResponse<Performance>>(`/v1/performances/${id}`),
  create: (data: Partial<Performance> & { idempotencyKey?: string }) =>
    request.post<ApiResponse<Performance>>('/v1/performances', data),
  confirm: (id: string, data: { version?: number } = {}) =>
    request.post<ApiResponse<Performance>>(`/v1/performances/${id}/confirm`, data),
  // SPEC-043：绩效考核流程——目标设定/自评（performance.update）、主管评（performance.confirm）。
  setGoal: (id: string, data: { goal: string; version?: number }) =>
    request.post<ApiResponse<Performance>>(`/v1/performances/${id}/set-goal`, data),
  selfReview: (id: string, data: { selfScore: number; selfComment?: string; version?: number }) =>
    request.post<ApiResponse<Performance>>(`/v1/performances/${id}/self-review`, data),
  managerReview: (id: string, data: { managerScore: number; managerComment?: string; version?: number }) =>
    request.post<ApiResponse<Performance>>(`/v1/performances/${id}/manager-review`, data),
  // SPEC-044：绩效业务指标（该员工考核周期案件办结数/回款额）。
  metrics: (id: string) =>
    request.get<ApiResponse<PerformanceBusinessMetrics>>(`/v1/performances/${id}/metrics`),
};

export default { employeeApi, organizationApi, positionApi, channelApi, notificationApi, performanceApi };
