import type { Field, ViewConfig } from '@/features/workspaces/types';
export const financialSources = ['PAYMENTS', 'INVOICES', 'REFUNDS', 'COSTS'];
export function financialViewConfig(
  source: string,
  fields: Field[],
  config: ViewConfig,
  contractId: string | null,
  caseId: string | null,
): ViewConfig {
  if (!financialSources.includes(source)) return config;
  const value = source === 'COSTS' ? caseId : contractId;
  if (!value) return config;
  const key = source === 'COSTS' ? 'caseId' : 'contractId';
  const field = fields.find((f) => f.options.businessKey === key && f.queryable !== false);
  if (!field) throw new Error('当前权限无法按关联字段查询，请联系负责人调整字段权限。');
  const constraint = { fieldId: field.id, operator: 'eq', value };
  return {
    ...config,
    filter: config.filter ? { join: 'and', children: [config.filter, constraint] } : constraint,
  };
}
export function financeContextParams(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(
    ['contract', 'case', 'caseNo'].flatMap((key) => (params.get(key) ? [[key, params.get(key)!]] : [])),
  );
}
