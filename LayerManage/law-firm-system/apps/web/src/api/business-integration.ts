import request from './request';
import type { ApiResponse } from '@/types';
import type { ApprovalAttachment } from './approval-materials';
export interface PayrollBatch { id: string; title: string; period: string; version: number; attachmentId: string; attachment: ApprovalAttachment; instance: { id: string; status: string } | null }
export interface LedgerRow { id: string; title: string; businessType: string; definitionName: string; decidedAt: string; content: Record<string, unknown>; formSnapshot: { formSchema?: { fields?: Array<{ key: string; label: string }> } } | null; sync: { target: string; status: string; reason: string | null; targetId: string | null } | null }
export interface SyncRule { id: string; name: string; code: string; syncRule: { target: string } | null }
export const integrationApi = {
  bindCase: (id: string, data: { contractId: string; version: number }) => request.post(`/v1/cases/${id}/finance-contract`, data),
  payroll: (page = 1) => request.get<ApiResponse<{ list: PayrollBatch[]; total: number }>>('/v1/payroll-batches', { params: { page } }),
  savePayroll: (data: { title: string; period: string; attachmentId: string; version?: number }, id?: string) => id ? request.put<ApiResponse<PayrollBatch>>(`/v1/payroll-batches/${id}`, data) : request.post<ApiResponse<PayrollBatch>>('/v1/payroll-batches', data),
  ledger: (page = 1, target?: string) => request.get<ApiResponse<{ list: LedgerRow[]; total: number }>>('/v1/approval-ledger', { params: { page, target } }),
  retry: (id: string) => request.post('/v1/approval-ledger/' + id + '/retry', {}),
  rules: () => request.get<ApiResponse<SyncRule[]>>('/v1/approval-sync-rules'),
  setRule: (id: string, target: string) => request.put('/v1/approval-sync-rules/' + id, { target }),
};
