import { GOVERNED_OPERATION_TYPES, GovernedOperationType, GovernanceDecision } from './governance-types';
import { governanceInputError } from './governance-errors';

export interface CreateGovernanceInput {
  operationType: GovernedOperationType;
  targetType: string;
  targetId: string;
  reason: string;
  expectedTargetVersion: number;
  payload: unknown;
  idempotencyKey: string;
  confirmation?: string;
}

export interface CancelGovernanceInput {
  expectedOperationVersion: number;
}

export interface ReviewGovernanceInput {
  decision: GovernanceDecision;
  comment?: string;
  expectedOperationVersion: number;
}

export interface RetryGovernanceInput {
  expectedOperationVersion: number;
}

const CREATE_KEYS = Object.freeze([
  'operationType',
  'targetType',
  'targetId',
  'reason',
  'expectedTargetVersion',
  'payload',
  'idempotencyKey',
  'confirmation',
]);
const REVIEW_KEYS = Object.freeze(['decision', 'comment', 'expectedOperationVersion']);

export function parseCreateGovernanceInput(raw: unknown): CreateGovernanceInput {
  const input = exactRecord(raw, CREATE_KEYS, CREATE_KEYS.slice(0, 7));
  const operationType = requiredString(input.operationType);
  if (!GOVERNED_OPERATION_TYPES.includes(operationType as GovernedOperationType)) {
    return governanceInputError();
  }

  return {
    operationType: operationType as GovernedOperationType,
    targetType: requiredString(input.targetType),
    targetId: requiredString(input.targetId),
    reason: boundedText(input.reason),
    expectedTargetVersion: positiveInteger(input.expectedTargetVersion),
    payload: input.payload,
    idempotencyKey: requiredString(input.idempotencyKey),
    ...optionalConfirmation(input.confirmation),
  };
}

export function parseCancelGovernanceInput(raw: unknown): CancelGovernanceInput {
  const input = exactRecord(raw, ['expectedOperationVersion'], ['expectedOperationVersion']);
  return { expectedOperationVersion: positiveInteger(input.expectedOperationVersion) };
}

export function parseReviewGovernanceInput(raw: unknown): ReviewGovernanceInput {
  const input = exactRecord(raw, REVIEW_KEYS, ['decision', 'expectedOperationVersion']);
  if (!['APPROVE', 'REJECT', 'CONFIRM', 'FLAG'].includes(input.decision as string)) {
    return governanceInputError();
  }

  const decision = input.decision as GovernanceDecision;
  const comment = input.comment === undefined ? undefined : boundedText(input.comment);
  if ((decision === 'REJECT' || decision === 'FLAG') && comment === undefined) {
    return governanceInputError();
  }

  return {
    decision,
    ...(comment === undefined ? {} : { comment }),
    expectedOperationVersion: positiveInteger(input.expectedOperationVersion),
  };
}

export function parseRetryGovernanceInput(raw: unknown): RetryGovernanceInput {
  const input = exactRecord(raw, ['expectedOperationVersion'], ['expectedOperationVersion']);
  return { expectedOperationVersion: positiveInteger(input.expectedOperationVersion) };
}

function exactRecord(
  raw: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return governanceInputError();
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some(key => !allowedKeys.includes(key)) || requiredKeys.some(key => !Object.hasOwn(input, key))) {
    return governanceInputError();
  }
  return input;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return governanceInputError();
  }
  return value.trim();
}

function boundedText(value: unknown): string {
  const text = requiredString(value);
  if (text.length < 10 || text.length > 500) {
    return governanceInputError();
  }
  return text;
}

function positiveInteger(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    return governanceInputError();
  }
  return value as number;
}

function optionalConfirmation(value: unknown): Pick<CreateGovernanceInput, 'confirmation'> | Record<string, never> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'string' || value.length === 0) {
    return governanceInputError();
  }
  return { confirmation: value };
}
