import axios from 'axios';
import request from '@/api/request';
import type { ApiResponse } from '@/types';
import type {
  AuthorizationUser,
  DataScopeOption,
  FieldCatalogEntry,
  FieldCapability,
  Page,
  PermissionCatalogEntry,
  PermissionCode,
  PermissionTraceView,
  RoleAuthorizationView,
  RoleGrant,
  RoleMember,
  SpecialGrant,
  UserAuthorizationView,
} from './types';

const data = async <T>(promise: Promise<ApiResponse<T>>): Promise<T> => (await promise).data;

export const authorizationAdminApi = {
  catalogs: {
    permissions: () => data(request.get<ApiResponse<PermissionCatalogEntry[]>>('/v1/permissions/catalog')),
    fields: () => data(request.get<ApiResponse<FieldCatalogEntry[]>>('/v1/permissions/fields')),
    dataScopes: () => data(request.get<ApiResponse<DataScopeOption[]>>('/v1/permissions/data-scopes')),
    createDataScope: (input: { name: string; scopeType: string; includeDescendants: boolean; organizationId: string | null; professionalTeamId: string | null }) => data(request.post<ApiResponse<DataScopeOption>>('/v1/permissions/data-scopes', input)),
  },
  roles: {
    list: (params: { page?: number; pageSize?: number; keyword?: string } = {}) => data(request.get<ApiResponse<Page<RoleAuthorizationView>>>('/v1/roles', { params })),
    detail: (id: string) => data(request.get<ApiResponse<RoleAuthorizationView>>(`/v1/roles/${id}`)),
    create: (input: { name: string; code: string; description?: string | null }) => data(request.post<ApiResponse<RoleAuthorizationView>>('/v1/roles', input)),
    update: (id: string, input: { name?: string; description?: string | null; version: number }) => data(request.patch<ApiResponse<RoleAuthorizationView>>(`/v1/roles/${id}`, input)),
    enable: (id: string, version: number) => data(request.post<ApiResponse<RoleAuthorizationView>>(`/v1/roles/${id}/enable`, { version })),
    disable: (id: string, version: number) => data(request.post<ApiResponse<RoleAuthorizationView>>(`/v1/roles/${id}/disable`, { version })),
    replacePermissions: (id: string, permissionCodes: PermissionCode[], version: number) => data(request.put<ApiResponse<RoleAuthorizationView>>(`/v1/roles/${id}/permissions`, { permissionCodes, version })),
    replaceDataScopes: (id: string, bindings: Array<{ resource: string; dataScopeId: string }>, version: number) => data(request.put<ApiResponse<RoleAuthorizationView>>(`/v1/roles/${id}/data-scopes`, { bindings, version })),
    replaceFieldPermissions: (id: string, fields: FieldCapability[], version: number) => data(request.put<ApiResponse<RoleAuthorizationView>>(`/v1/roles/${id}/field-permissions`, { fields, version })),
    members: (id: string) => data(request.get<ApiResponse<RoleMember[]>>(`/v1/roles/${id}/members`)),
  },
  users: {
    list: (params: { page?: number; pageSize?: number; keyword?: string } = {}) => data(request.get<ApiResponse<Page<AuthorizationUser>>>('/v1/users', { params })),
    authorization: (id: string) => data(request.get<ApiResponse<UserAuthorizationView>>(`/v1/users/${id}/authorization`)),
    grantRole: (id: string, input: { roleId: string; source: 'PERMANENT' | 'TEMPORARY'; validFrom: string; validUntil: string | null; reason: string | null }) => data(request.post<ApiResponse<RoleGrant>>(`/v1/users/${id}/role-grants`, input)),
    revokeRole: (id: string, grantId: string, input: { reason: string; version: number }) => data(request.post<ApiResponse<RoleGrant>>(`/v1/users/${id}/role-grants/${grantId}/revoke`, input)),
    grantSpecial: (id: string, input: { permissionCode: PermissionCode; dataScopeId: string; validFrom: string; validUntil: string; reason: string }) => data(request.post<ApiResponse<SpecialGrant>>(`/v1/users/${id}/special-grants`, input)),
    revokeSpecial: (id: string, grantId: string, input: { reason: string; version: number }) => data(request.post<ApiResponse<SpecialGrant>>(`/v1/users/${id}/special-grants/${grantId}/revoke`, input)),
  },
  trace: {
    user: (userId: string, permissionCode?: PermissionCode) => data(request.get<ApiResponse<PermissionTraceView>>(`/v1/authorization/trace/users/${userId}`, { params: { permissionCode } })),
    me: (permissionCode?: PermissionCode) => data(request.get<ApiResponse<PermissionTraceView>>('/v1/authorization/me/trace', { params: { permissionCode } })),
  },
  sensitive: {
    employee: (resourceId: string, fieldCodes: string[], purpose: string) => data(request.post<ApiResponse<Record<string, string | null>>>('/v1/authorization/sensitive-view', { resource: 'employee', resourceId, fieldCodes, purpose })),
  },
};

const errorLabels: Record<string, string> = {
  VERSION_CONFLICT: '数据已被其他管理员更新，请刷新后重试',
  AUTHORIZATION_INPUT_INVALID: '提交内容不符合授权规则',
  AUTHORIZATION_ESCALATION_BLOCKED: '该操作可能造成权限提升，已被阻止',
  AUTHORIZATION_OBJECT_IN_USE: '对象正在使用中，不能执行该操作',
  TRUST_ROOT_PROTECTED: '系统信任根不可修改',
};

export function authorizationErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const code = (error.response?.data as { message?: string } | undefined)?.message;
    if (code) return errorLabels[code] ?? code;
  }
  return error instanceof Error ? error.message : '授权操作失败';
}
