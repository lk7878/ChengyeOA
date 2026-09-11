import {
  AdminOperation,
  AdminOperationExecution,
  AdminOperationReview,
  Prisma,
} from '@prisma/client';
import { GovernedOperationCatalogEntry, GovernedOperationType } from '../../domain/admin-governance/governance-types';
import { AdminOperationWithTimeline } from './governance-store';

export interface GovernancePage<T> {
  list: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface AdminOperationView {
  id: string;
  operationNo: string;
  operationType: string;
  riskLevel: string;
  reviewMode: string;
  status: string;
  requesterUserId: string;
  targetType: string;
  targetId: string;
  reason: string;
  expectedTargetVersion: number;
  secondConfirmationAt: Date | null;
  relatedOperationId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminOperationReviewView {
  id: string;
  operationId: string;
  reviewerUserId: string;
  decision: string;
  comment: string | null;
  operationVersion: number;
  createdAt: Date;
}

export interface AdminOperationExecutionView {
  id: string;
  operationId: string;
  attemptNo: number;
  executorType: string;
  status: string;
  beforeSnapshot: Prisma.JsonValue;
  afterSnapshot: Prisma.JsonValue;
  resultCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface AdminOperationDetailView extends AdminOperationView {
  payloadSnapshot: Prisma.JsonValue;
  reviews: AdminOperationReviewView[];
  executions: AdminOperationExecutionView[];
}

export interface GovernanceCatalogView extends GovernedOperationCatalogEntry {
  operationType: GovernedOperationType;
  confirmationTemplate?: string;
}

export function toAdminOperationView(operation: AdminOperation): AdminOperationView {
  return {
    id: operation.id,
    operationNo: operation.operationNo,
    operationType: operation.operationType,
    riskLevel: operation.riskLevel,
    reviewMode: operation.reviewMode,
    status: operation.status,
    requesterUserId: operation.requesterUserId,
    targetType: operation.targetType,
    targetId: operation.targetId,
    reason: operation.reason,
    expectedTargetVersion: operation.expectedTargetVersion,
    secondConfirmationAt: operation.secondConfirmationAt,
    relatedOperationId: operation.relatedOperationId,
    version: operation.version,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}

export function toAdminOperationDetailView(operation: AdminOperationWithTimeline): AdminOperationDetailView {
  return {
    ...toAdminOperationView(operation),
    payloadSnapshot: sanitizeGovernanceSnapshot(operation.payloadSnapshot),
    reviews: operation.reviews.map(toReviewView),
    executions: operation.executions.map(toExecutionView),
  };
}

const SENSITIVE_KEY = /(password|token|secret|totp|otp|mfa|recovery|api.?key|credential|authorization|cookie|confirmation|id.?card|database.?url|connection.?string)/i;
const CONNECTION_STRING = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function sanitizeGovernanceSnapshot(value: Prisma.JsonValue): Prisma.JsonValue {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(item => sanitizeGovernanceSnapshot(item));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeGovernanceSnapshot(item),
  ]));
}

function toReviewView(review: AdminOperationReview): AdminOperationReviewView {
  return {
    id: review.id,
    operationId: review.operationId,
    reviewerUserId: review.reviewerUserId,
    decision: review.decision,
    comment: review.comment,
    operationVersion: review.operationVersion,
    createdAt: review.createdAt,
  };
}

function toExecutionView(execution: AdminOperationExecution): AdminOperationExecutionView {
  return {
    id: execution.id,
    operationId: execution.operationId,
    attemptNo: execution.attemptNo,
    executorType: execution.executorType,
    status: execution.status,
    beforeSnapshot: sanitizeGovernanceSnapshot(execution.beforeSnapshot),
    afterSnapshot: sanitizeGovernanceSnapshot(execution.afterSnapshot),
    resultCode: execution.resultCode,
    errorMessage: execution.errorMessage === null ? null : sanitizeString(execution.errorMessage),
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
  };
}

function sanitizeString(value: string): string {
  return value.replace(CONNECTION_STRING, '[REDACTED]').replace(BEARER_TOKEN, '[REDACTED]');
}
