const AUTHENTICATION_PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/password/forced-change',
  '/api/v1/auth/mfa/enrollment',
  '/api/v1/auth/mfa/enrollment/confirm',
  '/api/v1/auth/mfa/verify',
]);

export function isAuthenticationPublicPath(path: string): boolean {
  return AUTHENTICATION_PUBLIC_PATHS.has(path);
}
