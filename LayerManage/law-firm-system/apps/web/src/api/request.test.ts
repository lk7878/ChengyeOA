import type { InternalAxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { beforeEach, expect, test, vi } from 'vitest';
import { authApi } from './auth';
import request from './request';

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

test('forced password change sends its bearer token without globally rendering security errors', async () => {
  const errorMessage = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  const originalAdapter = request.defaults.adapter;
  let capturedConfig: InternalAxiosRequestConfig | null = null;
  window.localStorage.setItem('law_firm_token', 'normal-access-token');
  request.defaults.adapter = async (requestConfig) => {
    capturedConfig = requestConfig;
    return Promise.reject({
      config: requestConfig,
      response: {
        status: 400,
        data: { message: 'PASSWORD_INVALID', detail: 'internal policy detail' },
      },
    });
  };

  try {
    await expect(authApi.forcePasswordChange(
      'change-token',
      'Replacement-Horse-93!',
      'Replacement-Horse-93!',
    )).rejects.toBeDefined();
  } finally {
    request.defaults.adapter = originalAdapter;
  }

  expect(errorMessage).not.toHaveBeenCalled();
  expect(capturedConfig).not.toBeNull();
  expect(capturedConfig!.url).toBe('/v1/auth/password/forced-change');
  expect(capturedConfig!.headers.Authorization).toBe('Bearer change-token');
});

test('ordinary requests receive the normal access token when authorization is absent', async () => {
  const originalAdapter = request.defaults.adapter;
  let capturedConfig: InternalAxiosRequestConfig | null = null;
  window.localStorage.setItem('law_firm_token', 'normal-access-token');
  request.defaults.adapter = async (requestConfig) => {
    capturedConfig = requestConfig;
    return {
      config: requestConfig,
      data: { code: 200, message: 'OK', data: null },
      headers: {},
      status: 200,
      statusText: 'OK',
    };
  };

  try {
    await request.get('/v1/ordinary');
  } finally {
    request.defaults.adapter = originalAdapter;
  }

  expect(capturedConfig).not.toBeNull();
  expect(capturedConfig!.headers.Authorization).toBe('Bearer normal-access-token');
});

test('plain header objects preserve an explicitly empty authorization value', async () => {
  const originalAdapter = request.defaults.adapter;
  let capturedConfig: InternalAxiosRequestConfig | null = null;
  window.localStorage.setItem('law_firm_token', 'normal-access-token');
  const interceptor = request.interceptors.request.use((config) => {
    config.headers = { Authorization: '' } as InternalAxiosRequestConfig['headers'];
    return config;
  });
  request.defaults.adapter = async (requestConfig) => {
    capturedConfig = requestConfig;
    return {
      config: requestConfig,
      data: { code: 200, message: 'OK', data: null },
      headers: {},
      status: 200,
      statusText: 'OK',
    };
  };

  try {
    await request.get('/v1/intentional-empty');
  } finally {
    request.interceptors.request.eject(interceptor);
    request.defaults.adapter = originalAdapter;
  }

  expect(capturedConfig).not.toBeNull();
  expect(capturedConfig!.headers.Authorization).toBe('');
});
