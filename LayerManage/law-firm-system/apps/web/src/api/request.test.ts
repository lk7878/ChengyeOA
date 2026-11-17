import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { beforeEach, expect, test, vi } from 'vitest';
import { authApi } from './auth';
import request from './request';
import { showRequestError } from './errors';
import { runtimeSession } from '@/features/auth/runtime-session';

beforeEach(() => {
  document.cookie='chengye_csrf=; Max-Age=0; Path=/';
  window.localStorage.clear();
  runtimeSession.clear();
  vi.restoreAllMocks();
});

test('logout sends current shared CSRF with its own access proof and never refreshes into another account',async()=>{
  runtimeSession.setAuthenticated({token:'own-access',csrfToken:'stale-csrf',expiresIn:900});
  document.cookie='chengye_csrf=current-csrf; Path=/';
  const original=request.defaults.adapter,refresh=vi.spyOn(runtimeSession,'refreshOnce');
  vi.spyOn(message,'error').mockImplementation(()=>({}) as never);
  request.defaults.adapter=async config=>{
    expect(config.headers.Authorization).toBe('Bearer own-access');
    expect(config.headers['X-CSRF-Token']).toBe('current-csrf');
    throw new AxiosError('invalid',undefined,config,undefined,{config,status:401,statusText:'Unauthorized',headers:{},data:{code:401,message:'TOKEN_INVALID'}});
  };
  try{await expect(authApi.logout()).rejects.toMatchObject({response:{status:401}});expect(refresh).not.toHaveBeenCalled();}
  finally{request.defaults.adapter=original;document.cookie='chengye_csrf=; Max-Age=0; Path=/';}
});

test('retried mutations replace the pre-refresh CSRF header along with the access token',async()=>{
  runtimeSession.setAuthenticated({token:'old-access',csrfToken:'old-csrf',expiresIn:900});
  vi.spyOn(runtimeSession,'refreshOnce').mockImplementation(async()=>{
    runtimeSession.setAuthenticated({token:'new-access',csrfToken:'new-csrf',expiresIn:900});return 'new-access';
  });
  const original=request.defaults.adapter;let attempts=0;
  request.defaults.adapter=async config=>{
    if(attempts++===0)throw new AxiosError('expired',undefined,config,undefined,{config,status:401,statusText:'Unauthorized',headers:{},data:{code:401,message:'TOKEN_INVALID'}});
    expect(config.headers.Authorization).toBe('Bearer new-access');expect(config.headers['X-CSRF-Token']).toBe('new-csrf');
    return {config,status:200,statusText:'OK',headers:{},data:{code:200,data:null}};
  };
  try{await request.post('/v1/example-mutation',{});expect(attempts).toBe(2);}finally{request.defaults.adapter=original;}
});

test('a rejected login stays local to the form without an expired-session toast or a refresh attempt', async () => {
  const errorMessage = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  const refresh = vi.spyOn(runtimeSession, 'refreshOnce');
  runtimeSession.setAuthenticated({ token: 'old-access-token', csrfToken: 'csrf-token', expiresIn: 900 });
  const originalAdapter = request.defaults.adapter;
  let capturedConfig: InternalAxiosRequestConfig | null = null;
  request.defaults.adapter = async config => {
    capturedConfig = config;
    throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
      config, status: 401, statusText: 'Unauthorized', headers: {},
      data: { code: 401, message: 'AUTHENTICATION_FAILED' },
    });
  };
  try {
    await expect(authApi.login({ username: 'admin', password: 'incorrect' })).rejects.toMatchObject({
      response: { status: 401, data: { message: 'AUTHENTICATION_FAILED' } },
    });
  } finally {
    request.defaults.adapter = originalAdapter;
  }
  expect(capturedConfig!.headers.Authorization).toBeUndefined();
  expect(errorMessage).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

test('forced password change keeps its challenge token in the body without globally rendering security errors', async () => {
  const errorMessage = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  const originalAdapter = request.defaults.adapter;
  let capturedConfig: InternalAxiosRequestConfig | null = null;
  runtimeSession.setAuthenticated({ token: 'normal-access-token', csrfToken: 'csrf-token', expiresIn: 900 });
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
  expect(capturedConfig!.headers.Authorization).toBeUndefined();
  expect(JSON.parse(capturedConfig!.data as string)).toMatchObject({ challengeToken: 'change-token' });
});

test('ordinary requests receive the normal access token when authorization is absent', async () => {
  const originalAdapter = request.defaults.adapter;
  let capturedConfig: InternalAxiosRequestConfig | null = null;
  runtimeSession.setAuthenticated({ token: 'normal-access-token', csrfToken: 'csrf-token', expiresIn: 900 });
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
  expect(request.defaults.withCredentials).toBe(true);
});

test('plain header objects preserve an explicitly empty authorization value', async () => {
  const originalAdapter = request.defaults.adapter;
  let capturedConfig: InternalAxiosRequestConfig | null = null;
  runtimeSession.setAuthenticated({ token: 'normal-access-token', csrfToken: 'csrf-token', expiresIn: 900 });
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

test('injects the in-memory CSRF value into authenticated mutations', async () => {
  runtimeSession.setAuthenticated({ token: 'access-token', csrfToken: 'csrf-token', expiresIn: 900 });
  const originalAdapter = request.defaults.adapter;
  let capturedConfig: InternalAxiosRequestConfig | null = null;
  request.defaults.adapter = async requestConfig => {
    capturedConfig = requestConfig;
    return {
      config: requestConfig,
      data: { code: 200, message: 'OK', data: null },
      headers: {}, status: 200, statusText: 'OK',
    };
  };
  try {
    await request.post('/v1/protected', {});
  } finally {
    request.defaults.adapter = originalAdapter;
  }
  expect(capturedConfig!.headers['X-CSRF-Token']).toBe('csrf-token');
  expect(JSON.stringify({ ...localStorage })).not.toMatch(/access-token|csrf-token/);
});

test('aborted requests reject as canceled without showing a global network error', async () => {
  const errorMessage = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  const originalAdapter = request.defaults.adapter;
  const controller = new AbortController();
  let notifyAdapterStarted!: () => void;
  const adapterStarted = new Promise<void>((resolve) => {
    notifyAdapterStarted = resolve;
  });

  request.defaults.adapter = requestConfig => new Promise((_resolve, reject) => {
    requestConfig.signal?.addEventListener?.('abort', () => {
      reject(new axios.CanceledError(undefined, requestConfig));
    }, { once: true });
    notifyAdapterStarted();
  });

  try {
    const pendingRequest = request.get('/v1/cancel-me', { signal: controller.signal });
    await adapterStarted;
    controller.abort();

    await expect(pendingRequest).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  } finally {
    request.defaults.adapter = originalAdapter;
  }

  expect(errorMessage).not.toHaveBeenCalled();
});

test('response-less transport errors still show the global Chinese network error', async () => {
  const errorMessage = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  const originalAdapter = request.defaults.adapter;
  request.defaults.adapter = requestConfig => Promise.reject(
    new AxiosError('socket closed', 'ERR_NETWORK', requestConfig),
  );

  try {
    await expect(request.get('/v1/network-failure')).rejects.toMatchObject({ code: 'ERR_NETWORK' });
  } finally {
    request.defaults.adapter = originalAdapter;
  }

  expect(errorMessage).toHaveBeenCalledOnce();
  expect(errorMessage).toHaveBeenCalledWith('网络错误，请检查网络连接');
});

test.each([400, 409])('validation responses (%s) are translated once even when the page also reports the failure', async status => {
  const errorMessage = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  const originalAdapter = request.defaults.adapter;
  request.defaults.adapter = async config => { throw new AxiosError('Request failed', undefined, config, undefined, {
    config, status, statusText: 'Failed', headers: {}, data: { code: status, message: 'VALIDATION_FAILED' },
  }); };
  try {
    await request.post('/v1/organizations', {}).catch(error => showRequestError(error, '操作未完成，当前输入已保留'));
  } finally { request.defaults.adapter = originalAdapter; }
  expect(errorMessage).toHaveBeenCalledTimes(1);
  expect(errorMessage).toHaveBeenCalledWith(status === 400
    ? '输入内容不符合要求，请检查字段格式和必填项，当前输入已保留'
    : '输入内容与现有记录冲突，请检查重复项或关联数据');
});

test('logical errors in successful HTTP responses honor local error ownership and preserve the error code', async () => {
  const errorMessage = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  const originalAdapter = request.defaults.adapter;
  request.defaults.adapter = async config => ({ config, status: 200, statusText: 'OK', headers: {},
    data: { code: 400, message: 'VALIDATION_FAILED' },
  });
  try {
    await expect(request.post('/v1/organizations', {}, { suppressGlobalError: true })).rejects.toMatchObject({
      response: { status: 400, data: { message: 'VALIDATION_FAILED' } },
    });
  } finally { request.defaults.adapter = originalAdapter; }
  expect(errorMessage).not.toHaveBeenCalled();
});
