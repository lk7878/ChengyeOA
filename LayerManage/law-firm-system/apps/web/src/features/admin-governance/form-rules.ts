import type { GovernedOperationType } from './types';

export type MasterTargetType = 'ORGANIZATION' | 'POSITION' | 'PROFESSIONAL_TEAM';

export const OPERATION_LABELS: Readonly<Record<GovernedOperationType, string>> = Object.freeze({
  SOP_TEMPLATE_PUBLISH: '发布SOP模板', SOP_TEMPLATE_DISABLE: '停用SOP模板',
  SYSTEM_ADMIN_GRANT: '授予系统管理员', SYSTEM_ADMIN_REVOKE: '撤销系统管理员',
  SYSTEM_ADMIN_ACCOUNT_DISABLE: '停用系统管理员账户', SUPER_ADMIN_GRANT: '授予超级管理员',
  SUPER_ADMIN_REVOKE: '撤销超级管理员', SUPER_ADMIN_ACCOUNT_DISABLE: '停用超级管理员账户',
  ADMIN_MFA_RESET: '重置管理员验证器',
  MASTER_DATA_STATUS_CORRECTION: '主数据状态纠正', MASTER_DATA_METADATA_CORRECTION: '主数据元数据纠正',
});

export function metadataFieldForTarget(targetType: MasterTargetType): { key: 'sort' | 'responsibilities' | 'description'; label: string } {
  if (targetType === 'ORGANIZATION') return { key: 'sort', label: '排序' };
  if (targetType === 'POSITION') return { key: 'responsibilities', label: '岗位职责' };
  return { key: 'description', label: '团队说明' };
}

export function confirmationPhrase(template: string, targetUsername: string): string {
  return template.replaceAll('{targetUsername}', targetUsername);
}

// Match the server policy for create, approval and retry without lowering the risk classification.
export function requiresGovernanceStepUp(riskLevel: string, operationType: GovernedOperationType): boolean {
  if (operationType === 'SUPER_ADMIN_GRANT' || operationType === 'ADMIN_MFA_RESET') return false;
  return riskLevel === 'HIGH' || riskLevel === 'CRITICAL';
}
