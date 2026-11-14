export const AUTHORIZATION_CODES = {
  input: 'AUTHORIZATION_INPUT_INVALID',
  authentication: 'AUTHENTICATION_REQUIRED',
  permission: 'PERMISSION_DENIED',
  scope: 'DATA_SCOPE_DENIED',
  field: 'FIELD_PERMISSION_DENIED',
  special: 'SPECIAL_PERMISSION_REQUIRED',
  escalation: 'PRIVILEGE_ESCALATION_BLOCKED',
  hidden: 'RESOURCE_NOT_FOUND_OR_FORBIDDEN',
  objectNotFound: 'AUTHORIZATION_OBJECT_NOT_FOUND',
  purpose: 'ACCESS_PURPOSE_REQUIRED',
  version: 'VERSION_CONFLICT',
  quarantined: 'EVENT_DELIVERY_QUARANTINED',
  inUse: 'AUTHORIZATION_IN_USE',
  reportingCycle: 'REPORTING_LINE_CYCLE',
  trustRoot: 'TRUST_ROOT_PROTECTED',
} as const;

export type AuthorizationCode = typeof AUTHORIZATION_CODES[keyof typeof AUTHORIZATION_CODES];

export class AuthorizationError extends Error {
  constructor(readonly code: AuthorizationCode, readonly status: number) {
    super(code);
    this.name = 'AuthorizationError';
  }
}

export function authorizationInputError(): never {
  throw new AuthorizationError(AUTHORIZATION_CODES.input, 400);
}

export function accessPurposeError(): never {
  throw new AuthorizationError(AUTHORIZATION_CODES.purpose, 400);
}
