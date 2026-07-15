import type { InternalAxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { expect, test, vi } from 'vitest';
import { authApi } from './auth';
import request from './request';

test('forced password change sends its bearer token without globally rendering security errors', async () => {
  const errorMessage = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  const originalAdapter = request.defaults.adapter;
  let capturedConfig: InternalAxiosRequestConfig | null = null;
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
