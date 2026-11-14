import { GOVERNANCE_CODES, GovernanceError } from './governance-errors';
import { GovernanceDecision, GovernanceStatus } from './governance-types';

function statuses(...values: GovernanceStatus[]): readonly GovernanceStatus[] {
  return Object.freeze(values);
}

const TRANSITIONS: Readonly<Record<GovernanceStatus, readonly GovernanceStatus[]>> = Object.freeze({
  PENDING_REVIEW: statuses('APPROVED', 'REJECTED', 'CANCELLED'),
  APPROVED: statuses('EXECUTING'),
  REJECTED: statuses(),
  CANCELLED: statuses(),
  EXECUTING: statuses('SUCCEEDED', 'FAILED', 'PENDING_POST_REVIEW'),
  SUCCEEDED: statuses(),
  FAILED: statuses('EXECUTING'),
  PENDING_POST_REVIEW: statuses('CONFIRMED', 'FLAGGED'),
  CONFIRMED: statuses(),
  FLAGGED: statuses(),
});

export function assertGovernanceTransition(from: GovernanceStatus, to: GovernanceStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new GovernanceError(GOVERNANCE_CODES.processed, 409, `Invalid governance transition: ${from} -> ${to}`);
  }
}

export function decisionTarget(status: GovernanceStatus, decision: GovernanceDecision): GovernanceStatus {
  if (status === 'PENDING_REVIEW' && decision === 'APPROVE') {
    return 'APPROVED';
  }
  if (status === 'PENDING_REVIEW' && decision === 'REJECT') {
    return 'REJECTED';
  }
  if (status === 'PENDING_POST_REVIEW' && decision === 'CONFIRM') {
    return 'CONFIRMED';
  }
  if (status === 'PENDING_POST_REVIEW' && decision === 'FLAG') {
    return 'FLAGGED';
  }
  throw new GovernanceError(GOVERNANCE_CODES.processed, 409, 'Decision does not match the current review stage');
}

export function mayResumeExecution(
  status: GovernanceStatus,
  successfulAttempts: number,
  retryable = false,
): boolean {
  if (!Number.isInteger(successfulAttempts) || successfulAttempts < 0 || successfulAttempts > 0) {
    return false;
  }
  return status === 'APPROVED' || (status === 'FAILED' && retryable);
}
