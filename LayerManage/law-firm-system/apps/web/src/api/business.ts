// SPEC-010 Task 11 手术：contractApi/paymentApi 段已切除（原型路由随后端 Task 1 根除 404），
// 新客户端落 @/api/contract、@/api/payment（逐条对齐 Task 10 冻结路由表）。
// SPEC-033 Task 3：caseApi 对齐重建案件域——list 改 PagedResult（非原型嵌套 pagination）、
// 移除 delete（后端 destroy 已根除，案件业务不可删）、close 白名单 { result, satisfaction }。
// SPEC-042 Task 3：+案件文件方法（listFiles/uploadFile/downloadFile/removeFile）。
import request from './request';
import type { ApiResponse, Case, CaseFile, CaseFileDownload, CaseTask, Communication, DashboardMetrics, DashboardAlerts } from '@/types';
import type { PagedResult } from './types';

type QueryParams = Record<string, unknown>;

export const caseApi = {
  list: (params?: QueryParams) => request.get<ApiResponse<PagedResult<Case>>>('/v1/cases', { params }),
  detail: (id: string) => request.get<ApiResponse<Case>>(`/v1/cases/${id}`),
  create: (data: Partial<Case> & { attachments?: import('@/pages/Case/intake-contract').IntakeAttachment[] }) => request.post<ApiResponse<Case>>('/v1/cases', data),
  update: (id: string, data: Partial<Case>) => request.put<ApiResponse<Case>>(`/v1/cases/${id}`, data),
  createTask: (id: string, data: Partial<CaseTask>) => request.post<ApiResponse<CaseTask>>(`/v1/cases/${id}/tasks`, data),
  updateTask: (id: string, taskId: string, data: Partial<CaseTask>) => request.patch<ApiResponse<CaseTask>>(`/v1/cases/${id}/tasks/${taskId}`, data),
  createCommunication: (id: string, data: Partial<Communication>) => request.post<ApiResponse<Communication>>(`/v1/cases/${id}/communications`, data),
  close: (id: string, data: { result?: string; satisfaction?: number }) =>
    request.post<ApiResponse<Case>>(`/v1/cases/${id}/close`, data),
  listFiles: (id: string, params?: { page?: number; pageSize?: number }) =>
    request.get<ApiResponse<PagedResult<CaseFile>>>(`/v1/cases/${id}/files`, { params }),
  uploadFile: (id: string, data: { fileName: string; fileType: string; base64: string }) =>
    request.post<ApiResponse<CaseFile>>(`/v1/cases/${id}/files`, data),
  downloadFile: (fileId: string) =>
    request.get<ApiResponse<CaseFileDownload>>(`/v1/files/${fileId}/download`),
  removeFile: (fileId: string) =>
    request.delete<ApiResponse<CaseFile>>(`/v1/files/${fileId}`),
};

export const dashboardApi = {
  metrics: () => request.get<ApiResponse<DashboardMetrics>>('/v1/dashboard/metrics'),
  funnel: () => request.get<ApiResponse<unknown>>('/v1/dashboard/funnel'),
  teamMetrics: () => request.get<ApiResponse<unknown>>('/v1/dashboard/team-metrics'),
  financeMetrics: () => request.get<ApiResponse<unknown>>('/v1/dashboard/finance-metrics'),
  caseMetrics: () => request.get<ApiResponse<unknown>>('/v1/dashboard/case-metrics'),
  alerts: () => request.get<ApiResponse<DashboardAlerts>>('/v1/dashboard/alerts'),
};

export default { caseApi, dashboardApi };
