// Axios 封装
import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { message } from 'antd';

type RequestInstance = Omit<AxiosInstance, 'delete' | 'get' | 'patch' | 'post' | 'put'> & {
  delete<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
  get<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
  patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
};

const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
}) as RequestInstance;

// 请求拦截器：添加 Token
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('law_firm_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// 响应拦截器：统一错误处理
request.interceptors.response.use(
  (response: AxiosResponse) => {
    const { data } = response;
    if (data.code !== 200) {
      message.error(data.message || '请求失败');
      return Promise.reject(new Error(data.message));
    }
    return data;
  },
  (error: AxiosError) => {
    if (error.response) {
      const { status, data } = error.response as { status: number; data: { message?: string } };
      if (status === 401) {
        message.error('登录已过期，请重新登录');
        localStorage.removeItem('law_firm_token');
        localStorage.removeItem('law_firm_refresh_token');
        window.location.href = '/login';
      } else if (status === 403) {
        message.error('没有权限执行此操作');
      } else if (status === 404) {
        message.error('请求的资源不存在');
      } else if (status === 409) {
        message.error(data?.message || '资源冲突');
      } else {
        message.error(data?.message || '服务器错误');
      }
    } else {
      message.error('网络错误，请检查网络连接');
    }
    return Promise.reject(error);
  }
);

export default request;
