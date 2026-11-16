import { verifyHighRiskRequest, type HighRiskChallenge } from '@/features/auth/high-risk-request';
import { inPreviewFrame, previewAdapter } from '@/features/authorization/preview-frame';
import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { showRequestError } from './errors';
import { runtimeSession } from '@/features/auth/runtime-session';

type AppRequestConfig = AxiosRequestConfig & {
  suppressGlobalError?: boolean;
  _sessionRetry?: boolean;
  _riskRetry?: boolean;
};

type RequestInstance = Omit<AxiosInstance, 'delete' | 'get' | 'patch' | 'post' | 'put'> & {
  (config: AppRequestConfig): Promise<unknown>;
  delete<T>(url: string, config?: AppRequestConfig): Promise<T>;
  get<T>(url: string, config?: AppRequestConfig): Promise<T>;
  patch<T>(url: string, data?: unknown, config?: AppRequestConfig): Promise<T>;
  post<T>(url: string, data?: unknown, config?: AppRequestConfig): Promise<T>;
  put<T>(url: string, data?: unknown, config?: AppRequestConfig): Promise<T>;
};

type HeaderAccess = {
  get?: (name: string) => unknown;
  has?: (name: string) => boolean;
  set?: (name: string, value: string) => unknown;
};

function hasHeader(headers: InternalAxiosRequestConfig['headers'], name: string): boolean {
  const access = headers as HeaderAccess;
  if (typeof access.has === 'function' && access.has(name)) return true;
  if (typeof access.get === 'function') {
    const value = access.get(name);
    if (value !== null && value !== undefined) return true;
  }
  return Object.keys(headers).some(header => header.toLowerCase() === name.toLowerCase());
}

function setHeader(headers: InternalAxiosRequestConfig['headers'], name: string, value: string): void {
  const access = headers as HeaderAccess;
  if (typeof access.set === 'function') {
    access.set(name, value);
    return;
  }
  (headers as unknown as Record<string, unknown>)[name] = value;
}

const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
}) as RequestInstance;

request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (inPreviewFrame) { config.adapter=previewAdapter; return config; }
    const token = runtimeSession.getAccessToken();
    if (token && !isPublicAuthenticationPath(config.url) && !hasHeader(config.headers, 'Authorization')) {
      setHeader(config.headers, 'Authorization', `Bearer ${token}`);
    }
    const csrf = runtimeSession.getCsrfToken();
    if (csrf && isMutation(config.method) && !hasHeader(config.headers, 'X-CSRF-Token')) {
      setHeader(config.headers, 'X-CSRF-Token', csrf);
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

request.interceptors.response.use(
  (response: AxiosResponse) => {
    const { data } = response;
    if (data.code !== 200) {
      const error = new AxiosError(data.message || 'Request failed', undefined, response.config, undefined, {
        ...response, status: typeof data.code === 'number' ? data.code : response.status,
      });
      if (!(response.config as AppRequestConfig).suppressGlobalError) showRequestError(error, '请求失败');
      return Promise.reject(error);
    }
    return data;
  },
  async (error: AxiosError) => {
    if (axios.isCancel(error) || error.code === 'ERR_CANCELED') return Promise.reject(error);

    const config = error.config as (InternalAxiosRequestConfig & AppRequestConfig) | undefined;
    const response = error.response as { status: number; data?: { message?: string; errors?: HighRiskChallenge } } | undefined;
    const code = response?.data?.message;
    if (code === 'STEP_UP_REQUIRED' && response?.data?.errors?.purpose === 'ADMIN_HIGH_RISK'
      && config && !config._riskRetry && !inPreviewFrame) {
      const token = await verifyHighRiskRequest(response.data.errors);
      config._riskRetry = true;
      setHeader(config.headers, 'X-Step-Up-Token', token);
      // Enrollment can rotate credentials while this business request waits in the dialog.
      setHeader(config.headers, 'Authorization', `Bearer ${runtimeSession.getAccessToken()}`);
      setHeader(config.headers, 'X-CSRF-Token', runtimeSession.getCsrfToken() || '');
      return request(config);
    }

    if (
      response?.status === 401
      && config
      && !config._sessionRetry
      && runtimeSession.getAccessToken()
      && !isPublicAuthenticationPath(config.url)
    ) {
      config._sessionRetry = true;
      try {
        const nextToken = await runtimeSession.refreshOnce();
        setHeader(config.headers, 'Authorization', `Bearer ${nextToken}`);
        return request(config);
      } catch {
        terminateSession();
        return Promise.reject(error);
      }
    }

    if (code === 'SESSION_REVOKED' || code === 'REFRESH_TOKEN_REUSED') {
      terminateSession();
    }

    if (!inPreviewFrame && !config?.suppressGlobalError) showRequestError(error, response ? '服务器错误，请稍后重试' : '网络错误，请检查网络连接');
    return Promise.reject(error);
  },
);

function isMutation(method: string | undefined): boolean {
  return ['post', 'put', 'patch', 'delete'].includes((method ?? '').toLowerCase());
}

function isPublicAuthenticationPath(url: string | undefined): boolean {
  return Boolean(url && [
    '/v1/auth/login',
    '/v1/auth/refresh',
    '/v1/auth/password/forced-change',
    '/v1/auth/mfa/enrollment',
    '/v1/auth/mfa/enrollment/confirm',
    '/v1/auth/mfa/verify',
  ].includes(url));
}

function terminateSession(): void {
  runtimeSession.clear();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

export default request;
