import type { CollabField } from '@prisma/client';
import { object } from './collaboration-policy';

/** Presentation overrides never change the identifiers/names used by business workflows. */
export function fieldProtection(field: CollabField) {
  const o = object(field.options);
  const system = !!(o.businessKey || o.lifecycleKey || o.inventoryKey || o.hrField || o.customerRouteKey || o.prospectAssignee || o.medicalRelation || o.medicalAutofill || field.type === 'FORMULA');
  const key = String(o.businessKey || o.lifecycleKey || o.inventoryKey || '');
  const core = field.position === 0 || field.required || !!o.primary || !!o.customerRouteKey || !!o.prospectAssignee || !!o.medicalRelation || !!o.medicalAutofill ||
    ['USER', 'RELATION', 'AUTONUMBER', 'FORMULA'].includes(field.type) ||
    /(^|\.)(id|.*Id|.*Ids|.*No|status|.*Status|number|code|owner|assignee|approval.*)$/i.test(key);
  return { system, core, reason: core ? '用于标识、必填信息、人员关联、计算或业务流程，不能停用或删除；可在视图配置中隐藏。' : system ? '系统业务字段仅支持展示配置和停用展示，底层数据与关联保留。' : '' };
}
export function fieldStopped(field: CollabField) {
  return field.archived || object(field.options).presentationDisabled === true;
}
export function presentedField<T extends CollabField>(field: T): T {
  const o = object(field.options);
  return { ...field, name: typeof o.displayName === 'string' ? o.displayName : field.name,
    options: { ...o, ...(typeof o.displayHelp === 'string' ? { helpText: o.displayHelp } : {}) } };
}
