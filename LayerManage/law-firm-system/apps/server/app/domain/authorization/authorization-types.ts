export type PermissionType = 'MENU' | 'ACTION' | 'SPECIAL';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type PermissionStatus = 'ENABLED' | 'DISABLED';
export type ScopeType =
  | 'ALL'
  | 'HQ_SCOPE'
  | 'ORG'
  | 'BRANCH'
  | 'TEAM'
  | 'SELF_AND_SUBORDINATES'
  | 'SELF'
  | 'CUSTOM';
export type FieldReadLevel = 'NONE' | 'MASKED' | 'READ';
export type DataClassification = 'L1' | 'L2' | 'L3' | 'L4' | 'FORBIDDEN';

export const RESOURCE_CODES = [
  'sop_instance', 'sop_task',
  'sop_template',
  'channel',
  'workspace',
  'inventory',
  'menu',
  'organization',
  'position',
  'employee',
  'employee_assignment',
  'employee_reporting_line',
  'employee_account_binding',
  'professional_team',
  'professional_team_member',
  'user',
  'user_role',
  'user_role_membership',
  'role',
  'permission',
  'temporary_grant',
  'governance',
  'event_delivery',
  'appointment',
  'campaign',
  'lead',
  'customer',
  'negotiation',
  'invoice',
  'contract',
  'payment',
  'refund',
  'cost',
  'anomaly',
  'matter',
  'file',
  'data',
  'config',
  'approval',
  'case',
  // SPEC-037 追加（绩效域资源）。
  'performance',
] as const;

export type ResourceCode = (typeof RESOURCE_CODES)[number];

export const FIELD_CODES = [
  'employee.phone',
  'employee.email',
  'employee.licenseNo',
  'employee.professionalDirections',
  'employee.idCard',
  'lead.phone',
  'lead.wechat',
  'customer.phone',
  'customer.wechat',
] as const;

export type FieldCode = (typeof FIELD_CODES)[number];

export const PERMISSION_CODES = [
  'menu.quality',
  'quality.assessment.read',
  'quality.assessment.record',
  'quality.analysis.read',
  'quality.analysis.manage',
  'quality.analysis.close',
  'quality.analysis.decide',
  'quality.metric.read',
  'quality.sample.read',
  'quality.sample.manage',
  'quality.inspection.read',
  'quality.inspection.record',
  'quality.issue.read',
  'quality.issue.manage',
  'quality.issue.resolve',
  'quality.issue.verify',
  'sop.report.read',
  'sop.report.submit',
  'sop.guidance.read',
  'sop.guidance.create',
  'sop.material.read',
  'sop.material.manage',
  'quality.review.read',
  'quality.review.assign',
  'quality.review.decide',
  'menu.sop_tasks', 'sop.instance.read', 'sop.instance.start', 'sop.instance.manage', 'sop.task.read', 'sop.task.execute', 'sop.task.manage',
  'menu.sop_templates', 'sop.template.read', 'sop.template.manage', 'sop.template.publish',
  'menu.channel',
  'channel.read',
  'channel.create',
  'channel.update',
  'channel.delete',
  'workspace.create',
  'menu.knowledge',
  'menu.smart_case',
  'menu.inventory',
  'inventory.read',
  'inventory.seal.review',
  'inventory.manage',
  'inventory.inbound',
  'inventory.outbound',
  'inventory.stocktake',
  'inventory.export',
  'menu.organization_personnel',
  'menu.organization',
  'menu.position',
  'menu.employee',
  'menu.professional_team',
  'menu.security_my_access',
  'menu.security_roles',
  'menu.security_users',
  'menu.security_trace',
  'organization.read',
  'organization.create',
  'organization.update',
  'organization.move',
  'organization.status.manage',
  'position.read',
  'position.create',
  'position.update',
  'position.delete',
  'position.status.manage',
  'employee.read',
  'employee.create',
  'employee.update',
  'employee.formalize',
  'employee.leave',
  'employee.assignment.read',
  'employee.assignment.manage',
  'employee.reporting_line.read',
  'employee.reporting_line.manage',
  'employee.account_binding.read',
  'employee.account_binding.manage',
  'professional_team.read',
  'professional_team.create',
  'professional_team.update',
  'professional_team.status.manage',
  'professional_team.member.manage',
  'professional_team.lead.manage',
  'user.read',
  'user.create',
  'user.update',
  'user.status.manage',
  'user.password.reset',
  'role.read',
  'role.create',
  'role.update',
  'role.status.manage',
  'role.permission.manage',
  'user.role.manage',
  'permission.catalog.read',
  'permission.trace.self',
  'permission.trace.any',
  'temporary_grant.manage',
  'employee.sensitive.read',
  'employee.high_sensitive.read',
  'employee.sensitive.export',
  'customer.merge',
  'contract.void',
  'payment.confirm',
  'refund.approve',
  'matter.intervene',
  'file.sensitive.download',
  'data.bulk_export',
  'config.publish',
  'config.high_risk.change',
  'menu.admin_governance',
  'governance.catalog.read',
  'governance.operation.create',
  'governance.operation.read_self',
  'governance.operation.read_all',
  'governance.review',
  'governance.retry',
  'governance.audit.read',
  'menu.event_operations',
  'event.delivery.read',
  'event.delivery.retry',

  'menu.lead_crm',
  'menu.customer',
  'lead.read',
  'lead.create',
  'lead.update',
  'lead.delete',
  'lead.follow.delete',
  'lead.assign',
  'lead.recycle',
  'lead.convert',
  'lead.pool.claim',
  'appointment.read',
  'appointment.create',
  'appointment.visit',
  'customer.read',
  'customer.create',
  'customer.update',
  'customer.delete',

  'menu.contract',
  'menu.payment',
  'negotiation.read',
  'negotiation.create',
  'negotiation.update',
  'negotiation.delete',
  'contract.read',
  'contract.create',
  'contract.submit',
  'contract.update',
  'contract.delete',
  'contract.approve',
  'contract.sign',
  'contract.effect',
  'contract.terminate',
  'payment.read',
  'payment.create',

  'menu.invoice',
  'menu.refund',
  'menu.cost',
  'menu.anomaly',
  'invoice.read',
  'invoice.create',
  'invoice.approve',
  'invoice.complete',
  'refund.read',
  'refund.create',
  'refund.execute',
  'payment.void',
  'cost.read',
  'cost.create',
  'cost.update',
  'cost.delete',
  'anomaly.read',

  // SPEC-013 Task 2 追加（审批中心三码，仅追加不改动既有行；计数 118→121）
  'approval.read',
  'approval.apply',
  'approval.process',

  // SPEC-017 Task 1 追加（审批定义管理码；计数 121→122）
  'approval.manage',

  // SPEC-015 follow-up 追加（业务角色成员指派码；计数 122→123）
  'user_role.membership.manage',

  // SPEC-033 追加（案件办理域六码；计数 124→130）
  'case.read',
  'case.create',
  'case.update',
  'case.delete',
  'case.close',
  'case.task.manage',
  'case.communication.create',

  // SPEC-037 追加（绩效域三码；计数 129→132）
  'performance.read',
  'performance.create',
  'performance.confirm',

  // SPEC-042 追加（案件文件/证据域二码；计数 132→134）
  'case.file.read',
  'case.file.manage',

  // SPEC-043 追加（绩效考核流程一码——目标设定/自评自助动作；计数 134→135）
  'performance.update',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export interface PermissionCatalogEntry {
  readonly id: `permission:${PermissionCode}`;
  readonly code: PermissionCode;
  readonly name: string;
  readonly type: PermissionType;
  readonly resource: ResourceCode;
  readonly action: string;
  readonly riskLevel: RiskLevel;
  readonly status: PermissionStatus;
  readonly route: string | null;
}
