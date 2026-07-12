import request from './request';
import type { ApiResponse, PaginatedData, Employee, Organization, Position, Channel, Approval, Notification, Performance } from '@/types';

export const employeeApi = {
  list: (params?: any) => request.get<ApiResponse<PaginatedData<Employee>>>('/v1/employees', { params }),
  detail: (id: string) => request.get<ApiResponse<Employee>>(`/v1/employees/${id}`),
  create: (data: Partial<Employee>) => request.post<ApiResponse<Employee>>('/v1/employees', data),
  update: (id: string, data: Partial<Employee>) => request.put<ApiResponse<Employee>>(`/v1/employees/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/employees/${id}`),
  formalize: (id: string) => request.post<ApiResponse<Employee>>(`/v1/employees/${id}/formalize`),
  leave: (id: string, leaveDate: string) => request.post<ApiResponse<Employee>>(`/v1/employees/${id}/leave`, { leaveDate }),
};

export const organizationApi = {
  list: () => request.get<ApiResponse<Organization[]>>('/v1/organizations'),
  tree: () => request.get<ApiResponse<Organization[]>>('/v1/organizations/tree'),
  detail: (id: string) => request.get<ApiResponse<Organization>>(`/v1/organizations/${id}`),
  create: (data: Partial<Organization>) => request.post<ApiResponse<Organization>>('/v1/organizations', data),
  update: (id: string, data: Partial<Organization>) => request.put<ApiResponse<Organization>>(`/v1/organizations/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/organizations/${id}`),
};

export const positionApi = {
  list: () => request.get<ApiResponse<Position[]>>('/v1/positions'),
  detail: (id: string) => request.get<ApiResponse<Position>>(`/v1/positions/${id}`),
  create: (data: Partial<Position>) => request.post<ApiResponse<Position>>('/v1/positions', data),
  update: (id: string, data: Partial<Position>) => request.put<ApiResponse<Position>>(`/v1/positions/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/positions/${id}`),
};

export const channelApi = {
  list: () => request.get<ApiResponse<Channel[]>>('/v1/channels'),
  detail: (id: string) => request.get<ApiResponse<Channel>>(`/v1/channels/${id}`),
  create: (data: Partial<Channel>) => request.post<ApiResponse<Channel>>('/v1/channels', data),
  update: (id: string, data: Partial<Channel>) => request.put<ApiResponse<Channel>>(`/v1/channels/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/channels/${id}`),
  statistics: (id: string) => request.get<ApiResponse<any>>(`/v1/channels/${id}/statistics`),
};

export const approvalApi = {
  list: (params?: any) => request.get<ApiResponse<PaginatedData<Approval>>>('/v1/approvals', { params }),
  detail: (id: string) => request.get<ApiResponse<Approval>>(`/v1/approvals/${id}`),
  create: (data: Partial<Approval>) => request.post<ApiResponse<Approval>>('/v1/approvals', data),
  process: (id: string, data: { status: string; remark?: string }) => request.post<ApiResponse<Approval>>(`/v1/approvals/${id}/process`, data),
};

export const notificationApi = {
  list: (params?: any) => request.get<ApiResponse<PaginatedData<Notification>>>('/v1/notifications', { params }),
  read: (id: string) => request.patch<ApiResponse<Notification>>(`/v1/notifications/${id}/read`),
  readAll: () => request.post<ApiResponse<null>>('/v1/notifications/read-all'),
  unreadCount: () => request.get<ApiResponse<number>>('/v1/notifications/unread-count'),
};

export const performanceApi = {
  list: (params?: any) => request.get<ApiResponse<PaginatedData<Performance>>>('/v1/performances', { params }),
  detail: (id: string) => request.get<ApiResponse<Performance>>(`/v1/performances/${id}`),
  create: (data: Partial<Performance>) => request.post<ApiResponse<Performance>>('/v1/performances', data),
  confirm: (id: string) => request.post<ApiResponse<Performance>>(`/v1/performances/${id}/confirm`),
};

export default { employeeApi, organizationApi, positionApi, channelApi, approvalApi, notificationApi, performanceApi };
