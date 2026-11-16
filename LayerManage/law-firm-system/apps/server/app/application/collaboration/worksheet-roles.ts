import { departmentCreatorPredicate } from './department-scope';
import { CollabField, Prisma } from '@prisma/client';
import type { Access } from './collaboration-service';
import { boolean, choice, exact, fail, filterSql, object, type Filter } from './collaboration-policy';

export const presets = ['OWNER', 'MANAGER', 'EDITOR', 'READER'] as const;
const levels = { DENY: 0, READER: 1, EDITOR: 2, MANAGER: 3, OWNER: 4 };
const modes = ['HIDDEN', 'MASK', 'READ', 'EDIT'] as const;
// Legacy MASK grants retain read-only access, now with full values.
const modeLevel = (mode: string) => mode === 'MASK' ? 2 : modes.indexOf(mode as typeof modes[number]);
export type TableRule = {
  business?: {permissions: string[]; scopeIds:string[]};
  share?: boolean;
  import?: boolean;
  level: keyof typeof levels;
  rows: 'ALL' | 'SELF' | 'DEPARTMENT' | 'SUBDEPARTMENTS' | 'FILTER';
  filter?: Filter;
  viewIds?: string[];
  fields: Record<string, typeof modes[number]>;
  add: boolean; remove: boolean; analytics: boolean; copy: boolean; automate: boolean;
};
export type RolePolicy = { rules: Record<string, TableRule>; invitations: Record<string,string> };
export function defaultRule(role: TableRule['level']): TableRule {
  return { level: role, rows: 'ALL', fields: {}, add: levels[role] >= 2, remove: levels[role] >= 2,
    analytics: true, copy: true, automate: levels[role] >= 2 };
}
export function parseRule(raw: unknown, fields: CollabField[], sharedViews: string[]): TableRule {
  const v = exact(raw, ['level','rows','filter','viewIds','fields','add','remove','analytics','copy','automate','business','share','import']);
  const level = choice(v.level, ['DENY','READER','EDITOR','MANAGER']) as TableRule['level'];
  const rows = choice(v.rows,['SELF','ALL','DEPARTMENT','SUBDEPARTMENTS','FILTER']) as TableRule['rows'];
  if (rows === 'FILTER') {
    if (!v.filter) fail('COLLAB_INVALID_FILTER');
    filterSql(v.filter, fields.filter(f => !object(f.options).hrSensitive), 'user', null);
  }
  let viewIds: string[] | undefined;
  if (v.viewIds !== undefined) {
    if (!Array.isArray(v.viewIds) || v.viewIds.some(id => typeof id !== 'string' || !sharedViews.includes(id)))
      fail('COLLAB_INVALID_ACCESS');
    viewIds = [...new Set(v.viewIds as string[])];
  }
  const columns: TableRule['fields'] = {};
  for (const [id, mode] of Object.entries(object(v.fields))) {
    if (!fields.some(f => f.id === id)) fail('COLLAB_FIELD_UNAVAILABLE');
    columns[id] = choice(mode, [...modes]) as typeof modes[number];
  }
  return { level, rows, ...(v.business !== undefined ? {business:object(v.business) as TableRule['business']} : {}),
    ...(v.share !== undefined ? {share:boolean(v.share)} : {}), ...(v.import !== undefined ? {import:boolean(v.import)} : {}), ...(viewIds && {viewIds}), ...(rows === 'FILTER' ? {filter: v.filter as Filter} : {}), fields: columns,
    add: boolean(v.add) && levels[level] >= 2, remove: boolean(v.remove) && levels[level] >= 2,
    analytics: boolean(v.analytics), copy: boolean(v.copy), automate: boolean(v.automate) && levels[level] >= 2 };
}
export function applyRules(access: Access, rules: TableRule[], fields: CollabField[]) {
  if (!rules.length) return;
  const readable = rules.filter(r => levels[r.level] > 0);
  if (!readable.length) fail('COLLAB_FORBIDDEN',403);
  access.level = Math.min(access.level, Math.max(...readable.map(r => levels[r.level])));
  access.rules = readable;
  if(readable.every(r=>r.share !== undefined)) access.canManageAccess = access.level>=3 && readable.some(r=>r.share);
  if(readable.every(r=>r.import !== undefined)) access.import = access.level>=2 && readable.some(r=>r.import);
  if (readable.every(r => r.viewIds)) access.viewIds = [...new Set(readable.flatMap(r => r.viewIds || []))];
  access.add = access.level >= 2 && readable.some(r => r.add);
  access.remove = access.level >= 2 && readable.some(r => r.remove);
  access.copy = readable.some(r => r.copy);
  access.analytics = readable.some(r => r.analytics);
  access.automate = access.level >= 2 && readable.some(r => r.automate);
  access.masked = [];
  for (const f of fields) {
    const permission = Math.max(...readable.map(r => Math.min(levels[r.level] < 2 ? 2 : 3, modeLevel(r.fields[f.id] ?? 'EDIT'))));
    if (!permission) access.hidden.push(f.id);
    if (permission === 1) access.masked.push(f.id);
    if (permission < 3) access.readonly.push(f.id);
  }
}
export function recordFieldLevel(access: Access, id:string, field:string) {
  const ceiling:number = access.previewCeiling ? recordFieldLevel(access.previewCeiling,id,field) : 3;
  if (!access.scopedRules) return ceiling;
  return Math.min(ceiling, Math.max(0,...access.scopedRules.filter(r=>!r.ids || r.ids.has(id)).map(({rule})=>
    Math.min(levels[rule.level] < 2 ? 2 : 3, modeLevel(rule.fields[field] ?? 'EDIT')))));
}
export function rowPredicate(rules: TableRule[] | undefined, fields: CollabField[], user: string, employee: string | null) {
  if (!rules || rules.some(r => r.rows === 'ALL')) return Prisma.sql`TRUE`;
  if (!rules.length) return Prisma.sql`FALSE`;
  return Prisma.sql`(${Prisma.join(rules.map(r => ['DEPARTMENT','SUBDEPARTMENTS'].includes(r.rows) ? departmentCreatorPredicate(user,employee,r.rows==='SUBDEPARTMENTS') : r.rows === 'SELF' ? Prisma.sql`r."createdBy"=${user}` :
    filterSql(r.filter, fields, user, employee)), ' OR ')})`;
}
export function ruleAllowsWrite(r: TableRule, fieldIds: string[], action: 'edit'|'add'|'remove') {
  return levels[r.level] >= 2 && (action === 'edit' || (action === 'add' ? r.add : r.remove)) &&
    fieldIds.every(id => (r.fields[id] ?? 'EDIT') === 'EDIT');
}
