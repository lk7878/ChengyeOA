import { CONTRACT_STATUS_META, CONTRACT_TYPE_META, NEGOTIATION_STATUS_META } from '@/pages/contracts/meta';
import {
  LEAD_STATUS_META,
  POOL_STATUS_META,
  FOLLOW_TYPE_META,
  CUSTOMER_STATUS_META,
  CUSTOMER_TYPE_META,
} from '@/pages/leads/meta';
import type { Directory, Field } from './types';

export function displayValue(field: Field, value: unknown, directory: Directory): string {
  if (value === null || value === undefined || value === '') return '';
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
