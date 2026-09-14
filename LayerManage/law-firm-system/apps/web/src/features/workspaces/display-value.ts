import type { Directory, Field } from './types';

export function displayValue(field: Field, value: unknown, directory: Directory): string {
  if (value === null || value === undefined || value === '') return '';
  const options =
    field.type === 'USER'
      ? directory.employees
      : field.type === 'ORGANIZATION'
        ? directory.organizations
        : field.options.choices || [];
  if (field.type === 'BOOLEAN') return value ? '已勾选' : '未勾选';
  if (field.type === 'FILE') return Array.isArray(value) ? value.length + ' 个附件' : '';
  if (field.type === 'RELATION') return Array.isArray(value) ? value.length + ' 条关联记录' : '';
  if (Array.isArray(value))
    return value.map((v) => options.find((o) => o.id === v)?.name || String(v)).join('、');
  return options.find((o) => o.id === value)?.name || String(value);
}
