import {Prisma, PrismaClient} from '@prisma/client';
import {AuthorizationContext} from '../authorization/authorization-service';
import {CollaborationService} from './collaboration-service';
import {assignmentCandidates, isProspectAssignee, isProspectTable} from './prospect-assignment';
import {appendCollaborationChange} from './collaboration-change';
import {fail, json, object} from './collaboration-policy';

/** Explicit department selection, no ACL changes, all-or-nothing conversion.
 * Ambiguous/unknown legacy names abort instead of discarding or guessing an identity. */
export async function migrateProspectAssignments(db:PrismaClient, actor:AuthorizationContext, targets:{tableId:string;organizationId:string}[], apply=false) {
 if(!actor.isSystemSuperAdmin)fail('COLLAB_FORBIDDEN',403);
 return db.$transaction(async tx=>{
  const report:{tableId:string;name:string;organizationId:string;converted:number;changed:boolean}[]=[];
  for(const target of [...targets].sort((a,b)=>a.tableId.localeCompare(b.tableId))){
   const initial=await new CollaborationService(db,actor).tableAccess(target.tableId,tx,3);
   await tx.$queryRaw`SELECT id FROM collab_workspace WHERE id=${initial.access.workspaceId} FOR UPDATE`;
   const {table}=await new CollaborationService(db,actor).tableAccess(target.tableId,tx,3);
   if(!isProspectTable(table)) fail('COLLAB_INVALID_OPTIONS');
   const fs=table.fields.filter(f=>!f.archived&&(f.name==='跟进人'||isProspectAssignee(f)));
   if(fs.length!==1 || !['TEXT','LONG_TEXT','USER'].includes(fs[0].type))fail('COLLAB_ASSIGNMENT_FIELD_DUPLICATE',409);
   const field=fs[0];
   const candidates=await assignmentCandidates(tx,target.organizationId);
   if(!await tx.organization.findFirst({where:{id:target.organizationId,status:'ENABLED'}}))fail('COLLAB_ORGANIZATION_UNAVAILABLE');
   const convert=(raw:unknown)=>{
    if(raw==null || raw==='')return raw;
    if(typeof raw!=='string')fail('COLLAB_FIELD_MIGRATION_REQUIRED',409);
    const matches=candidates.filter(e=>e.id===raw || e.name===String(raw).trim());
    if(matches.length!==1)fail('COLLAB_ASSIGNMENT_LEGACY_UNRESOLVED',409,{tableId:table.id,fieldId:field.id});
    return matches[0].id;
   };
   const records=await tx.collabRecord.findMany({where:{tableId:table.id}});
   const updates=records.map(r=>({record:r,before:object(r.values)[field.id],after:convert(object(r.values)[field.id])})).filter(r=>r.before!==r.after);
   const nextDefault=convert(field.defaultValue);
   // Shared and personal filters must continue to point at the same person.
   const mapConfig=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(mapConfig);
    if(value===null || typeof value!=='object')return value;
    const next={...(value as Record<string,unknown>)};
    if(next.fieldId===field.id && next.value!=null && next.value!=='$currentUser')next.value=Array.isArray(next.value)?next.value.map(convert):convert(next.value);
    for(const k of Object.keys(next))if(k!=='value')next[k]=mapConfig(next[k]);
    return next;
   };
   const views=await tx.collabView.findMany({where:{tableId:table.id}});
   const convertedViews=views.map(v=>({view:v,config:mapConfig(v.config)}));
   const policy=await tx.worksheetRolePolicy.findUnique({where:{tableId:table.id}});
   const convertedRules=policy?mapConfig(policy.rules):null;
   const changed=field.type!=='USER'||!isProspectAssignee(field)||object(field.options).assignmentOrganizationId!==target.organizationId||updates.length>0;
   report.push({tableId:table.id,name:table.name,organizationId:target.organizationId,converted:updates.length,changed});
   if(!apply||!changed)continue;
   for(const {record,before,after} of updates){
    const saved=await tx.collabRecord.update({where:{id:record.id},data:{values:json({...object(record.values),[field.id]:after}),updatedBy:actor.userId,version:{increment:1}}});
    await tx.collabRevision.create({data:{recordId:saved.id,version:saved.version,actorId:actor.userId,changes:json({[field.id]:{before,after}})}});
   }
   await tx.collabField.update({where:{id:field.id},data:{type:'USER',defaultValue:nextDefault==null?Prisma.DbNull:json(nextDefault),options:json({...object(field.options),prospectAssignee:true,assignmentOrganizationId:target.organizationId})}});
   for(const {view,config} of convertedViews)if(JSON.stringify(view.config)!==JSON.stringify(config))await tx.collabView.update({where:{id:view.id},data:{config:json(config),version:{increment:1}}});
   if(policy&&JSON.stringify(policy.rules)!==JSON.stringify(convertedRules))await tx.worksheetRolePolicy.update({where:{tableId:table.id},data:{rules:json(convertedRules),version:{increment:1}}});
   await tx.collabTable.update({where:{id:table.id},data:{schemaVersion:{increment:1}}});
   await appendCollaborationChange(tx,actor.userId,table.baseId,'prospect.assignment.migrated',table.id);
  }
  return report;
 },{isolationLevel:'Serializable',timeout:30000});
}
