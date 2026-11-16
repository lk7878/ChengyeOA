import { timingSafeEqual } from 'node:crypto';
import { Context } from 'egg';
import { SecurityError } from '../domain/security/security-errors';

const COOKIE_MUTATION_PATHS = new Set([
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/v1/auth/password/change',
  '/api/v1/auth/logout-all',
  '/api/v1/auth/mfa',
  '/api/v1/auth/mfa/enrollment/start',
  '/api/v1/auth/mfa/recovery-codes',
  '/api/v1/auth/step-up',
]);

export function csrfMiddleware(trustedOrigins: readonly string[]) {
  const allowed = new Set(trustedOrigins);
  return async (ctx: Context, next: () => Promise<unknown>) => {
    if (!requiresCsrf(ctx.method, ctx.path)) {
      await next();
      return;
    }
    const origin = ctx.get('origin');
    const header = ctx.get('x-csrf-token');
    const cookie = ctx.cookies.get('chengye_csrf', { signed: false }) ?? '';
    if (!allowed.has(origin) || !safeEqual(header, cookie)) {
      throw new SecurityError('CSRF_INVALID', 403);
    }
    await next();
  };
}

export default () => async (ctx: Context, next: () => Promise<unknown>) => {
  const config = ctx.app.config as typeof ctx.app.config & {
    identitySecurity: { trustedOrigins: string[] };
  };
  await csrfMiddleware(config.identitySecurity.trustedOrigins)(ctx, next);
};

function requiresCsrf(method: string, path: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return false;
  return COOKIE_MUTATION_PATHS.has(path)
    || (method.toUpperCase() === 'DELETE' && path.startsWith('/api/v1/auth/sessions/'));
}

function safeEqual(first: string, second: string): boolean {
  if (!first || !second) return false;
  const left = Buffer.from(first, 'utf8');
  const right = Buffer.from(second, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
