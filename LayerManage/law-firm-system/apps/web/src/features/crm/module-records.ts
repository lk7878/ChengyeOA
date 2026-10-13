import type { BusinessSource } from './business-sources';
import type { PermissionCode } from '@/features/authorization/types';

export interface ModuleRecordsDefinition {
  endpoint: string;
  columns: [string, string][];
  params?: Record<string, string>;
  keyword?: string;
  edit?: PermissionCode;
  remove?: PermissionCode;
}
// Read through the formal domain APIs: their scopes and sensitive-field projection remain authoritative.
export const moduleRecords: Record<Exclude<BusinessSource, 'NEGOTIATIONS'>, ModuleRecordsDefinition> = {
  CUSTOMERS: {
    endpoint: '/v1/customers',
    keyword: 'keyword',
    edit: 'customer.update',
    remove: 'customer.delete',
    columns: [
      ['customerNo', '客户编号'],
      ['name', '客户名称'],
      ['customerType', '客户类型'],
      ['status', '状态'],
    ],
  },
  CASES: {
    endpoint: '/v1/cases',
    keyword: 'keyword',
    edit: 'case.update',
    remove: 'case.delete',
    columns: [
      ['caseNo', '案件编号'],
      ['title', '案件名称'],
      ['caseType', '案由'],
      ['status', '状态'],
    ],
  },
  CONTRACTS: {
    endpoint: '/v1/contracts',
    edit: 'contract.submit',
    columns: [
      ['contractNo', '合同编号'],
      ['title', '合同名称'],
      ['amount', '合同金额'],
      ['status', '状态'],
    ],
  },
  LEADS: {
    endpoint: '/v1/leads',
    keyword: 'keyword',
    edit: 'lead.update',
    columns: [
      ['leadNo', '线索编号'],
      ['name', '线索名称'],
      ['status', '状态'],
    ],
  },
  FOLLOWS: {
    endpoint: '/v1/lead-follows',
    edit: 'lead.update',
    columns: [
      ['type', '跟进方式'],
      ['content', '跟进内容'],
      ['nextPlan', '下次计划'],
    ],
  },
  CHANNELS: {
    endpoint: '/v1/channels',
    keyword: 'keyword',
    edit: 'channel.update',
    remove: 'channel.delete',
    columns: [
      ['code', '渠道编号'],
      ['name', '渠道名称'],
      ['type', '渠道类型'],
      ['status', '状态'],
    ],
  },
  PAYMENTS: {
    endpoint: '/v1/payments',
    edit: 'payment.create',
    columns: [
      ['paymentNo', '收款编号'],
      ['amount', '收款金额'],
      ['status', '状态'],
    ],
  },
  INVOICES: {
    endpoint: '/v1/invoices',
    edit: 'invoice.create',
    columns: [
      ['requestNo', '申请编号'],
      ['invoiceNo', '发票号码'],
      ['amount', '金额'],
      ['status', '状态'],
    ],
  },
  REFUNDS: {
    endpoint: '/v1/refunds',
    edit: 'refund.create',
    columns: [
      ['requestNo', '申请编号'],
      ['type', '业务类型'],
      ['amount', '金额'],
      ['status', '状态'],
    ],
  },
  COSTS: {
    endpoint: '/v1/costs',
    edit: 'cost.update',
    remove: 'cost.delete',
    columns: [
      ['category', '成本分类'],
      ['amount', '金额'],
      ['note', '说明'],
    ],
  },
  PERFORMANCES: {
    endpoint: '/v1/performances',
    edit: 'performance.update',
    columns: [
      ['period', '考核周期'],
      ['type', '考核类型'],
      ['score', '分数'],
      ['status', '状态'],
    ],
  },
  INVENTORY_ITEMS: {
    endpoint: '/v1/inventory',
    params: { view: 'items' },
    keyword: 'keyword',
    edit: 'inventory.manage',
    columns: [
      ['code', '物品编号'],
      ['name', '物品名称'],
      ['stock', '库存'],
      ['unit', '单位'],
      ['status', '状态'],
    ],
  },
  INVENTORY_MOVEMENTS: {
    endpoint: '/v1/inventory',
    params: { view: 'movements' },
    columns: [
      ['documentNo', '出入库编号'],
      ['itemName', '物品名称'],
      ['action', '业务类型'],
      ['quantity', '数量'],
    ],
  },
  INVENTORY_STOCKTAKES: {
    endpoint: '/v1/inventory',
    params: { view: 'stocktakes' },
    columns: [
      ['documentNo', '盘点编号'],
      ['itemName', '物品名称'],
      ['bookStock', '账面库存'],
      ['actualStock', '实际库存'],
    ],
  },
  SOP_TASKS: {
    endpoint: '/v1/sop/tasks',
    edit: 'sop.task.manage',
    columns: [
      ['name', '任务名称'],
      ['status', '状态'],
      ['dueDate', '到期日期'],
    ],
  },
  QUALITY_ANALYSES: {
    endpoint: '/v1/quality/special-analyses',
    edit: 'quality.analysis.manage',
    columns: [
      ['id', '分析编号'],
      ['status', '状态'],
    ],
  },
  QUALITY_REVIEWS: {
    endpoint: '/v1/quality/inspections',
    edit: 'quality.inspection.record',
    columns: [
      ['name', '抽检名称'],
      ['status', '状态'],
    ],
  },
  QUALITY_ISSUES: {
    endpoint: '/v1/quality/issues',
    edit: 'quality.issue.manage',
    columns: [
      ['name', '问题名称'],
      ['status', '状态'],
      ['dueAt', '整改期限'],
    ],
  },
};

const labels: Record<string, string> = {
  INDIVIDUAL: '个人',
  COMPANY: '企业',
  ENTERPRISE: '企业',
  ACTIVE: '正常',
  INACTIVE: '停用',
  ENABLED: '启用',
  DISABLED: '停用',
  NEW: '新建',
  ASSIGNED: '已分配',
  CONTACTED: '已联系',
  DRAFT: '草稿',
  PENDING: '待处理',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CLOSED: '已结案',
  SIGNED: '已签约',
  UNSIGNED: '未签约',
  NEGOTIATING: '谈案中',
  APPROVED: '已审批',
  REJECTED: '已驳回',
  SUBMITTED: '已提交',
  CONFIRMED: '已确认',
  CANCELLED: '已取消',
  VOIDED: '已作废',
  PHONE: '电话',
  WECHAT: '微信',
  VISIT: '到访',
  ONLINE: '线上',
  OTHER: '其他',
  IN_REVIEW: '审核中',
  CHANGES_REQUESTED: '待修改',
  SKIPPED: '已跳过',
};
export function recordCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return '—';
  const text = String(value);
  return labels[text] ?? text;
}
