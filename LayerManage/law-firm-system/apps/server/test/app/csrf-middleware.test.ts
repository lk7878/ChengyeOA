import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from 'egg';
import { csrfMiddleware } from '../../app/middleware/csrf';
import { SecurityError } from '../../app/domain/security/security-errors';

function context(input: {
  method?: string;
  path?: string;
  origin?: string;
  header?: string;
  cookie?: string;
}): Context {
  return {
    method: input.method ?? 'POST',
    path: input.path ?? '/api/v1/auth/refresh',
    get(name: string) {
      if (name.toLowerCase() === 'origin') return input.origin ?? '';
      if (name.toLowerCase() === 'x-csrf-token') return input.header ?? '';
      return '';
    },
    cookies: { get: () => input.cookie },
  } as unknown as Context;
}

function hasCsrfError(error: unknown): boolean {
  return error instanceof SecurityError && error.code === 'CSRF_INVALID' && error.httpStatus === 403;
}

test('bypasses reads and bearer-authorized mutations that do not use cookie authority', async () => {
  let calls = 0;
  const middleware = csrfMiddleware(['https://oa.chengye.example']);
  await middleware(context({ method: 'GET', path: '/api/v1/auth/sessions' }), async () => { calls += 1; });
  await middleware(context({ path: '/api/v1/auth/login' }), async () => { calls += 1; });
  await middleware(context({ path: '/api/v1/auth/mfa/verify' }), async () => { calls += 1; });
  await middleware(context({
    path: '/api/v1/event-operations/deliveries/delivery-1/retry',
  }), async () => { calls += 1; });
  assert.equal(calls, 4);
});

test('rejects missing or untrusted origins and mismatched double-submit tokens', async () => {
  const middleware = csrfMiddleware(['https://oa.chengye.example']);
  for (const input of [
    { origin: '', header: 'same', cookie: 'same' },
    { origin: 'https://attacker.example', header: 'same', cookie: 'same' },
    { origin: 'https://oa.chengye.example', header: 'first', cookie: 'second' },
    { origin: 'https://oa.chengye.example', header: '', cookie: '' },
  ]) {
    await assert.rejects(
      () => middleware(context(input), async () => undefined),
      hasCsrfError,
    );
  }
});

test('allows an exact trusted origin and constant-time token match', async () => {
  let called = false;
  await csrfMiddleware(['https://oa.chengye.example'])(context({
    origin: 'https://oa.chengye.example',
    header: 'csrf-token-value',
    cookie: 'csrf-token-value',
  }), async () => { called = true; });
  assert.equal(called, true);
});
