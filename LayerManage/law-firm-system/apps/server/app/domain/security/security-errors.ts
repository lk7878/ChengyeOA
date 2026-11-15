export type SecurityErrorCode =
  | 'USERNAME_INVALID'
  | 'PASSWORD_INVALID'
  | 'PASSWORD_REUSED'
  | 'TOKEN_INVALID'
  | 'SMART_CASE_NOT_CONFIGURED'
  | 'TOKEN_TYPE_INVALID'
  | 'AUTHENTICATION_FAILED'
  | 'MFA_INVALID'
  | 'MFA_CHALLENGE_EXPIRED'
  | 'MFA_RATE_LIMITED'
  | 'MFA_ENROLLMENT_REQUIRED'
  | 'MFA_REQUIRED'
  | 'SESSION_REVOKED'
  | 'REFRESH_TOKEN_REUSED'
  | 'CSRF_INVALID'
  | 'STEP_UP_REQUIRED'
  | 'STEP_UP_INVALID'
  | 'STEP_UP_EXPIRED'
  | 'STEP_UP_PURPOSE_MISMATCH'
  | 'STEP_UP_TARGET_MISMATCH';

export class SecurityError extends Error {
  constructor(
    public readonly code: SecurityErrorCode,
    public readonly httpStatus = 400,
  ) {
    super(code);
    this.name = 'SecurityError';
  }
}
