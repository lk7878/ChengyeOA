import request from './request';
import type { ApiResponse } from '@/types';
import type {
  LoginUser,
  LoginData,
  MfaStatusView,
  SessionView,
  StepUpPurpose,
} from '@/features/auth/types';

export interface LoginParams {
  username: string;
  password: string;
}

export const authApi = {
  login: (params: LoginParams) =>
    request.post<ApiResponse<LoginData>>('/v1/auth/login', params, { suppressGlobalError: true }),

  forcePasswordChange: (challengeToken: string, password: string, confirmation: string) =>
    request.post<ApiResponse<LoginData>>(
      '/v1/auth/password/forced-change',
      { challengeToken, password, confirmation },
      { suppressGlobalError: true },
    ),

  beginMfaEnrollment: (challengeToken: string) =>
    request.post<ApiResponse<{ secret: string; manualKey: string; otpauthUri: string }>>(
      '/v1/auth/mfa/enrollment', { challengeToken }, { suppressGlobalError: true },
    ),

  startMfaEnrollment: () => request.post<ApiResponse<{ challengeToken: string; expiresIn: 600 }>>(
    '/v1/auth/mfa/enrollment/start', {}, { suppressGlobalError: true },
  ),

  confirmMfaEnrollment: (challengeToken: string, code: string) =>
    request.post<ApiResponse<LoginData>>(
      '/v1/auth/mfa/enrollment/confirm', { challengeToken, code }, { suppressGlobalError: true },
    ),

  verifyMfa: (challengeToken: string, credential: { kind: 'TOTP' | 'RECOVERY_CODE'; code: string }) =>
    request.post<ApiResponse<LoginData>>(
      '/v1/auth/mfa/verify', { challengeToken, credential }, { suppressGlobalError: true },
    ),

  refresh: () => request.post<ApiResponse<{
    token: string; csrfToken: string; expiresIn: 900;
  }>>('/v1/auth/refresh'),

  me: () => request.get<ApiResponse<LoginUser>>('/v1/auth/me'),
  logout: () => request.post<ApiResponse<null>>('/v1/auth/logout'),

  mfaStatus: () => request.get<ApiResponse<MfaStatusView>>('/v1/auth/mfa'),
  disableMfa: (stepUpToken: string) => request.delete<ApiResponse<null>>('/v1/auth/mfa', {
    headers: { 'X-Step-Up-Token': stepUpToken },
  }),
  regenerateRecoveryCodes: (stepUpToken: string) => request.post<ApiResponse<{ recoveryCodes: string[] }>>(
    '/v1/auth/mfa/recovery-codes', {}, { headers: { 'X-Step-Up-Token': stepUpToken } },
  ),
  sessions: () => request.get<ApiResponse<SessionView[]>>('/v1/auth/sessions'),
  revokeSession: (sessionId: string, stepUpToken: string) => request.delete<ApiResponse<null>>(
    `/v1/auth/sessions/${sessionId}`, { headers: { 'X-Step-Up-Token': stepUpToken } },
  ),
  logoutAll: (stepUpToken: string, preserveCurrent = false) => request.post<ApiResponse<{ revokedCount: number }>>(
    '/v1/auth/logout-all', { preserveCurrent }, { headers: { 'X-Step-Up-Token': stepUpToken } },
  ),
  stepUp: (purpose: StepUpPurpose, target: unknown, code: string) => request.post<ApiResponse<{
    stepUpToken: string; expiresIn: 300;
  }>>('/v1/auth/step-up', { purpose, target, code }),
};

export default authApi;
