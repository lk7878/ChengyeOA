import request from './request';
import type { ApiResponse, PaginatedData, User, Role, Permission } from '@/types';

export const userApi = {
  // 用户列表
  list: (params?: { page?: number; pageSize?: number; keyword?: string; status?: string }) =>
    request.get<ApiResponse<PaginatedData<User>>>('/v1/users', { params }),

  // 用户详情
  detail: (id: string) =>
    request.get<ApiResponse<User>>(`/v1/users/${id}`),

  // 创建用户
  create: (data: Partial<User> & { password?: string }) =>
    request.post<ApiResponse<User>>('/v1/users', data),

  // 更新用户
  update: (id: string, data: Partial<User>) =>
    request.put<ApiResponse<User>>(`/v1/users/${id}`, data),

  // 重置用户密码（仅管理员）
  resetPassword: (id: string, data: { password: string; confirmation: string }) =>
    request.post<ApiResponse<null>>(`/v1/users/${id}/password-reset`, data),

  // 删除用户
  delete: (id: string) =>
    request.delete<ApiResponse<null>>(`/v1/users/${id}`),

  // 分配角色
  assignRoles: (id: string, roleIds: string[]) =>
    request.post<ApiResponse<User>>(`/v1/users/${id}/roles`, { roleIds }),
};

export const roleApi = {
  // 角色列表
  list: () =>
    request.get<ApiResponse<PaginatedData<Role>>>('/v1/roles', { params: { pageSize: 100 } }),

  // 角色详情
  detail: (id: string) =>
    request.get<ApiResponse<Role>>(`/v1/roles/${id}`),

  // 创建角色
  create: (data: Partial<Role>) =>
    request.post<ApiResponse<Role>>('/v1/roles', data),

  // 更新角色
  update: (id: string, data: Partial<Role>) =>
    request.put<ApiResponse<Role>>(`/v1/roles/${id}`, data),

  // 删除角色
  delete: (id: string) =>
    request.delete<ApiResponse<null>>(`/v1/roles/${id}`),

  // 分配权限
  assignPermissions: (id: string, permissionIds: string[]) =>
    request.post<ApiResponse<Role>>(`/v1/roles/${id}/permissions`, { permissionIds }),
};

export const permissionApi = {
  // 权限列表
  list: () =>
    request.get<ApiResponse<Permission[]>>('/v1/permissions'),

  // 权限树
  tree: () =>
    request.get<ApiResponse<Permission[]>>('/v1/permissions/tree'),
};

export default { userApi, roleApi, permissionApi };
