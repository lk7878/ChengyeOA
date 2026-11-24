import type { FormField, Values } from './schema';

export interface RelationField {
  id: string;
  name: string;
  type: string;
  options?: unknown;
}
export interface RelationRecord {
  id: string;
  version?: number;
  values: Values;
  displayValues?: Record<string, string>;
}
export interface RelationSnapshot {
  recordId: string;
  tableId: string;
  version?: number;
  capturedAt: string;
  label: string;
  references: Array<{ fieldId: string; name: string; text: string }>;
}
export type RelationSnapshots = Record<string, RelationSnapshot>;

export function defaultDisplayFields(fields: RelationField[]): string[] {
  const business = fields.filter(f => /合同编号|案件编号|客户姓名|客户名称|标题|名称|姓名/.test(f.name) && f.type !== 'FILE');
  return (business.length ? business.slice(0, 2) : fields.filter(f =>
    ['TEXT', 'TEXTAREA', 'SINGLE_SELECT', 'AUTONUMBER'].includes(f.type) && !/ID$|创建|更新/.test(f.name)).slice(0, 1)).map(f => f.id);
}
export function relationText(field: RelationField, record: RelationRecord): string {
  if (record.displayValues?.[field.id] != null) return record.displayValues[field.id];
  const value = record.values[field.id];
  if (value == null || value === '') return '—';
  if (field.type === 'CHECKBOX') return value ? '是' : '否';
  // Never render raw person/record/attachment IDs as business labels.
  if (['USER', 'RELATION', 'FILE'].includes(field.type)) return '已关联';
  const choices = (field.options as { choices?: Array<{ id: string; name: string }> } | null)?.choices;
  const one = (v: unknown): string => choices?.find(c => c.id === v)?.name ??
    (typeof v === 'object' ? '—' : String(v));
  return Array.isArray(value) ? value.map(one).join('、') : one(value);
}
export function relationSnapshot(field: FormField, fields: RelationField[], record: RelationRecord): RelationSnapshot {
  const ids = field.displayFieldIds?.length ? field.displayFieldIds : defaultDisplayFields(fields);
  const label = ids.map(id => fields.find(f => f.id === id)).filter((f): f is RelationField => !!f)
    .map(f => relationText(f, record)).filter(s => s && s !== '—').join(' · ') || '未填写业务名称';
  return { tableId: field.tableId!, recordId: record.id, version: record.version,
    capturedAt: new Date().toISOString(), label,
    references: (field.referenceFieldIds ?? []).map(id => fields.find(f => f.id === id))
      .filter((f): f is RelationField => !!f).map(f => ({ fieldId: f.id, name: f.name, text: relationText(f, record) })) };
}
