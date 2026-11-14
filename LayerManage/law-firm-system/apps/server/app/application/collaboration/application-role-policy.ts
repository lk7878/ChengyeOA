import type { Prisma, PrismaClient, CollabTable } from '@prisma/client';
import type { AuthorizationContext } from '../authorization/authorization-service';
import { defaultRule } from './worksheet-roles';
import { fail, exact, choice, boolean, integer, text } from './collaboration-policy';
import { tableBusinessCapabilities } from './worksheet-business-grants';
import { retiredSources } from '../../domain/module-availability';

type DB=Prisma.TransactionClient|PrismaClient;
export async function applicationPolicies(db:DB,actor:AuthorizationContext,workspaceId?:string) {
  const roleIds=actor.previewRoleId?[actor.previewRoleId]:actor.activeRoleIds??[];
  return db.roleApplicationPolicy.findMany({where:{roleId:{in:roleIds},...(workspaceId&&{workspaceId})}});
}
export async function mayCreateInApplication(db:DB,actor:AuthorizationContext,workspaceId:string) {
  return (await applicationPolicies(db,actor,workspaceId)).some(p=>p.canCreate);
}
export async function saveApplicationPolicy(tx:Prisma.TransactionClient,actor:AuthorizationContext,roleId:string,raw:unknown) {
  if(!actor.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN',403);
  const v=exact(raw,['workspaceId','canCreate','defaultLevel','version']);
  const workspaceId=text(v.workspaceId),canCreate=boolean(v.canCreate),defaultLevel=choice(v.defaultLevel,['DENY','READER','EDITOR']);
  const workspace=await tx.collabWorkspace.findUnique({where:{id:workspaceId}});
  if(!workspace?.moduleGroup || ['QUALITY','DELIVERY'].includes(workspace.moduleGroup)) fail('COLLAB_INVALID_ACCESS');
  await tx.$queryRaw`SELECT id FROM collab_workspace WHERE id=${workspaceId} FOR UPDATE`;
  const old=await tx.roleApplicationPolicy.findUnique({where:{roleId_workspaceId:{roleId,workspaceId}}});
  if(integer(v.version,0)!==(old?.version??0)) fail('COLLAB_ACCESS_CONFLICT',409);
  const data={canCreate,defaultLevel,version:(old?.version??0)+1};
  await tx.roleApplicationPolicy.upsert({where:{roleId_workspaceId:{roleId,workspaceId}},create:{roleId,workspaceId,...data},update:data});
  await tx.operationLog.create({data:{userId:actor.userId,action:'ROLE_APPLICATION_POLICY',targetType:'ROLE_AUTHORIZATION',targetId:roleId,
    oldValues:JSON.stringify(old),newValues:JSON.stringify({workspaceId,...data})}});
}
export async function initializeTablePolicies(tx:Prisma.TransactionClient,table:CollabTable,workspaceId:string,creator?:string) {
  const applicationSettings=await tx.roleApplicationPolicy.findMany({where:{workspaceId}});
  if(!applicationSettings.length) return;
  if(creator) await tx.collabTable.update({where:{id:table.id},data:{accessPolicy:{restricted:true,grants:[
    {principalType:'USER',principalId:creator,role:'MANAGER',rowScope:'ALL',canCreate:true,hiddenFields:[],readonlyFields:[]}
  ]}}});
  const rules:Record<string,unknown>={}, invitations:Record<string,string>={};
  if(creator) {
    const caps=tableBusinessCapabilities(table);
    rules.MANAGER={...defaultRule('MANAGER'),remove:false,copy:false,automate:false,share:true,
      business:{permissions:[...caps.basic,...caps.edit],scopeIds:caps.scoped?['worksheet:self']:[]}};
    invitations[creator]='MANAGER';
  }
  // Business and sensitive standard tables always need explicit authorization.
  if(table.source==='CUSTOM' && !table.inventoryKind && !table.lifecycleKind) {
    const defaults=await tx.roleApplicationPolicy.findMany({where:{workspaceId,defaultLevel:{not:'DENY'}}});
    const active=await tx.role.findMany({where:{id:{in:defaults.map(p=>p.roleId)},status:'ENABLED'},select:{id:true}});
    for(const p of defaults.filter(p=>active.some(r=>r.id===p.roleId)))
      rules[p.roleId]={...defaultRule(p.defaultLevel as 'READER'|'EDITOR'),remove:false,copy:false,automate:false,share:false,
        business:{permissions:[],scopeIds:[]}};
  }
  if(!retiredSources.includes(table.source)&&Object.keys(rules).length)
    await tx.worksheetRolePolicy.create({data:{tableId:table.id,rules:rules as Prisma.InputJsonObject,invitations,version:1}});
}
