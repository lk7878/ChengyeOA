import { CollabField, PrismaClient } from '@prisma/client';
import { CollaborationService } from './collaboration-service';
import { worksheetContext } from './worksheet-business-grants';
import { AuthorizationContext } from '../authorization/authorization-service';
import { object,fail,text } from './collaboration-policy';
export async function medicalCustomer(db:PrismaClient,actor:AuthorizationContext,value:string){
  const [tableId,id,...rest]=value.split(':');if(!tableId||!id||rest.length)fail('COLLAB_INVALID_VALUE');
  const svc=new CollaborationService(db,await worksheetContext(db,actor,tableId));
  const {table,fields}=await svc.tableAccess(tableId);
  if(table.source!=='FOLLOWS')fail('COLLAB_INVALID_SOURCE');
  const {record}=await svc.record(tableId,id);
  const values:Record<string,unknown>={};
  for(const key of ['customerName','wechat','douyinName','phone','region']){
    const f=fields.find(f=>object(f.options).businessKey===key);
    // A hidden or masked source field must never be copied into a plaintext field.
    if(!f||object(f.options).worksheetMasked||(record as {readonlyFields?:string[]}).readonlyFields?.includes(f.id)&&object(f.options).conditionalField)fail('COLLAB_FIELD_UNAVAILABLE',403);
    const value=record.values[f.id];values[key]=value??null;
  }
  return values;
}
export async function medicalOptions(db:PrismaClient,actor:AuthorizationContext,destination:string,keyword:string){
  const svc=new CollaborationService(db,actor),target=await svc.tableAccess(destination);
  if(target.table.followSupportKind!=='MEDICAL_ASSESSMENT')fail('COLLAB_INVALID_SOURCE');
  const tables=await db.collabTable.findMany({where:{source:'FOLLOWS',archived:false},orderBy:{id:'asc'},take:200});
  const options: {value:string;label:string}[]=[];
  for(const table of tables){
    try{
      const source=new CollaborationService(db,await worksheetContext(db,actor,table.id));
      const {fields}=await source.tableAccess(table.id);
      const name=fields.find(f=>object(f.options).businessKey==='customerName');if(!name||object(name.options).worksheetMasked)continue;
      const rows=await source.query(table.id,{pageSize:30,config:keyword?{filter:{fieldId:name.id,operator:'contains',value:keyword}}:{}});
      for(const row of rows.records) options.push({value:table.id+':'+row.id,label:String(row.values[name.id]??'未命名客户')+' · '+table.name});
      if(options.length>=100)break;
    }catch(e){if(!['COLLAB_FORBIDDEN','COLLAB_NOT_FOUND','COLLAB_FIELD_UNAVAILABLE'].includes((e as {code:string}).code))throw e;}
  }
  return options.slice(0,100);
}
export async function prepareMedicalValues(db:PrismaClient,actor:AuthorizationContext,fields:CollabField[],raw:unknown,previous:unknown,restoreSnapshot=false){
  const input={...object(raw)},old=object(previous??{}),link=fields.find(f=>object(f.options).medicalRelation);
  if(!link)return input;
  const auto=fields.filter(f=>object(f.options).medicalAutofill);
  const selected=Object.hasOwn(input,link.id)?input[link.id]:old[link.id];
  const changed=Object.hasOwn(input,link.id)&&input[link.id]!==old[link.id];
  if(restoreSnapshot){
    // Only operation history can supply these values; never accept this flag from API input.
    if(changed&&selected)await medicalCustomer(db,actor,text(selected));
    return input;
  }
  if(selected){
    if(auto.some(f=>Object.hasOwn(input,f.id)))fail('MEDICAL_LINKED_FIELD_READONLY',403);
    if(changed){
      const values=await medicalCustomer(db,actor,text(selected));
      for(const f of auto)input[f.id]=values[String(object(f.options).medicalAutofill)]??null;
    }
  }else if(changed&&old[link.id]){for(const f of auto)if(!Object.hasOwn(input,f.id))input[f.id]=null;}
  return input;
}
