export const GOVERNANCE_CODES = Object.freeze({
  notAllowed: 'GOVERNANCE_OPERATION_NOT_ALLOWED',
  selfReview: 'GOVERNANCE_SELF_REVIEW_FORBIDDEN',
  reviewTarget: 'GOVERNANCE_REVIEW_TARGET_CONFLICT',
  processed: 'OPERATION_ALREADY_PROCESSED',
  idempotency: 'IDEMPOTENCY_KEY_REUSED',
  staleTarget: 'STALE_TARGET_VERSION',
  payloadHash: 'PAYLOAD_HASH_MISMATCH',
  lastSuperAdmin: 'LAST_SUPER_ADMIN_PROTECTED',
  recoveryUnavailable: 'RECOVERY_WINDOW_NOT_AVAILABLE',
  notRetryable: 'OPERATION_NOT_RETRYABLE',
  targetIneligible: 'TARGET_NOT_ELIGIBLE',
  hidden: 'RESOURCE_NOT_FOUND_OR_FORBIDDEN',
} as const);

export type GovernanceCode = typeof GOVERNANCE_CODES[keyof typeof GOVERNANCE_CODES];

export class GovernanceError extends Error {
  constructor(
    readonly code: GovernanceCode,
    readonly status: number,
    message: string = code,
  ) {
    super(message);
    this.name = 'GovernanceError';
  }
}

export function governanceInputError(): never {
  throw new GovernanceError(GOVERNANCE_CODES.targetIneligible, 400);
}
