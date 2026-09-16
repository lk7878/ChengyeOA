export const PERMISSION_CODES = [
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
  // SPEC-009 Task 11 追加（镜像服务端 authorization-types.ts:136-150，仅追加不改动既有行）
  'menu.lead_crm',
  'menu.customer',
  'lead.read',
  'lead.create',
  'lead.update',
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
  // SPEC-010 Task 11 追加（镜像服务端 authorization-types.ts:153-166，仅追加不改动既有行；
  // contract.void/payment.confirm 已于 SPEC-004 预置（上方 SPECIAL 段），不重复追加——合计 +16 码）
  'menu.contract',
  'menu.payment',
  'negotiation.read',
  'negotiation.create',
  'negotiation.update',
  'contract.read',
  'contract.create',
  'contract.submit',
  'contract.approve',
  'contract.sign',
  'contract.effect',
  'contract.terminate',
  'payment.read',
  'payment.create',
  // SPEC-011 Task 2 追加（镜像服务端 authorization-types.ts PERMISSION_CODES 尾段，仅追加不改动既有行；
  // refund.approve 已于 SPEC-004 预置不重复——合计 +17 码）
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
  // SPEC-013 Task 2 追加（镜像服务端 authorization-types.ts PERMISSION_CODES 尾段，仅追加不改动既有行；
  // 审批中心三码——合计 +3 码，服务端计数 118→121）
  'approval.read',
  'approval.apply',
  'approval.process',
  // SPEC-017 Task 3 追加（镜像服务端 authorization-types.ts PERMISSION_CODES 尾段，仅追加不改动既有行；
  // 定义管理码——合计 +1 码，服务端计数 121→122；前端审批中心「定义管理」Tab 门控 + 角色授予目录）
  'approval.manage',

  // SPEC-015 follow-up 追加（镜像服务端 authorization-types.ts PERMISSION_CODES 尾段；业务角色成员
  // 指派码——合计 +1 码，服务端计数 122→123；SecurityRole 页「成员」Tab 门控 + 角色授予目录）
  'user_role.membership.manage',
  // SPEC-033 Task 3 追加（镜像服务端 authorization-types.ts PERMISSION_CODES 尾段；案件办理域六码——
  // 合计 +6 码，服务端计数 124→130；Case 页列表/详情/新建/结案按钮门控 + 角色授予目录）
  'case.read',
  'case.create',
  'case.update',
  'case.delete',
  'case.close',
  'case.task.manage',
  'case.communication.create',
  // SPEC-037 Task 3 追加（镜像服务端 authorization-types.ts PERMISSION_CODES 尾段；绩效域三码——
  // 合计 +3 码，服务端计数 129→132；Performance 页列表/录入/确认按钮门控 + 角色授予目录）
  'performance.read',
  'performance.create',
  'performance.confirm',
  // SPEC-042 Task 3 追加（镜像服务端 authorization-types.ts PERMISSION_CODES 尾段；案件文件域二码——
  // 合计 +2 码，服务端计数 132→134；Case 页文件区列表/上传/下载/删除门控 + 角色授予目录）
  'case.file.read',
  'case.file.manage',
  // SPEC-043 Task 3 追加（镜像服务端 authorization-types.ts PERMISSION_CODES 尾段；绩效考核流程一码——
  // 合计 +1 码，服务端计数 134→135；Performance 页目标设定/自评按钮门控 + 角色授予目录）
  'performance.update',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];
export type MenuPermissionCode = Extract<PermissionCode, `menu.${string}`>;
export type FieldReadLevel = 'NONE' | 'MASKED' | 'READ';

export interface FieldCapability {
  resource: string;
  fieldCode: string;
  readLevel: FieldReadLevel;
  canWrite: boolean;
  canExport: boolean;
}

export interface AuthorizationSummary {
  userId: string;
  employeeId: string | null;
  isSystemSuperAdmin: boolean;
  isSystemAdmin: boolean;
  permissions: PermissionCode[];
  menus: MenuPermissionCode[];
  fieldCapabilities: Record<string, FieldCapability>;
  validUntil: string | null;
  evaluatedAt: string;
}

export interface RawAuthorizationSummary {
  userId: string;
  employeeId: string | null;
  isSystemSuperAdmin: boolean;
  isSystemAdmin: boolean;
  evaluatedAt: string;
  permissionCodes: PermissionCode[];
  menuCodes: MenuPermissionCode[];
  grants: Array<{ validUntil: string | null }>;
  fieldCapabilities: Array<FieldCapability & { sourceRoleId: string }>;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type GrantState = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface PermissionCatalogEntry {
  id: string;
  code: PermissionCode;
  name: string;
  type: 'MENU' | 'ACTION' | 'SPECIAL';
  resource: string;
  action: string;
  riskLevel: RiskLevel;
  status: string;
  route: string | null;
}

export interface FieldCatalogEntry {
  code: string;
  resource: string;
  field: string;
  classification: 'L1' | 'L2' | 'L3' | 'L4';
  defaultReadLevel: FieldReadLevel;
}

export interface DataScopeOption {
  id: string;
  name: string;
  scopeType: string;
  includeDescendants: boolean;
  organization: { id: string; name: string } | null;
  professionalTeam: { id: string; name: string } | null;
}

export interface RoleAuthorizationView {
  id: string;
  name: string;
  code: string;
  type: string;
  description: string | null;
  status: string;
  version: number;
  permissionCodes: PermissionCode[];
  dataScopeBindings: Array<{ resource: string; dataScopeId: string; scopeType: string }>;
  fieldPermissions: Array<FieldCapability>;
}

export interface Page<T> {
  list: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface AuthorizationUser {
  id: string;
  username: string;
  status: string;
  employee: {
    id: string;
    name: string;
    employeeNo?: string;
    primaryAssignment?: { organizationId: string } | null;
  } | null;
  lastLoginAt: string | null;
}

export interface RoleGrant {
  id: string;
  userId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  source: 'PERMANENT' | 'TEMPORARY';
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
  version: number;
  state: GrantState;
}

/** per-role 成员视图（SPEC-015 follow-up）：角色成员列表项。 */
export interface RoleMember {
  id: string;
  userId: string;
  username: string;
  userStatus: string;
  source: 'PERMANENT' | 'TEMPORARY';
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
  version: number;
  state: GrantState;
}

export interface SpecialGrant {
  id: string;
  userId: string;
  permissionCode: PermissionCode;
  dataScopeId: string;
  scopeType: string;
  validFrom: string;
  validUntil: string;
  revokedAt: string | null;
  version: number;
  state: GrantState;
}

export interface UserAuthorizationView {
  userId: string;
  status: string;
  roleGrants: RoleGrant[];
  specialGrants: SpecialGrant[];
}

export interface PermissionTraceView {
  userId: string;
  employeeId: string | null;
  permissionCode: PermissionCode | null;
  allowed: boolean;
  refusalCode: string | null;
  evaluatedAt: string;
  sources: Array<{
    sourceType: string;
    sourceId: string;
    permissionCode: PermissionCode;
    scopeTypes: string[];
    validUntil: string | null;
    state: 'ACTIVE';
  }>;
  fieldCapabilities: Array<FieldCapability & { sourceRoleId: string }>;
}
