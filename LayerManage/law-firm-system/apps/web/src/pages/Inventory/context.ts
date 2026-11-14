import type { Field, ViewConfig } from '@/features/workspaces/types';
export function inventoryViewConfig(
  source: string,
  fields: Field[],
  config: ViewConfig,
  params: URLSearchParams,
): ViewConfig {
  if (!source.startsWith('INVENTORY_')) return config;
  let result = config;
  for (const [param, key] of [
    ['kind', source === 'INVENTORY_ITEMS' ? 'kind' : 'itemKind'],
    ['action', 'action'],
    ['item', source === 'INVENTORY_ITEMS' ? 'id' : 'itemId'],
  ]) {
    const value = params.get(param);
    if (!value || (param === 'action' && source !== 'INVENTORY_MOVEMENTS')) continue;
    const field = fields.find((f) => f.options.businessKey === key && f.queryable !== false);
    if (!field) throw new Error('当前工作表无法按物品条件筛选，请返回全部记录或联系负责人。');
    const constraint = { fieldId: field.id, operator: 'eq', value };
    result = {
      ...result,
      filter: result.filter ? { join: 'and', children: [result.filter, constraint] } : constraint,
    };
  }
  return result;
}
