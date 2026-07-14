import request from './request';
import type { ApiResponse, PaginatedData, Lead, LeadFollow, Customer, Contract, Payment, Case, CaseTask, Communication, DashboardMetrics, DashboardAlerts } from '@/types';

type QueryParams = Record<string, unknown>;

export const leadApi = {
  list: (params?: QueryParams) => request.get<ApiResponse<PaginatedData<Lead>>>('/v1/leads', { params }),
  detail: (id: string) => request.get<ApiResponse<Lead>>(`/v1/leads/${id}`),
  create: (data: Partial<Lead>) => request.post<ApiResponse<Lead>>('/v1/leads', data),
  update: (id: string, data: Partial<Lead>) => request.put<ApiResponse<Lead>>(`/v1/leads/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/leads/${id}`),
  assign: (id: string, employeeId: string) => request.post<ApiResponse<Lead>>(`/v1/leads/${id}/assign`, { employeeId }),
  follow: (id: string, data: Partial<LeadFollow>) => request.post<ApiResponse<LeadFollow>>(`/v1/leads/${id}/follow`, data),
  convert: (id: string) => request.post<ApiResponse<{ customer: Customer }>>(`/v1/leads/${id}/convert`),
  follows: (id: string) => request.get<ApiResponse<LeadFollow[]>>(`/v1/leads/${id}/follows`),
  recycle: (id: string) => request.post<ApiResponse<Lead>>(`/v1/leads/${id}/recycle`),
};

export const customerApi = {
  list: (params?: QueryParams) => request.get<ApiResponse<PaginatedData<Customer>>>('/v1/customers', { params }),
  detail: (id: string) => request.get<ApiResponse<Customer>>(`/v1/customers/${id}`),
  create: (data: Partial<Customer>) => request.post<ApiResponse<Customer>>('/v1/customers', data),
  update: (id: string, data: Partial<Customer>) => request.put<ApiResponse<Customer>>(`/v1/customers/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/customers/${id}`),
  contracts: (id: string) => request.get<ApiResponse<Contract[]>>(`/v1/customers/${id}/contracts`),
  cases: (id: string) => request.get<ApiResponse<Case[]>>(`/v1/customers/${id}/cases`),
  payments: (id: string) => request.get<ApiResponse<Payment[]>>(`/v1/customers/${id}/payments`),
};

export const contractApi = {
  list: (params?: QueryParams) => request.get<ApiResponse<PaginatedData<Contract>>>('/v1/contracts', { params }),
  detail: (id: string) => request.get<ApiResponse<Contract>>(`/v1/contracts/${id}`),
  create: (data: Partial<Contract>) => request.post<ApiResponse<Contract>>('/v1/contracts', data),
  update: (id: string, data: Partial<Contract>) => request.put<ApiResponse<Contract>>(`/v1/contracts/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/contracts/${id}`),
  submit: (id: string) => request.post<ApiResponse<Contract>>(`/v1/contracts/${id}/submit`),
  approve: (id: string) => request.post<ApiResponse<Contract>>(`/v1/contracts/${id}/approve`),
  sign: (id: string, signDate: string) => request.post<ApiResponse<Contract>>(`/v1/contracts/${id}/sign`, { signDate }),
  terminate: (id: string, reason: string) => request.post<ApiResponse<Contract>>(`/v1/contracts/${id}/terminate`, { reason }),
  ledger: () => request.get<ApiResponse<unknown>>('/v1/contracts/ledger'),
};

export const paymentApi = {
  list: (params?: QueryParams) => request.get<ApiResponse<PaginatedData<Payment>>>('/v1/payments', { params }),
  detail: (id: string) => request.get<ApiResponse<Payment>>(`/v1/payments/${id}`),
  create: (data: Partial<Payment>) => request.post<ApiResponse<Payment>>('/v1/payments', data),
  update: (id: string, data: Partial<Payment>) => request.put<ApiResponse<Payment>>(`/v1/payments/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/payments/${id}`),
  confirm: (id: string, data: { receivedAmount: number; receivedDate: string; paymentMethod?: string }) =>
    request.post<ApiResponse<Payment>>(`/v1/payments/${id}/confirm`, data),
  refund: (id: string, data: { refundAmount: number; reason: string }) =>
    request.post<ApiResponse<Payment>>(`/v1/payments/${id}/refund`, data),
};

export const caseApi = {
  list: (params?: QueryParams) => request.get<ApiResponse<PaginatedData<Case>>>('/v1/cases', { params }),
  detail: (id: string) => request.get<ApiResponse<Case>>(`/v1/cases/${id}`),
  create: (data: Partial<Case>) => request.post<ApiResponse<Case>>('/v1/cases', data),
  update: (id: string, data: Partial<Case>) => request.put<ApiResponse<Case>>(`/v1/cases/${id}`, data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/v1/cases/${id}`),
  createTask: (id: string, data: Partial<CaseTask>) => request.post<ApiResponse<CaseTask>>(`/v1/cases/${id}/tasks`, data),
  updateTask: (id: string, taskId: string, data: Partial<CaseTask>) => request.patch<ApiResponse<CaseTask>>(`/v1/cases/${id}/tasks/${taskId}`, data),
  createCommunication: (id: string, data: Partial<Communication>) => request.post<ApiResponse<Communication>>(`/v1/cases/${id}/communications`, data),
  close: (id: string, data: { result?: string; satisfaction?: number; isReferrable?: boolean }) =>
    request.post<ApiResponse<Case>>(`/v1/cases/${id}/close`, data),
};

export const dashboardApi = {
  metrics: () => request.get<ApiResponse<DashboardMetrics>>('/v1/dashboard/metrics'),
  funnel: () => request.get<ApiResponse<unknown>>('/v1/dashboard/funnel'),
  teamMetrics: () => request.get<ApiResponse<unknown>>('/v1/dashboard/team-metrics'),
  financeMetrics: () => request.get<ApiResponse<unknown>>('/v1/dashboard/finance-metrics'),
  caseMetrics: () => request.get<ApiResponse<unknown>>('/v1/dashboard/case-metrics'),
  alerts: () => request.get<ApiResponse<DashboardAlerts>>('/v1/dashboard/alerts'),
};

export default { leadApi, customerApi, contractApi, paymentApi, caseApi, dashboardApi };
