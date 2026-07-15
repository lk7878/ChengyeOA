import request from './request';
import type { ApiResponse, User } from '@/types';

export interface LoginParams {
  username: string;
  password: string;
}

export interface LoginUser {
  id: string;
  username: string;
  name: string;
  roles: string[];
  permissions: string[];
}

export type LoginData =
  | { mode: 'PASSWORD_CHANGE_REQUIRED'; passwordChangeToken: string; expiresIn: 300 }
  | { mode: 'AUTHENTICATED'; token: string; refreshToken: string; expiresIn: number; user: LoginUser };

export const authApi = {
  // 登录
  login: (params: LoginParams) =>
    request.post<ApiResponse<LoginData>>('/v1/auth/login', params),

  forcePasswordChange: (token: string, password: string, confirmation: string) =>
    request.post<ApiResponse<null>>(
      '/v1/auth/password/forced-change',
      { password, confirmation },
      {
        headers: { Authorization: `Bearer ${token}` },
        suppressGlobalError: true,
      },
    ),

  // 刷新Token
  refresh: (refreshToken: string) =>
    request.post<ApiResponse<{ token: string; expiresIn: number }>>('/v1/auth/refresh', { refreshToken }),

  // 获取当前用户信息
  me: () =>
    request.get<ApiResponse<User>>('/v1/auth/me'),

  // 登出
  logout: () =>
    request.post<ApiResponse<null>>('/v1/auth/logout'),
};

export default authApi;
