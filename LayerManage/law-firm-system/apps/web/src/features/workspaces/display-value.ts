import { FORMULA_KEYS } from '@/pages/Case/intake-contract';
export const isCasePercent = (field: Field) =>
  field.options.businessSource === 'CASES' &&
  [
    'intake.riskAgencyRatio',
    'intake.managementFeeRatio',
    'intake.lawyerCommissionRatio',
    'intake.proportionalGuarantee',
  ].includes(field.options.businessKey || '');
import { CONTRACT_STATUS_META, CONTRACT_TYPE_META, NEGOTIATION_STATUS_META } from '@/pages/contracts/meta';
import {
  LEAD_STATUS_META,
  POOL_STATUS_META,
  FOLLOW_TYPE_META,
  CUSTOMER_STATUS_META,
  CUSTOMER_TYPE_META,
} from '@/pages/leads/meta';
import type { Directory, Field } from './types';
import { formatMoney, formatBusinessDate, refundStatusLabels } from '@/utils/business-format';
import { sealReview } from './seal-review';
export const fieldLabel = (field: Field) =>
  field.type === 'CURRENCY' && !/[元¥￥]/.test(field.name)
    ? field.name.endsWith('（同步）')
      ? field.name.replace(/（同步）$/, '（元，同步）')
      : field.name + '（元）'
    : field.name;
export function fieldHint(field: Field) {
  if (field.options.helpText) return field.options.helpText;
  if (field.type === 'AUTONUMBER') return '创建时自动递增编号，删除后不复用；不可手动修改。';
  if (field.options.businessSource === 'PAYMENTS' && ['invoiceNo','invoiceStatus'].includes(field.options.businessKey || '')) return '按关联合同的已完成开票申请同步；请在发票业务表办理开票。';
  if (['receiptDetails','receiptTotal','receiptFiles'].includes(field.options.businessKey || '') || ['actualRefundAmount','refundPaidAt','refundStatus','refundReceiptLookup'].includes(field.options.lifecycleKey || '')) return '财务数据仅限财务部录入，此处为自动同步。';
  if (field.options.lifecycleKey === 'status' && field.options.choices?.some(choice => choice.id === 'REFUND_REQUIRED'))
    return '需要办理退费时，选择“协商未果 / 需退款”并保存，再到退费管理表选择该售后记录，填写退款信息。';
  if (field.options.lifecycleKey === 'terminated') return '判断规则待补充；暂时保持只读空值。';
  if (
    field.options.businessSource === 'CASES' &&
    FORMULA_KEYS.some((key) => 'intake.' + key === field.options.businessKey)
  )
    return '计算口径待配置；已有数值保留，暂不自动计算或允许手动覆盖。';
  if (field.options.businessSource === 'CASES' && field.options.businessKey?.startsWith('files.'))
    return '附件从案件同步；请在详情与办理中上传、移除。';
  if (field.options.lifecycleKey && !field.writable) return '由上游业务实时同步；请到原业务记录修改。';
  if (field.options.businessKey && !field.writable) return '由关联业务或业务流程维护，当前字段只读。';
  if (!field.writable) return '系统字段或当前权限为只读。';
  return field.type === 'CURRENCY'
    ? '单位：元，最多两位小数。'
    : ['DATETIME', 'CREATED_AT', 'UPDATED_AT'].includes(field.type)
      ? '按北京时间显示。'
      : undefined;
}

export function displayValue(field: Field, value: unknown, directory: Directory): string {
  if (value === '******') return '******';
  if (field.options.hrPartialDate && /^\d{4}-\d{2}$/.test(String(value))) return String(value).replace('-', '/');
  if (field.options.adminReview) { const review=sealReview(value); return review.decision + (review.reason ? '：'+review.reason : ''); }
  if(field.options.businessKey==='receiptDetails') return (Array.isArray(value)?value.length:0)+' 笔收款';
  if (value === null || value === undefined || value === '') return '';
  if (field.options.maskDisplay) {
    const contact = String(value);
    return contact.length > 7 ? contact.slice(0, 3) + '****' + contact.slice(-4) : '****';
  }
  if (field.options.dateOnly || ['领取日期', '日期'].includes(field.options.inventoryKey || '')) return formatBusinessDate(value).slice(0, 10).replace(/-/g, '/');
  if (field.options.dateMinute) return formatBusinessDate(value).slice(0,16).replace(/-/g,'/');
  if (field.options.numberFormat === 'CNY') return formatMoney(value);
  if (field.type === 'CURRENCY') return formatMoney(value);
  if (isCasePercent(field)) return `${Number(value)}%`;
  if (['DATETIME', 'CREATED_AT', 'UPDATED_AT'].includes(field.type) && (['CASES','FOLLOWS'].includes(field.options.businessSource || '') || field.options.lifecycleKey))
    return formatBusinessDate(value).replace(/-/g, '/').slice(0, 16);
  if (['DATE', 'DATETIME', 'CREATED_AT', 'UPDATED_AT'].includes(field.type))
    return formatBusinessDate(value, field.type === 'DATE');
  if (field.options.businessSource === 'REFUNDS' && field.options.businessKey === 'status')
    return refundStatusLabels[String(value)] || String(value);
  if (['PAYMENTS', 'INVOICES', 'REFUNDS', 'COSTS'].includes(field.options.businessSource || '')) {
    const names: Record<string, Record<string, string>> = {
      status: {
        PENDING: '待处理',
        CONFIRMED: '已确认',
        VOIDED: '已冲销',
        REFUNDED: '已退款',
        APPROVED: '已批准',
        REJECTED: '已驳回',
        COMPLETED: '已完成',
        EXECUTED: '已执行',
      },
      type: { REFUND: '退款', WAIVER: '减免' },
      invoiceStatus: { NOT_ISSUED:'未开票', ISSUED:'已开票' },
      category: {
        CHANNEL: '渠道成本',
        EVIDENCE: '取证成本',
        CASE_HANDLING: '办案成本',
        LABOR: '人工成本',
        OFFICE: '办公成本',
        REIMBURSEMENT: '报销成本',
      },
    };
    const label = names[field.options.businessKey || '']?.[String(value)];
    if (label) return label;
  }
  if (
    ['INVENTORY_ITEMS', 'INVENTORY_MOVEMENTS', 'INVENTORY_STOCKTAKES', 'PERFORMANCES'].includes(
      field.options.businessSource || '',
    )
  ) {
    const names: Record<string, Record<string, string>> = {
      kind: { OFFICE: '办公用品', CUSTOMIZED: '定制物品' },
      itemKind: { OFFICE: '办公用品', CUSTOMIZED: '定制物品' },
      action: { INBOUND: '入库', OUTBOUND: '领用出库', ADJUST: '盘点调整' },
      status: {
        ENABLED: '启用',
        DISABLED: '停用',
        PENDING: '待考核',
        SELF_REVIEWED: '已自评',
        MANAGER_REVIEWED: '已主管评',
        CONFIRMED: '已确认',
      },
      type: { MONTHLY: '月度', QUARTERLY: '季度', YEARLY: '年度' },
    };
    const label = names[field.options.businessKey || '']?.[String(value)];
    if (label) return label;
  }
  const labels: Record<string, string> = Object.fromEntries(
    Object.entries(
      field.options.businessKey === 'status'
        ? field.options.businessSource === 'CASES'
          ? {
              PENDING: { text: '待受理' },
              ACCEPTED: { text: '已受理' },
              PROCESSING: { text: '办理中' },
              CLOSED: { text: '已结案' },
              ARCHIVED: { text: '已归档' },
            }
          : field.options.businessSource === 'CUSTOMERS'
            ? CUSTOMER_STATUS_META
            : field.options.businessSource === 'CONTRACTS'
              ? CONTRACT_STATUS_META
              : field.options.businessSource === 'NEGOTIATIONS'
                ? NEGOTIATION_STATUS_META
                : LEAD_STATUS_META
        : field.options.businessKey === 'poolStatus'
          ? POOL_STATUS_META
          : {},
    ).map(([key, value]) => [key, value.text]),
  );
  if (labels[String(value)]) return labels[String(value)];
  if (field.options.businessKey === 'priority' && field.options.businessSource === 'CASES')
    return (
      ({ LOW: '低', NORMAL: '普通', HIGH: '高', URGENT: '紧急' } as Record<string, string>)[String(value)] ||
      String(value)
    );
  if (field.options.businessKey === 'customerType')
    return (CUSTOMER_TYPE_META as Record<string, string>)[String(value)] || String(value);
  if (field.options.businessKey === 'contractType')
    return (CONTRACT_TYPE_META as Record<string, { text: string }>)[String(value)]?.text || String(value);
  if (field.options.businessKey === 'type')
    return (FOLLOW_TYPE_META as Record<string, string>)[String(value)] || String(value);
  const options =
    field.type === 'USER'
      ? directory.employees
      : field.type === 'ORGANIZATION'
        ? directory.organizations
        : ['CREATED_BY', 'UPDATED_BY'].includes(field.type)
          ? directory.users
          : field.options.choices || [];
  if (field.type === 'BOOLEAN') return value ? '已勾选' : '未勾选';
  if (field.type === 'FILE') return Array.isArray(value) ? value.length + ' 个附件' : '';
  if (field.type === 'RELATION') return Array.isArray(value) ? value.length + ' 条关联记录' : '';
  if (Array.isArray(value))
    return value.map((v) => options.find((o) => o.id === v)?.name || String(v)).join('、');
  return options.find((o) => o.id === value)?.name || String(value);
}
