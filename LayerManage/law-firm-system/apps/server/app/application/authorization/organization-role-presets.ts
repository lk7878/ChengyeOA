import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PERMISSION_CATALOG } from '../../domain/authorization/permission-catalog';
import { FIELD_CATALOG } from '../../domain/authorization/field-security-policy';

export const ORGANIZATION_ROLE_NAMES = {
  PARTNER: '合伙人', BRANCH_ADMIN: '分所管理员', LAWYER: '律师', RECEPTION: '前台', ADMIN: '行政', FINANCE: '财务', HR: '人事',
} as const;
export type OrganizationRoleKey = keyof typeof ORGANIZATION_ROLE_NAMES;
const common = ['organization.read', 'position.read', 'employee.read', 'professional_team.read', 'workspace.create', 'permission.trace.self', 'menu.security_my_access'];
const master = ['employee', 'employee_assignment', 'employee_reporting_line', 'employee_account_binding', 'professional_team', 'professional_team_member', 'position'];
const resources: Record<OrganizationRoleKey, string[]> = {
  PARTNER: [...master, 'case', 'customer', 'lead', 'contract', 'approval', 'performance', 'sop_instance', 'sop_task'],
  BRANCH_ADMIN: [...master, 'user', 'inventory', 'approval'],
  LAWYER: ['case', 'customer', 'contract', 'approval', 'sop_instance', 'sop_task'],
  RECEPTION: ['lead', 'customer', 'appointment', 'approval'],
  ADMIN: ['inventory', 'approval'],
  FINANCE: ['invoice', 'payment', 'refund', 'cost', 'anomaly', 'approval'],
  HR: [...master.filter(r => r !== 'position'), 'approval'],
};
const menus: Record<OrganizationRoleKey, string[]> = {
  PARTNER: ['menu.organization_personnel', 'menu.position', 'menu.employee', 'menu.professional_team', 'menu.customer', 'menu.lead_crm', 'menu.contract', 'menu.sop_tasks'],
  BRANCH_ADMIN: ['menu.organization_personnel', 'menu.position', 'menu.employee', 'menu.professional_team', 'menu.inventory'],
  LAWYER: ['menu.customer', 'menu.contract', 'menu.sop_tasks'],
  RECEPTION: ['menu.lead_crm', 'menu.customer'], ADMIN: ['menu.inventory'],
  FINANCE: ['menu.invoice', 'menu.payment', 'menu.refund', 'menu.cost', 'menu.anomaly'],
  HR: ['menu.organization_personnel', 'menu.position', 'menu.employee', 'menu.professional_team'],
};

// Explicit provisioning; never silently escalates permissions on an existing configured role.
export async function provisionOrganizationRoles(tx: Prisma.TransactionClient, organizationId: string) {
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const scopeId = `oa-role-scope:${organizationId}`;
  await tx.dataScope.upsert({ where: { id: scopeId }, update: {}, create: { id: scopeId, name: `${organization.name}及下属部门`, scopeType: 'ORG', organizationId, includeDescendants: true } });
  await tx.dataScope.upsert({ where: { id: 'oa-role-scope:self' }, update: {}, create: { id: 'oa-role-scope:self', name: '本人数据', scopeType: 'SELF' } });
  const result: Record<string, string> = {};
  for (const key of Object.keys(ORGANIZATION_ROLE_NAMES) as OrganizationRoleKey[]) {
    const code = `OA_${createHash('sha256').update(organizationId).digest('hex').slice(0, 8).toUpperCase()}_${key}`;
    const existing = await tx.role.findUnique({ where: { code } });
    if (existing) { result[key] = existing.id; continue; }
    const selected = PERMISSION_CATALOG.filter(p => common.includes(p.code) || menus[key].includes(p.code) || (
      p.type === 'ACTION' && resources[key].includes(p.resource) && !['user.password.reset', 'user.status.manage'].includes(p.code)
      && (p.code !== 'position.delete' || key === 'BRANCH_ADMIN' || key === 'PARTNER')
    ));
    const role = await tx.role.create({ data: { code, name: `${organization.name}·${ORGANIZATION_ROLE_NAMES[key]}`, type: 'BUSINESS', description: '按所属律所配置的岗位权限；文档共享另按资源授权。' } });
    await tx.rolePermission.createMany({ data: selected.map(p => ({ roleId: role.id, permissionId: p.id })) });
    const allResources = [...new Set(selected.filter(p => p.type !== 'MENU').map(p => p.resource))];
    const personnelManager = ['PARTNER', 'BRANCH_ADMIN', 'HR'].includes(key);
    await tx.roleDataScope.createMany({ data: allResources.map(resource => ({ roleId: role.id, resource, dataScopeId: resource === 'employee' && !personnelManager ? 'oa-role-scope:self' : scopeId })) });
    if (personnelManager) await tx.fieldPermission.createMany({ data: FIELD_CATALOG.filter(field => field.resource === 'employee' && field.classification !== 'FORBIDDEN').map(field => ({ roleId: role.id, resource: field.resource, fieldCode: field.code, readLevel: field.classification === 'L4' ? 'MASKED' : 'READ', canWrite: true, canExport: false })) });
    result[key] = role.id;
  }
  return result;
}
