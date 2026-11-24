import { PERMISSION_CATALOG } from '../../domain/authorization/permission-catalog';
import type { PermissionCode } from '../../domain/authorization/authorization-types';

// No worksheet-backed operations here. Table grants remain resource-local.
export const otherFunctionGroups = [
  { id: 'case_seal', name: '合同核对与盖章', resources: [], codes: ['case.seal.manage'], menus: [] },
  { id: 'approval', name: '审批处理', resources: ['approval'], codes: ['approval.read', 'approval.apply', 'approval.process'], menus: [] },
  { id: 'organization', name: '组织管理', resources: ['organization'], codes: ['organization.read', 'organization.create', 'organization.update', 'organization.move', 'organization.status.manage'], menus: ['menu.organization_personnel', 'menu.organization'] },
  { id: 'position', name: '岗位管理', resources: ['position'], codes: ['position.read', 'position.create', 'position.update', 'position.status.manage', 'position.delete'], menus: ['menu.organization_personnel', 'menu.position'] },
  { id: 'employee', name: '员工与任职管理', resources: ['employee', 'employee_assignment', 'employee_reporting_line'], codes: ['employee.read', 'employee.create', 'employee.update', 'employee.formalize', 'employee.leave', 'employee.assignment.read', 'employee.assignment.manage', 'employee.reporting_line.read', 'employee.reporting_line.manage'], menus: ['menu.organization_personnel', 'menu.employee'] },
  { id: 'professional_team', name: '专业团队管理', resources: ['professional_team', 'professional_team_member'], codes: ['professional_team.read', 'professional_team.create', 'professional_team.update', 'professional_team.status.manage', 'professional_team.member.manage', 'professional_team.lead.manage'], menus: ['menu.organization_personnel', 'menu.professional_team'] },
];
export function functionCodes(group: typeof otherFunctionGroups[number], requested: string[]): PermissionCode[] {
  const resources = new Set(PERMISSION_CATALOG.filter(p=>requested.includes(p.code)).map(p=>p.resource));
  const reads = PERMISSION_CATALOG.filter(p=>resources.has(p.resource)&&p.action==='read'&&group.codes.includes(p.code)).map(p=>p.code);
  return [...new Set([...requested, ...(requested.length ? [...reads, ...group.menus] : [])])] as PermissionCode[];
}
