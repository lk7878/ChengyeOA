import { matchPath } from 'react-router';
import { isAuthorizationSummaryExpired } from '../authorization/api';
import type { AuthorizationSummary, PermissionCode } from '../authorization/types';

export const areas = [
  { id: 'home', title: '工作台', path: '/', description: '待办、通知与常用入口' },
  { id: 'drive', title: '云盘', path: '/workspaces', description: '组织资源与多维表格' },
  { id: 'apps', title: '业务应用', path: '/apps', description: '客户经营、签约交付与业务办理' },
  { id: 'analytics', title: '数据分析', path: '/analytics', description: '经营、绩效与数据质量' },
  { id: 'admin', title: '管理中心', path: '/admin', description: '组织、人员、授权与系统治理' },
] as const;
export type Area = (typeof areas)[number]['id'];
export interface NavigationEntry {
  path: string;
  title: string;
  area: Area;
  group: string;
  required?: PermissionCode[];
  anyOf?: PermissionCode[][];
  superAdminOnly?: boolean;
  hidden?: boolean;
  parent?: string;
  global?: boolean;
}
const org: PermissionCode[] = ['menu.organization_personnel'];
const stock: PermissionCode[] = ['menu.inventory', 'inventory.read'];
const lead: PermissionCode[] = ['menu.lead_crm', 'lead.read'];
const customer: PermissionCode[] = ['menu.customer', 'customer.read'];
const contract: PermissionCode[] = ['menu.contract', 'contract.read'];
export const entries: NavigationEntry[] = [
  { path: '/', title: '工作台', area: 'home', group: '常用' },
  { path: '/workspaces', title: '云盘', area: 'drive', group: '资源' },
  { path: '/apps', title: '业务应用', area: 'apps', group: '全部应用' },
  { path: '/analytics', title: '数据分析', area: 'analytics', group: '全部分析' },
  { path: '/admin', title: '管理中心', area: 'admin', group: '全部管理' },
  { path: '/approvals', title: '审批中心', area: 'home', group: '待办与通知', required: ['approval.read'] },
  {
    path: '/approval-ledger',
    title: '审批台账',
    area: 'home',
    group: '待办与通知',
    required: ['approval.read'],
  },
  { path: '/notifications', title: '通知中心', area: 'home', group: '待办与通知' },
  {
    path: '/security/my-access',
    title: '我的权限',
    area: 'home',
    group: '个人设置',
    required: ['menu.security_my_access', 'permission.trace.self'],
  },
  { path: '/security/account', title: '账号安全', area: 'home', group: '个人设置' },
  { path: '/leads', title: '线索列表', area: 'apps', group: '客户经营', required: lead },
  { path: '/leads/pool', title: '公海池', area: 'apps', group: '客户经营', required: lead },
  {
    path: '/leads/calendar',
    title: '到访日历',
    area: 'apps',
    group: '客户经营',
    required: ['menu.lead_crm', 'appointment.read'],
  },
  {
    path: '/leads/:id',
    title: '线索详情',
    area: 'apps',
    group: '客户经营',
    required: lead,
    hidden: true,
    parent: '/leads',
  },
  { path: '/customers', title: '客户管理', area: 'apps', group: '客户经营', required: customer },
  {
    path: '/customers/:id',
    title: '客户详情',
    area: 'apps',
    group: '客户经营',
    required: customer,
    hidden: true,
    parent: '/customers',
  },
  { path: '/channels', title: '渠道管理', area: 'apps', group: '客户经营' },
  {
    path: '/negotiations',
    title: '谈案管理',
    area: 'apps',
    group: '签约交付',
    required: ['menu.contract', 'negotiation.read'],
  },
  { path: '/contracts', title: '合同管理', area: 'apps', group: '签约交付', required: contract },
  {
    path: '/contracts/new',
    title: '新建合同',
    area: 'apps',
    group: '签约交付',
    required: ['menu.contract', 'contract.create'],
    hidden: true,
    parent: '/contracts',
  },
  {
    path: '/contracts/:id',
    title: '合同详情',
    area: 'apps',
    group: '签约交付',
    required: contract,
    hidden: true,
    parent: '/contracts',
  },
  { path: '/cases', title: '案件管理', area: 'apps', group: '签约交付', required: ['case.read'] },
  {
    path: '/payments',
    title: '收款管理',
    area: 'apps',
    group: '财务运营',
    required: ['menu.payment', 'payment.read'],
  },
  {
    path: '/invoices',
    title: '开票管理',
    area: 'apps',
    group: '财务运营',
    required: ['menu.invoice', 'invoice.read'],
  },
  {
    path: '/refunds',
    title: '退款减免',
    area: 'apps',
    group: '财务运营',
    required: ['menu.refund', 'refund.read'],
  },
  {
    path: '/costs',
    title: '成本管理',
    area: 'apps',
    group: '财务运营',
    required: ['menu.cost', 'cost.read'],
  },
  {
    path: '/finance',
    title: '财务工作区',
    area: 'apps',
    group: '财务运营',
    hidden: true,
    anyOf: [
      ['menu.payment', 'payment.read'],
      ['menu.invoice', 'invoice.read'],
      ['menu.refund', 'refund.read'],
    ],
  },
  ...[
    ['items', '物品档案与库存'],
    ['customized-records', '定制物品领用登记'],
    ['office-records', '办公用品领用明细'],
    ['inbound', '入库明细'],
    ['outbound', '出库明细'],
    ['stocktakes', '定期物品盘点记录'],
  ].map(
    ([path, title]): NavigationEntry => ({
      path: '/inventory/' + path,
      title,
      area: 'apps',
      group: '物品管理',
      required: stock,
    }),
  ),
  ...[
    ['customized-statistics', '定制物品领用统计'],
    ['office-statistics', '办公用品领用统计'],
    ['dashboard', '物品领用仪表盘'],
  ].map(
    ([path, title]): NavigationEntry => ({
      path: '/inventory/' + path,
      title,
      area: 'analytics',
      group: '库存分析',
      required: stock,
    }),
  ),
  {
    path: '/inventory',
    title: '物品领用仪表盘',
    area: 'analytics',
    group: '库存分析',
    required: stock,
    hidden: true,
    parent: '/inventory/dashboard',
  },
  { path: '/analytics/overview', title: '经营概览', area: 'analytics', group: '经营分析' },
  {
    path: '/performances',
    title: '绩效管理',
    area: 'analytics',
    group: '绩效分析',
    required: ['performance.read'],
  },
  {
    path: '/anomalies',
    title: '异常数据',
    area: 'analytics',
    group: '数据质量',
    required: ['menu.anomaly', 'anomaly.read'],
  },
  {
    path: '/org/tree',
    title: '组织架构',
    area: 'admin',
    group: '组织与人员',
    required: [...org, 'menu.organization', 'organization.read'],
    superAdminOnly: true,
  },
  {
    path: '/org/positions',
    title: '岗位管理',
    area: 'admin',
    group: '组织与人员',
    required: [...org, 'menu.position', 'position.read'],
  },
  {
    path: '/org/employees',
    title: '员工管理',
    area: 'admin',
    group: '组织与人员',
    required: [...org, 'menu.employee', 'employee.read'],
  },
  {
    path: '/org/professional-teams',
    title: '专业团队',
    area: 'admin',
    group: '组织与人员',
    required: [...org, 'menu.professional_team', 'professional_team.read'],
  },
  { path: '/users', title: '账号管理', area: 'admin', group: '身份授权', required: ['user.read'] },
  {
    path: '/security/roles',
    title: '角色权限',
    area: 'admin',
    group: '身份授权',
    required: ['menu.security_roles', 'role.read'],
  },
  {
    path: '/security/users',
    title: '用户授权',
    area: 'admin',
    group: '身份授权',
    required: ['menu.security_users', 'user.read'],
  },
  {
    path: '/security/trace',
    title: '权限追踪',
    area: 'admin',
    group: '身份授权',
    required: ['menu.security_trace', 'permission.trace.any'],
  },
  {
    path: '/security/admin-governance',
    title: '管理员治理',
    area: 'admin',
    group: '系统治理',
    required: ['menu.admin_governance', 'governance.catalog.read'],
  },
  {
    path: '/security/event-operations',
    title: '事件运维',
    area: 'admin',
    group: '系统治理',
    required: ['menu.event_operations', 'event.delivery.read'],
  },
  {
    path: '/knowledge',
    title: '知识库',
    area: 'home',
    group: '全局工具',
    required: ['menu.knowledge'],
    global: true,
  },
  {
    path: '/smart-case',
    title: '智慧办案',
    area: 'home',
    group: '全局工具',
    required: ['menu.smart_case'],
    global: true,
  },
];
export const legacyRedirects: Record<string, string> = {
  '/organizations': '/org/tree',
  '/employees': '/org/employees',
  '/roles': '/security/roles',
};
export function findEntry(pathname: string): NavigationEntry | undefined {
  pathname = pathname.replace(/\/+$/, '') || '/';
  return (
    entries.find((entry) => entry.path === pathname) ||
    entries.find((entry) => entry.path.includes(':') && matchPath({ path: entry.path, end: true }, pathname))
  );
}
export function canOpen(entry: NavigationEntry, authorization: AuthorizationSummary | null): boolean {
  if (isAuthorizationSummaryExpired(authorization)) return false;
  if (entry.superAdminOnly && !authorization!.isSystemSuperAdmin) return false;
  const has = (code: PermissionCode) =>
    code.startsWith('menu.')
      ? authorization!.menus.some((menu) => menu === code)
      : authorization!.permissions.includes(code);
  return (entry.required ?? []).every(has) && (!entry.anyOf || entry.anyOf.some((group) => group.every(has)));
}
export function visibleEntries(authorization: AuthorizationSummary | null, area?: Area) {
  return entries.filter(
    (entry) =>
      !entry.hidden && !entry.global && (!area || entry.area === area) && canOpen(entry, authorization),
  );
}
