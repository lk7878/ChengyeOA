import { hashPayload } from '../admin-governance/canonical-json';

export const STEP_UP_PURPOSES = Object.freeze([
  'ADMIN_HIGH_RISK',
  'ADMIN_GOVERNANCE_CREATE',
  'ADMIN_GOVERNANCE_APPROVE',
  'ADMIN_GOVERNANCE_RETRY',
  'MFA_DISABLE_SELF',
  'MFA_RECOVERY_CODES_REGENERATE',
  'ADMIN_MFA_RESET',
  'SESSION_REVOKE',
  'SESSION_REVOKE_ALL',
  'EVENT_DELIVERY_RETRY',
  'REFUND_APPROVE',
] as const);

export type StepUpPurpose = typeof STEP_UP_PURPOSES[number];

export class StepUpTargetValidationError extends Error {
  constructor() {
    super('STEP_UP_TARGET_INVALID');
    this.name = 'StepUpTargetValidationError';
  }
}

export function validateStepUpPurposeAndTarget(purpose: unknown, target: unknown): StepUpPurpose {
  if (!isStepUpPurpose(purpose)) invalid();
  digestStepUpTarget(purpose, target);
  return purpose;
}

export function digestStepUpTarget(purpose: StepUpPurpose, raw: unknown): string {
  if (!isStepUpPurpose(purpose)) invalid();
  return hashPayload({ purpose, target: normalizeTarget(purpose, raw) });
}

function normalizeTarget(purpose: StepUpPurpose, raw: unknown): Record<string, string | number> {
  switch (purpose) {
    case 'ADMIN_HIGH_RISK': {
      const value = exactRecord(raw, ['method', 'path', 'payloadHash']);
      return { method: requiredString(value.method), path: requiredString(value.path), payloadHash: sha256(value.payloadHash) };
    }
    case 'ADMIN_GOVERNANCE_CREATE': {
      const value = exactRecord(raw, [
        'operationType', 'targetType', 'targetId', 'expectedTargetVersion', 'payloadHash',
      ]);
      return {
        operationType: requiredString(value.operationType),
        targetType: requiredString(value.targetType),
        targetId: requiredString(value.targetId),
        expectedTargetVersion: positiveInteger(value.expectedTargetVersion),
        payloadHash: sha256(value.payloadHash),
      };
    }
    case 'ADMIN_GOVERNANCE_APPROVE': {
      const value = exactRecord(raw, ['operationId', 'expectedOperationVersion', 'decision']);
      if (value.decision !== 'APPROVE') invalid();
      return {
        operationId: requiredString(value.operationId),
        expectedOperationVersion: positiveInteger(value.expectedOperationVersion),
        decision: 'APPROVE',
      };
    }
    case 'ADMIN_GOVERNANCE_RETRY': {
      const value = exactRecord(raw, ['operationId', 'expectedOperationVersion']);
      return {
        operationId: requiredString(value.operationId),
        expectedOperationVersion: positiveInteger(value.expectedOperationVersion),
      };
    }
    case 'MFA_DISABLE_SELF':
    case 'MFA_RECOVERY_CODES_REGENERATE':
    case 'SESSION_REVOKE_ALL': {
      const value = exactRecord(raw, ['userId']);
      return { userId: requiredString(value.userId) };
    }
    case 'ADMIN_MFA_RESET': {
      const value = exactRecord(raw, ['targetUserId']);
      return { targetUserId: requiredString(value.targetUserId) };
    }
    case 'SESSION_REVOKE': {
      const value = exactRecord(raw, ['sessionId']);
      return { sessionId: requiredString(value.sessionId) };
    }
    case 'EVENT_DELIVERY_RETRY': {
      const value = exactRecord(raw, ['deliveryId', 'expectedVersion']);
      return {
        deliveryId: requiredString(value.deliveryId),
        expectedVersion: positiveInteger(value.expectedVersion),
      };
    }
    case 'REFUND_APPROVE': {
      const value = exactRecord(raw, ['refundRequestId', 'expectedVersion']);
      return {
        refundRequestId: requiredString(value.refundRequestId),
        expectedVersion: positiveInteger(value.expectedVersion),
      };
    }
  }
}

function exactRecord(raw: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) {
    invalid();
  }
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== [...expectedKeys].sort()[index])) {
    invalid();
  }
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) invalid();
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid();
  return value as number;
}

function sha256(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}

function invalid(): never {
  throw new StepUpTargetValidationError();
}

function isStepUpPurpose(value: unknown): value is StepUpPurpose {
  return typeof value === 'string' && STEP_UP_PURPOSES.includes(value as StepUpPurpose);
}
