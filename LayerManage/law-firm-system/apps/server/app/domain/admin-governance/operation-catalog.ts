import {
  GOVERNED_OPERATION_TYPES,
  GovernedOperationCatalogEntry,
  GovernedOperationType,
  GovernanceRequesterRole,
  GovernanceReviewMode,
  GovernanceRisk,
} from './governance-types';

const SUPER_ADMIN_ONLY = Object.freeze(['SYSTEM_SUPER_ADMIN'] as const);
const ADMINISTRATORS = Object.freeze(['SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN'] as const);
const CRITICAL_CONFIRMATION = 'CONFIRM {databaseName} {operationType} {targetUsername}';

function entry(
  riskLevel: GovernanceRisk,
  reviewMode: GovernanceReviewMode,
  requesterRoles: readonly GovernanceRequesterRole[],
  adapterKey: GovernedOperationCatalogEntry['adapterKey'],
  retryable: boolean,
  confirmationTemplate?: string,
): GovernedOperationCatalogEntry {
  return Object.freeze({
    riskLevel,
    reviewMode,
    requesterRoles: Object.freeze([...requesterRoles]),
    adapterKey,
    retryable,
    ...(confirmationTemplate === undefined ? {} : { confirmationTemplate }),
  });
}

const catalog = {
  SOP_TEMPLATE_PUBLISH: entry('HIGH', 'PRE', ADMINISTRATORS, 'sop-template', true),
  SOP_TEMPLATE_DISABLE: entry('HIGH', 'PRE', ADMINISTRATORS, 'sop-template', true),
  SYSTEM_ADMIN_GRANT: entry('HIGH', 'PRE', SUPER_ADMIN_ONLY, 'administrator-account', true),
  SYSTEM_ADMIN_REVOKE: entry('HIGH', 'PRE', SUPER_ADMIN_ONLY, 'administrator-account', true),
  SYSTEM_ADMIN_ACCOUNT_DISABLE: entry('HIGH', 'PRE', SUPER_ADMIN_ONLY, 'administrator-account', true),
  SUPER_ADMIN_GRANT: entry('CRITICAL', 'PRE', SUPER_ADMIN_ONLY, 'administrator-account', true, CRITICAL_CONFIRMATION),
  SUPER_ADMIN_REVOKE: entry('CRITICAL', 'PRE', SUPER_ADMIN_ONLY, 'administrator-account', true, CRITICAL_CONFIRMATION),
  SUPER_ADMIN_ACCOUNT_DISABLE: entry('CRITICAL', 'PRE', SUPER_ADMIN_ONLY, 'administrator-account', true, CRITICAL_CONFIRMATION),
  ADMIN_MFA_RESET: entry('CRITICAL', 'PRE', SUPER_ADMIN_ONLY, 'administrator-account', true, CRITICAL_CONFIRMATION),
  MASTER_DATA_STATUS_CORRECTION: entry('HIGH', 'PRE', ADMINISTRATORS, 'master-data', true),
  MASTER_DATA_METADATA_CORRECTION: entry('LOW', 'POST', ADMINISTRATORS, 'master-data', true),
} satisfies Record<GovernedOperationType, GovernedOperationCatalogEntry>;

validateCatalog(catalog);

export const GOVERNED_OPERATION_CATALOG: Readonly<Record<GovernedOperationType, GovernedOperationCatalogEntry>> =
  Object.freeze(catalog);

function validateCatalog(value: Record<GovernedOperationType, GovernedOperationCatalogEntry>): void {
  const keys = Object.keys(value);
  if (keys.length !== GOVERNED_OPERATION_TYPES.length || new Set(keys).size !== keys.length) {
    throw new Error('Governed operation catalog must contain every operation type exactly once');
  }
  for (const operationType of GOVERNED_OPERATION_TYPES) {
    const item = value[operationType];
    if (item.riskLevel === 'CRITICAL' && !item.confirmationTemplate) {
      throw new Error(`Critical operation ${operationType} requires a confirmation template`);
    }
  }
}
