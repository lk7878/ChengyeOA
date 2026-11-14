import { matchPath } from 'react-router';
import { isAuthorizationSummaryExpired } from '../authorization/api';
import type { AuthorizationSummary, PermissionCode } from '../authorization/types';

export const areas = [
  { id: 'home', title: '承业中心', path: '/', description: '待办、通知与常用入口' },
  { id: 'drive', title: '承业空间', path: '/workspaces', description: '组织资源与多维表格' },
  { id: 'apps', title: '承业协作', path: '/apps', description: '客户经营、签约交付与业务办理' },
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
  retired?: boolean;
  parent?: string;
  global?: boolean;
}
const org: PermissionCode[] = ['menu.organization_personnel'];
const stock: PermissionCode[] = ['menu.inventory', 'inventory.read'];
const lead: PermissionCode[] = ['menu.lead_crm', 'lead.read'];
const customer: PermissionCode[] = ['menu.customer', 'customer.read'];
const contract: PermissionCode[] = ['menu.contract', 'contract.read'];
export const entries: NavigationEntry[] = [
  {path:'/admin/navigation',title:'菜单管理',area:'admin',group:'系统配置',superAdminOnly:true},
  {path:'/analytics/dashboards',title:'可视化仪表盘',area:'analytics',group:'自助分析'},
  {path:'/cases/:id/assessments',title:'百分制满意度',area:'apps',group:'质量管理',required:['quality.assessment.read','case.read'],hidden:true,parent:'/cases'},
  {path:'/quality/special-analyses',title:'专项分析',area:'apps',group:'质量管理',required:['menu.quality','quality.analysis.read','case.read']},
  {path:'/quality/special-analyses/:id',title:'专项分析办理',area:'apps',group:'质量管理',required:['quality.analysis.read','case.read'],hidden:true,parent:'/quality/special-analyses'},
  {path:'/analytics/quality',title:'交付质量',area:'analytics',group:'业务指标',required:['quality.metric.read','case.read']},

  {path:'/admin/quality-rules',title:'抽检策略',area:'admin',group:'流程与质检配置',required:['menu.quality','quality.sample.read']},
  {path:'/quality/runs',title:'抽检批次',area:'apps',group:'质量管理',required:['menu.quality','quality.sample.read']},
  {path:'/quality/runs/:id',title:'抽检批次详情',area:'apps',group:'质量管理',required:['quality.sample.read'],hidden:true,parent:'/quality/runs'},
  {path:'/quality/reviews',title:'二级抽检',area:'apps',group:'质量管理',required:['menu.quality','quality.inspection.read','case.read']},
  {path:'/quality/reviews/:id',title:'二级检查办理',area:'apps',group:'质量管理',required:['quality.inspection.read','case.read'],hidden:true,parent:'/quality/reviews'},
  {path:'/quality/issues',title:'质检整改',area:'apps',group:'质量管理',required:['menu.quality','quality.issue.read','case.read']},
  {path:'/quality/issues/:id',title:'整改办理',area:'apps',group:'质量管理',required:['quality.issue.read','case.read'],hidden:true,parent:'/quality/issues'},

  { path: '/sop/submissions/:id', title: 'SOP成果修订', area: 'apps', group: '签约交付', required: ['sop.task.read', 'sop.report.read'], hidden: true, parent: '/sop/tasks' },
  {path:'/sop/tasks',title:'SOP任务',area:'apps',group:'案件交付',required:['menu.sop_tasks','sop.task.read']},
  {path:'/sop/tasks/:id',title:'SOP任务办理',area:'apps',group:'案件交付',required:['sop.task.read'],hidden:true,parent:'/sop/tasks'},
  {path:'/sop/instances/new',title:'启动SOP',area:'apps',group:'案件交付',required:['sop.instance.start'],hidden:true,parent:'/sop/tasks'},
  {path:'/sop/instances/:id',title:'SOP流程',area:'apps',group:'案件交付',required:['sop.instance.read'],hidden:true,parent:'/sop/tasks'},
  { path:'/admin/sop-templates', title:'SOP模板', area:'admin', group:'流程与质检配置', required:['menu.sop_templates','sop.template.read'] },
  { path: '/', title: '承业中心', area: 'home', group: '常用' },
  { path: '/workspaces', title: '承业空间', area: 'drive', group: '资源' },
  { path: '/apps', title: '承业协作', area: 'apps', group: '全部应用' },
  { path: '/analytics', title: '数据分析', area: 'analytics', group: '全部分析' },
  { path: '/admin', title: '管理中心', area: 'admin', group: '全部管理' },
  { path: '/approvals', title: '审批中心', area: 'home', group: '待办与通知', required: ['approval.read'] },
  {
    path: '/approvals/visual',
    title: '可视化审批',
    area: 'home',
    group: '待办与通知',
    required: ['approval.read'],
    hidden: true,
    parent: '/approvals',
  },
  {
    path: '/approval-ledger',
    title: '审批运行监控',
    area: 'home',
    group: '待办与通知',
    required: ['approval.read'],
    hidden: true,
    parent: '/approvals',
  },
  { path: '/notifications', title: '通知中心', area: 'home', group: '待办与通知' },
  { path: '/calendar', title: '协同日历', area: 'home', group: '待办与通知' },
  {
    path: '/security/my-access',
    title: '我的权限',
    area: 'home',
    group: '个人设置',
    required: ['menu.security_my_access', 'permission.trace.self'],
  },
  { path: '/security/account', title: '账号安全', area: 'home', group: '个人设置' },
  { path: '/leads', title: '线索列表', area: 'apps', group: '客户经营', required: lead },
  { path: '/leads/follows', title: '跟进工作表', area: 'apps', group: '客户经营', required: lead },
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
  {
    path: '/customers/new',
    title: '新建客户',
    area: 'apps',
    group: '客户经营',
    required: ['menu.customer', 'customer.create'],
    hidden: true,
    parent: '/customers',
  },
  {
    path: '/negotiations/new',
    title: '新建谈案',
    area: 'apps',
    group: '签约交付',
    required: ['menu.contract', 'negotiation.create'],
    hidden: true,
    parent: '/negotiations',
  },
  {
    path: '/negotiations/:id',
    title: '谈案详情',
    area: 'apps',
    group: '签约交付',
    required: ['menu.contract', 'negotiation.read'],
    hidden: true,
    parent: '/negotiations',
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
  {
    path: '/channels',
    title: '渠道管理',
    area: 'apps',
    group: '客户经营',
    required: ['menu.channel', 'channel.read'],
  },
  {
    path: '/channels/new',
    title: '登记渠道',
    area: 'apps',
    group: '客户经营',
    parent: '/channels',
    hidden: true,
    required: ['menu.channel', 'channel.create'],
  },
  {
    path: '/channels/:id',
    title: '渠道详情',
    area: 'apps',
    group: '客户经营',
    parent: '/channels',
    hidden: true,
    required: ['menu.channel', 'channel.read'],
  },
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
    path: '/payments/new',
    title: '新建收款',
    area: 'apps',
    group: '财务运营',
    required: ['payment.read', 'payment.create'],
    hidden: true,
  },
  {
    path: '/payments/:id',
    title: '收款详情与办理',
    area: 'apps',
    group: '财务运营',
    required: ['payment.read'],
    hidden: true,
  },
  {
    path: '/invoices/new',
    title: '新建发票',
    area: 'apps',
    group: '财务运营',
    required: ['invoice.read', 'invoice.create'],
    hidden: true,
  },
  {
    path: '/invoices/:id',
    title: '发票详情与办理',
    area: 'apps',
    group: '财务运营',
    required: ['invoice.read'],
    hidden: true,
  },
  {
    path: '/refunds/new',
    title: '新建退款减免',
    area: 'apps',
    group: '财务运营',
    required: ['refund.read', 'refund.create'],
    hidden: true,
  },
  {
    path: '/refunds/:id',
    title: '退款减免详情与办理',
    area: 'apps',
    group: '财务运营',
    required: ['refund.read'],
    hidden: true,
  },
  {
    path: '/costs/new',
    title: '新建成本',
    area: 'apps',
    group: '财务运营',
    required: ['cost.read', 'cost.create'],
    hidden: true,
  },
  {
    path: '/costs/:id',
    title: '成本详情与办理',
    area: 'apps',
    group: '财务运营',
    required: ['cost.read'],
    hidden: true,
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
      ['menu.cost', 'cost.read'],
    ],
  },
  ...[
    ['items', '低值易耗品'],
    ['stocktakes', '人力资源'],
  ].map(
    ([path, title]): NavigationEntry => ({
      path: '/inventory/' + path,
      title,
      area: 'apps',
      group: '综合行政管理',
      required: path === 'stocktakes' ? ['hr.worksheet.read'] : stock,
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
  {
    path: '/cases/new',
    title: '新建案件',
    area: 'apps',
    group: '签约交付',
    required: ['case.read', 'case.create', 'customer.read'],
    hidden: true,
  },
  {
    path: '/cases/:id',
    title: '案件详情与交付',
    area: 'apps',
    group: '签约交付',
    required: ['case.read'],
    hidden: true,
  },
  { path: '/inventory/movements', title: '行政事务', area: 'apps', group: '综合行政管理', required: stock },
  ...(['items', 'movements', 'stocktakes'] as const).flatMap((source): NavigationEntry[] => [
    {
      path: '/inventory/' + source + '/new',
      title: '登记物品业务',
      area: 'apps',
      group: '综合行政管理',
      required: stock,
      hidden: true,
      parent: '/inventory/' + source,
    },
    {
      path: '/inventory/' + source + '/:id',
      title: '物品业务详情',
      area: 'apps',
      group: '综合行政管理',
      required: stock,
      hidden: true,
      parent: '/inventory/' + source,
    },
  ]),
  {
    path: '/performances/new',
    title: '登记绩效',
    area: 'analytics',
    group: '绩效分析',
    required: ['performance.create', 'employee.read'],
    hidden: true,
    parent: '/performances',
  },
  {
    path: '/performances/:id',
    title: '绩效详情',
    area: 'analytics',
    group: '绩效分析',
    required: ['performance.read'],
    hidden: true,
    parent: '/performances',
  },
  {
    path: '/payroll',
    title: '工资表与审批',
    area: 'analytics',
    group: '绩效分析',
    required: ['performance.read'],
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
  '/inventory/customized-records': '/inventory/items',
  '/inventory/office-records': '/inventory/items',
  '/inventory/inbound': '/inventory/items',
  '/inventory/outbound': '/inventory/items',
  '/organizations': '/org/tree',
  '/employees': '/org/employees',
  '/roles': '/security/roles',
};
export function retiredPath(path: string) {
  return /^\/(quality|sop)(\/|$)/.test(path) || ['/admin/quality-rules','/admin/sop-templates','/analytics/quality','/cases/:id/assessments'].includes(path);
}
entries.forEach(entry => {
  if (retiredPath(entry.path)) entry.retired = true;
  if (entry.path === '/leads/calendar') entry.hidden = true;
});
entries.push({path:'/admin/archives',title:'停用模块历史归档',area:'admin',group:'历史资料'});
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
      !entry.retired && !entry.hidden && !entry.global && (!area || entry.area === area) && canOpen(entry, authorization),
  );
}
