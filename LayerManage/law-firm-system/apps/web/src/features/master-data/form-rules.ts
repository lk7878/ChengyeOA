import type { FormInstance } from 'antd';
import type { Rule } from 'antd/es/form';
import type { OrganizationType } from './types';

export const CODE_HELP = '2–32 位，以英文字母开头，仅支持字母、数字、下划线，例如 DEPT_001';
export const normalizeCode = (value: string) => value?.trim().toUpperCase();
const trim = (value: unknown) => typeof value === 'string' ? value.trim() : value;

export function codeRules(label: string): Rule[] {
  return [{ required: true, message: `请输入${label}` }, {
    pattern: /^[A-Z][A-Z0-9_]{1,31}$/i, transform: trim, message: CODE_HELP,
  }];
}

export function textRules(label: string, min = 2, max = 100, required = true): Rule[] {
  return [{ required, transform: trim, min: required ? min : undefined, max,
    message: required ? `${label}须为 ${min}–${max} 个字符，不能仅填写空格` : `${label}不能超过 ${max} 个字符` }];
}

export const employeeNoRules: Rule[] = [{ required: true, message: '请输入员工工号' }, {
  pattern: /^[A-Z0-9][A-Z0-9_-]{1,31}$/i, transform: trim,
  message: '工号须为 2–32 位，以字母或数字开头，仅支持字母、数字、下划线和短横线',
}];

export async function validateForm<T>(form: FormInstance<T>): Promise<T | undefined> {
  try { return await form.validateFields(); }
  catch (error) {
    if (error && typeof error === 'object' && 'errorFields' in error) return undefined;
    throw error;
  }
}

const childTypes: Record<OrganizationType, OrganizationType[]> = {
  FIRM: ['HQ_CENTER', 'DEPARTMENT', 'BRANCH'], HQ_CENTER: ['DEPARTMENT'],
  BRANCH: ['DEPARTMENT', 'GROUP'], DEPARTMENT: ['GROUP'], GROUP: [],
};
export function allowedChildTypes(type: OrganizationType): OrganizationType[] { return childTypes[type]; }
