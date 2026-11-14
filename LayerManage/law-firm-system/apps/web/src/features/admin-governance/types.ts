export type GovernedOperationType =
  | 'SOP_TEMPLATE_PUBLISH' | 'SOP_TEMPLATE_DISABLE'
  | 'SYSTEM_ADMIN_GRANT' | 'SYSTEM_ADMIN_REVOKE' | 'SYSTEM_ADMIN_ACCOUNT_DISABLE'
  | 'SUPER_ADMIN_GRANT' | 'SUPER_ADMIN_REVOKE' | 'SUPER_ADMIN_ACCOUNT_DISABLE'
  | 'ADMIN_MFA_RESET'
  | 'MASTER_DATA_STATUS_CORRECTION' | 'MASTER_DATA_METADATA_CORRECTION';
export type GovernanceRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type GovernanceReviewMode = 'PRE' | 'POST';
export type GovernanceStatus =
  | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXECUTING'
  | 'SUCCEEDED' | 'FAILED' | 'PENDING_POST_REVIEW' | 'CONFIRMED' | 'FLAGGED';
export type GovernanceDecision = 'APPROVE' | 'REJECT' | 'CONFIRM' | 'FLAG';
export type GovernanceListScope = 'mine' | 'reviewable' | 'all';

export interface GovernanceCatalogEntry {
  operationType: GovernedOperationType;
  riskLevel: GovernanceRisk;
  reviewMode: GovernanceReviewMode;
  requesterRoles: Array<'SYSTEM_ADMIN' | 'SYSTEM_SUPER_ADMIN'>;
  adapterKey: 'administrator-account' | 'master-data' | 'sop-template';
  retryable: boolean;
  confirmationTemplate?: string;
}

export interface GovernanceUserTarget {
  id: string;
  username: string;
  displayName: string | null;
  status: string;
  governanceVersion: number;
}

export interface AdminOperationSummary {
  id: string; operationNo: string; operationType: GovernedOperationType; riskLevel: GovernanceRisk;
  reviewMode: GovernanceReviewMode; status: GovernanceStatus; requesterUserId: string;
  targetType: string; targetId: string; reason: string; expectedTargetVersion: number;
  secondConfirmationAt: string | null; relatedOperationId: string | null; version: number;
  createdAt: string; updatedAt: string;
}

export interface AdminOperationReview {
  id: string; operationId: string; reviewerUserId: string; decision: GovernanceDecision;
  comment: string | null; operationVersion: number; createdAt: string;
}

export interface AdminOperationExecution {
  id: string; operationId: string; attemptNo: number; executorType: 'SYSTEM' | 'CLI';
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; beforeSnapshot: unknown; afterSnapshot: unknown;
  resultCode: string | null; errorMessage: string | null; startedAt: string; finishedAt: string | null;
}

export interface AdminOperationDetail extends AdminOperationSummary {
  payloadSnapshot: unknown;
  reviews: AdminOperationReview[];
  executions: AdminOperationExecution[];
}

export interface GovernancePage<T> {
  list: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface GovernanceListQuery {
  scope?: GovernanceListScope; status?: GovernanceStatus; operationType?: GovernedOperationType;
  requesterUserId?: string; from?: string; to?: string; page?: number; pageSize?: number;
}

export interface CreateGovernanceOperationInput {
  operationType: GovernedOperationType; targetType: string; targetId: string; reason: string;
  expectedTargetVersion: number; payload: Record<string, unknown>; idempotencyKey: string;
  confirmation?: string;
}

export interface ReviewGovernanceOperationInput {
  decision: GovernanceDecision; comment?: string; expectedOperationVersion: number;
}
export interface VersionedGovernanceAction { expectedOperationVersion: number }
