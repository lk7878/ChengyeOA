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
  const labels: Record<string, string> = Object.fromEntries(
    Object.entries(
      field.options.businessKey === 'status'
        ? field.options.businessSource === 'CUSTOMERS'
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
