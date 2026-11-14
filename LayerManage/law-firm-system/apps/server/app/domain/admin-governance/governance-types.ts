export const GOVERNED_OPERATION_TYPES = Object.freeze([
  'SOP_TEMPLATE_PUBLISH', 'SOP_TEMPLATE_DISABLE',
  'SYSTEM_ADMIN_GRANT',
  'SYSTEM_ADMIN_REVOKE',
  'SYSTEM_ADMIN_ACCOUNT_DISABLE',
  'SUPER_ADMIN_GRANT',
  'SUPER_ADMIN_REVOKE',
  'SUPER_ADMIN_ACCOUNT_DISABLE',
  'ADMIN_MFA_RESET',
  'MASTER_DATA_STATUS_CORRECTION',
  'MASTER_DATA_METADATA_CORRECTION',
] as const);

export type GovernedOperationType = typeof GOVERNED_OPERATION_TYPES[number];
export type GovernanceRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type GovernanceReviewMode = 'PRE' | 'POST';
export type GovernanceStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXECUTING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PENDING_POST_REVIEW'
  | 'CONFIRMED'
  | 'FLAGGED';
export type GovernanceDecision = 'APPROVE' | 'REJECT' | 'CONFIRM' | 'FLAG';
export type GovernanceRequesterRole = 'SYSTEM_ADMIN' | 'SYSTEM_SUPER_ADMIN';
export type GovernanceAdapterKey = 'administrator-account' | 'master-data' | 'sop-template';

export interface GovernedOperationCatalogEntry {
  readonly riskLevel: GovernanceRisk;
  readonly reviewMode: GovernanceReviewMode;
  readonly requesterRoles: readonly GovernanceRequesterRole[];
  readonly adapterKey: GovernanceAdapterKey;
  readonly retryable: boolean;
  readonly confirmationTemplate?: string;
}
