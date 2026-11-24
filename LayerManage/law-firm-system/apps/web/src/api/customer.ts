// SPEC-009 Task 11: 客户 API 客户端，逐条对齐 Task 10 冻结路由表 + C1 增量（用户裁决）。
// PATCH 非 PUT；SPEC-CUSTOMER-CRUD-20260914 增加版本校验删除；
// 原型跨模块子资源 /contracts /cases /payments 已移除，不再出现。
import request from './request';
import type { ApiResponse } from '@/types';
import type {
  ContactInput,
  ContactView,
  CreateCustomerInput,
  CreateReferralLeadInput,
  CustomerListQuery,
  CustomerView,
  LeadView,
  PagedResult,
  UpdateCustomerInput,
} from './types';

export const customerApi = {
  searchForCase: (data: { worksheetId?: string; keyword?: string }) =>
    request.post<ApiResponse<PagedResult<CustomerView>>>('/v1/cases/intake-customers/search', data),
  createForCase: (data: { worksheetId?: string; name: string; phone: string; address?: string; customerType?: 'INDIVIDUAL' | 'ENTERPRISE' }) =>
    request.post<ApiResponse<{ customer: CustomerView; reused: boolean }>>('/v1/cases/intake-customers', data),
  /** POST /api/v1/customers */
  create: (data: CreateCustomerInput) =>
    request.post<ApiResponse<CustomerView>>('/v1/customers', data),
  /** GET /api/v1/customers */
  list: (params?: CustomerListQuery) =>
    request.get<ApiResponse<PagedResult<CustomerView>>>('/v1/customers', { params }),
  /** GET /api/v1/customers/:id */
  detail: (id: string) =>
    request.get<ApiResponse<CustomerView>>(`/v1/customers/${id}`),
  /** PATCH /api/v1/customers/:id */
  update: (id: string, data: UpdateCustomerInput) =>
    request.patch<ApiResponse<CustomerView>>(`/v1/customers/${id}`, data),
  remove: (id: string, version: number) =>
    request.delete<ApiResponse<null>>(`/v1/customers/${id}`, { data: { version } }),
  /** GET /api/v1/customers/:id/contacts（C1 增量：customer.read，排除软删） */
  listContacts: (id: string) =>
    request.get<ApiResponse<ContactView[]>>(`/v1/customers/${id}/contacts`),
  /** POST /api/v1/customers/:id/contacts */
  addContact: (id: string, data: ContactInput) =>
    request.post<ApiResponse<ContactView>>(`/v1/customers/${id}/contacts`, data),
  /** PATCH /api/v1/customers/:id/contacts/:contactId */
  updateContact: (id: string, contactId: string, data: ContactInput) =>
    request.patch<ApiResponse<ContactView>>(`/v1/customers/${id}/contacts/${contactId}`, data),
  /** DELETE /api/v1/customers/:id/contacts/:contactId（软删，data 为 null）。 */
  removeContact: (id: string, contactId: string) =>
    request.delete<ApiResponse<null>>(`/v1/customers/${id}/contacts/${contactId}`),
  /** POST /api/v1/customers/:id/referrals（SPEC-039：登记转介绍线索，lead.create） */
  createReferral: (id: string, data: CreateReferralLeadInput) =>
    request.post<ApiResponse<LeadView>>(`/v1/customers/${id}/referrals`, data),
  /** GET /api/v1/customers/:id/referrals（SPEC-039：客户转介绍线索列表，lead.read） */
  listReferrals: (id: string, params?: { page?: number; pageSize?: number }) =>
    request.get<ApiResponse<PagedResult<LeadView>>>(`/v1/customers/${id}/referrals`, { params }),
};
