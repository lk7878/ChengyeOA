export type SecurityErrorCode =
  | 'USERNAME_INVALID'
  | 'PASSWORD_INVALID'
  | 'PASSWORD_REUSED'
  | 'TOKEN_INVALID'
  | 'TOKEN_TYPE_INVALID'
  | 'AUTHENTICATION_FAILED';

export class SecurityError extends Error {
  constructor(
    public readonly code: SecurityErrorCode,
    public readonly httpStatus = 400,
  ) {
    super(code);
    this.name = 'SecurityError';
  }
}
