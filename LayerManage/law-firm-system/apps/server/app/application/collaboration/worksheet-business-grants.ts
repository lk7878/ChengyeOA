import { FIELD_CATALOG } from '../../domain/authorization/field-security-policy';
import { isCaseArchiveKind } from './case-archive-worksheets';
import type { CollabTable, PrismaClient, Prisma } from '@prisma/client';
import type { AuthorizationContext, EffectiveGrant } from '../authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../domain/authorization/permission-catalog';
import type { PermissionCode } from '../../domain/authorization/authorization-types';
import { domainSources, isDomainSource } from '../crm/workspace-domain-source';
import { isHrKind } from './hr-worksheets';
import { retiredSources } from '../../domain/module-availability';
import { object, fail } from './collaboration-policy';
import type { TableRule } from './worksheet-roles';
import { presets } from './worksheet-roles';

type DB = PrismaClient | Prisma.TransactionClient;
export function tableBusinessCapabilities(table: Pick<CollabTable,'source'|'inventoryKind'>) {
  const source = table.source;
  const hr = isHrKind(table.inventoryKind) || source === 'INVENTORY_STOCKTAKES';
  const resource = hr ? 'workspace' : isCaseArchiveKind(table.inventoryKind)?'case':table.inventoryKind?'inventory':source === 'LEADS' || source === 'FOLLOWS' ? 'lead' : isDomainSource(source) ? domainSources[source].resource : null;
  const read = hr ? 'hr.worksheet.read' : resource ? resource+'.read' : null;
  const menu = hr ? 'menu.inventory' : ['LEADS','FOLLOWS'].includes(source) ? 'menu.lead_crm' :
    ['CONTRACTS','NEGOTIATIONS'].includes(source) ? 'menu.contract' : resource ? 'menu.'+resource : null;
  const basic = [read,menu].filter((code): code is string=>!!code && PERMISSION_CATALOG.some(p=>p.code===code));
  const edit = hr ? ['hr.worksheet.manage'] : resource === 'inventory' ? ['inventory.manage'] : resource ? [resource+'.create',resource+'.update',...(source==='FOLLOWS'?['lead.follow.create']:[])] : [];
  const special = PERMISSION_CATALOG.filter(p=>p.type!=='MENU' &&
    ((!hr && resource && p.resource===resource && ![...basic,...edit].includes(p.code) && !p.code.startsWith('quality.') && !p.code.startsWith('sop.')) ||
      (hr && p.code==='hr.worksheet.sensitive') || ['file.sensitive.download','data.bulk_export'].includes(p.code)));
  return {resource,basic,permissionNames:Object.fromEntries(PERMISSION_CATALOG.filter(p=>[...basic,...edit,...special.map(p=>p.code)].includes(p.code)).map(p=>[p.code,p.name])),scopeTypes:source==='COSTS'?['SELF','OWN_ORG','ORG','BRANCH','CUSTOM']:['SELF','OWN_ORG','ORG','BRANCH','TEAM','CUSTOM'],
    selfMeaning:({LEADS:'本人负责的线索',FOLLOWS:'本人负责线索的跟进',CUSTOMERS:'本人负责及业务规则允许查看的客户',CASES:'本人负责及参与的案件',PERFORMANCES:'本人员工绩效',COSTS:'本人录入的费用',PAYMENTS:'本人登记的收款',INVOICES:'本人登记的发票',REFUNDS:'本人登记的退款申请'} as Record<string,string>)[source] || '按本业务的本人数据范围',
    edit:edit.filter(code=>PERMISSION_CATALOG.some(p=>p.code===code)),
    special:special.filter(p=>!['role','user_role','config','permission'].includes(p.resource)).map(p=>({code:p.code,name:p.name})),
    scoped:!!resource && !hr && source!=='CUSTOM'};
}

export async function worksheetNavigationGrants(db:DB, actor:AuthorizationContext, roleIds:string[]) {
  if(actor.isSystemSuperAdmin || !roleIds.length) return actor;
  const policies = await db.worksheetRolePolicy.findMany({where:{table:{archived:false}},include:{table:{select:{source:true,inventoryKind:true,originBaseId:true,base:{select:{moduleSource:true}}}}}});
  const grants:EffectiveGrant[]=[];
  for(const policy of policies) {
    if(retiredSources.includes(policy.table.source)) continue;
    const rules=policy.rules as unknown as Record<string,TableRule>;
    const capabilities=tableBusinessCapabilities(policy.table);
    for(const roleId of roleIds) {
      const rule=rules[roleId];
      if(!rule?.business || rule.level==='DENY') continue;
      for(const code of [...new Set([...capabilities.basic,...(policy.table.originBaseId&&policy.table.base.moduleSource?tableBusinessCapabilities({source:policy.table.base.moduleSource,inventoryKind:null}).basic:[])])]) {
        const p=PERMISSION_CATALOG.find(p=>p.code===code)!;
        grants.push({sourceType:'ROLE',sourceId:'worksheet:'+policy.tableId+':'+roleId,sourceRoleId:roleId,
          permissionCode:p.code,resource:p.resource,scopeIds:[],validUntil:null});
      }
    }
  }
  const appPolicies=await db.roleApplicationPolicy.findMany({where:{roleId:{in:roleIds},canCreate:true}});
  const workspaces=await db.collabWorkspace.findMany({where:{id:{in:appPolicies.map(p=>p.workspaceId)}},select:{id:true,moduleGroup:true}});
  for(const p of appPolicies) {
    const group=workspaces.find(w=>w.id===p.workspaceId)?.moduleGroup;
    const sources:Record<string,string[]>={HUMAN_RESOURCES:['INVENTORY_STOCKTAKES'],ADMINISTRATION:['INVENTORY_MOVEMENTS'],INVENTORY:['INVENTORY_ITEMS'],CRM:['LEADS','CUSTOMERS','CHANNELS'],SIGNING:['CONTRACTS','NEGOTIATIONS'],CASES:['CASES'],FINANCE:['PAYMENTS','INVOICES','REFUNDS','COSTS'],PERFORMANCE:['PERFORMANCES']};
    for(const source of sources[group||''] || []) for(const code of tableBusinessCapabilities({source,inventoryKind:null}).basic) {
      const c=PERMISSION_CATALOG.find(c=>c.code===code)!;
      grants.push({sourceType:'ROLE',sourceId:'application:'+p.workspaceId,sourceRoleId:p.roleId,permissionCode:c.code,resource:c.resource,scopeIds:[],validUntil:null});
    }
  }
  return {...actor,activeRoleIds:roleIds,grants:[...actor.grants,...grants],
    permissionCodes:[...new Set([...actor.permissionCodes,...grants.map(g=>g.permissionCode)])]};
}

export async function worksheetContext(db:DB, actor:AuthorizationContext, tableId:string):Promise<AuthorizationContext> {
  if(actor.isSystemSuperAdmin) return actor;
  const table=await db.collabTable.findUnique({where:{id:tableId},include:{rolePolicy:true,fields:{where:{archived:false}}}});
  if(!table || retiredSources.includes(table.source)) return actor;
  const ids=actor.previewRoleId ? [actor.previewRoleId] : [...(actor.activeRoleIds ?? [...new Set(actor.grants.map(g=>g.sourceRoleId).filter((s):s is string=>!!s))])];
  const rules=(table.rolePolicy?.rules ?? {}) as unknown as Record<string,TableRule>;
  const invitation=(table.rolePolicy?.invitations as Record<string,string>|undefined)?.[actor.userId];
  if(invitation && !actor.previewRoleId && rules[invitation]?.business &&
    (presets.some(p=>p===invitation) || await db.role.findFirst({where:{id:invitation,type:'BUSINESS',status:'ENABLED'},select:{id:true}}))) ids.push(invitation);
  const extra:EffectiveGrant[]=[];
  const fieldRules=[...actor.fieldRules];
  for(const roleId of ids) {
    const rule=rules[roleId];
    if(!rule?.business || rule.level==='DENY') continue;
    const resource=tableBusinessCapabilities(table).resource;
    for(const field of table.fields) {
      const mode=rule.fields[field.id];
      const key=object(field.options).businessKey;
      const policy=FIELD_CATALOG.find(p=>p.resource===resource && p.field===key);
      if(mode && policy && policy.classification!=='FORBIDDEN' && policy.classification!=='L4')
        fieldRules.push({sourceRoleId:roleId,resource:resource!,fieldCode:policy.code,readLevel:mode==='HIDDEN'?'NONE':mode==='MASK'?'MASKED':'READ',
          canWrite:mode==='EDIT'&&['EDITOR','MANAGER'].includes(rule.level),canExport:rule.copy&&mode!=='HIDDEN'});
    }
    const scopedPermissions = [...rule.business.permissions];
    if (table.source === 'CASES' && ['EDITOR','MANAGER'].includes(rule.level) && rule.business.permissions.includes('case.update') &&
      table.fields.some(f => String(object(f.options).businessKey).startsWith('files.') && (rule.fields[f.id] ?? 'EDIT') === 'EDIT')) {
      scopedPermissions.push('case.file.read', 'case.file.manage');
    }
    for(const code of scopedPermissions) {
      const p=PERMISSION_CATALOG.find(p=>p.code===code);
      if(!p) continue;
      extra.push({sourceType:'ROLE',sourceId:'worksheet:'+tableId+':'+roleId,sourceRoleId:roleId,
        permissionCode:p.code,resource:p.resource,scopeIds:rule.business.scopeIds,validUntil:null});
    }
  }
  return {...actor, fieldRules, grants:[...actor.grants,...extra],
    permissionCodes:[...new Set([...actor.permissionCodes,...extra.map(g=>g.permissionCode)])]};
}

export function parseBusinessGrant(raw:unknown, table:Pick<CollabTable,'source'|'inventoryKind'>, level:string) {
  const value=object(raw);
  if(!Array.isArray(value.permissions)||!Array.isArray(value.scopeIds)||
    value.permissions.some(p=>typeof p!=='string')||value.scopeIds.some(s=>typeof s!=='string')) fail('COLLAB_INVALID_ACCESS');
  const caps=tableBusinessCapabilities(table);
  const writable=['EDITOR','MANAGER'].includes(level);
  const allowed=[...caps.basic,...(writable?caps.edit:[]),...caps.special.map(s=>s.code)];
  if(value.permissions.some(p=>!allowed.includes(String(p)))) fail('COLLAB_INVALID_ACCESS');
  const permissions=level==='DENY'?[]:[...new Set([...caps.basic,...(writable?caps.edit:[]),...value.permissions])] as PermissionCode[];
  return {permissions,scopeIds:[...new Set(value.scopeIds as string[])]};
}

export function worksheetRuleContext(actor:AuthorizationContext, rule:TableRule) {
  if(!rule.business) return actor;
  const permissions = rule.business.permissions;
  const grants = actor.grants.filter(g=>!permissions.includes(g.permissionCode));
  for(const code of permissions) {
    const p=PERMISSION_CATALOG.find(p=>p.code===code);
    if(p) grants.push({sourceType:'ROLE',sourceId:'worksheet-rule',permissionCode:p.code,resource:p.resource,
      scopeIds:rule.business.scopeIds,validUntil:null});
  }
  return {...actor,grants};
}
