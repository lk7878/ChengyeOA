import { randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,unlink } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { CollaborationService,Access } from './collaboration-service';
import { exact,fail,integer,text } from './collaboration-policy';
import { resourcePolicy,restrictResourceAccess } from './resource-access';
const storage=()=>path.resolve(process.cwd(),'var/storage/personal-files');
const nameOf=(raw:unknown)=>{const name=text(raw,150);if(/[\\/]/.test(name)||[...name].some(c=>c.charCodeAt(0)<32)||['.','..'].includes(name))fail('COLLAB_INVALID_VALUE');return name;};
const ownerGrant=(id:string)=>({principalType:'USER',principalId:id,role:'MANAGER',rowScope:'ALL',canCreate:true,hiddenFields:[] as string[],readonlyFields:[] as string[]});
function fileBytes(name:string,content:unknown){
  if(!/\.(pdf|docx?|xlsx?|pptx?|txt|csv|png|jpe?g|gif|webp|zip|rar|7z)$/i.test(name))fail('COLLAB_FILE_TYPE_UNSUPPORTED');
  if(typeof content!=='string'||content.length>14*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(content))fail('COLLAB_INVALID_FILE');
  const bytes=Buffer.from(content,'base64');if(!bytes.length||bytes.length>10*1024*1024)fail('COLLAB_FILE_TOO_LARGE');
  return bytes;
}
export class PersonalFiles extends CollaborationService {
  private async snapshot(tx:Prisma.TransactionClient=this.db){
    const [rows,principals]=await Promise.all([tx.personalFile.findMany(),this.principals(tx)]);
    const byId=new Map(rows.map(r=>[r.id,r]));
    const root:Access={level:3,canCreate:true,canManageAccess:true,selfOnly:false,hidden:[],readonly:[],workspaceId:'personal',organizationId:null};
    const resolve=(id:string,trail:string[]=[]):{row:typeof rows[number];access:Access;path:{id:string;name:string}[]}|null=>{
      const row=byId.get(id);if(!row||trail.includes(id)||trail.length>12)return null;
      const parent=row.parentId?resolve(row.parentId,[...trail,id]):null;
      if(row.parentId&&(!parent||parent.row.kind!=='FOLDER'))return null;
      try{const access=restrictResourceAccess(parent?.access??root,row.accessPolicy,principals);return {row,access,path:[...(parent?.path??[]),{id:row.id,name:row.name}]};}
      catch(e){if((e as {code:string}).code!=='COLLAB_FORBIDDEN')throw e;return null;}
    };
    return {rows,resolve};
  }
  private async require(id:string,level=1,tx:Prisma.TransactionClient=this.db){const s=await this.snapshot(tx),r=s.resolve(id);if(!r||r.access.level<level)fail('COLLAB_FORBIDDEN',403);return r;}
  async list(raw:unknown){
    const v=exact(raw,['scope','parentId']);const scope=v.scope==='shared'?'shared':'mine';const parentId=v.parentId?text(v.parentId):null;
    const s=await this.snapshot();const parent=parentId?s.resolve(parentId):null;if(parentId&&(!parent||parent.row.kind!=='FOLDER'))fail('COLLAB_FORBIDDEN',403);
    return {path:parent?.path??[],canUpload:!parent||parent.access.level>=2,items:s.rows.flatMap(row=>{
      if(parentId?row.parentId!==parentId:scope==='mine'?row.ownerId!==this.actor.userId||!!row.parentId:row.ownerId===this.actor.userId)return [];
      const v=s.resolve(row.id);return v?[{id:row.id,name:row.name,kind:row.kind,size:row.size,version:row.version,parentId:row.parentId,ownerId:row.ownerId,level:v.access.level,updatedAt:row.updatedAt}]:[];
    }).sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name))};
  }
  async create(raw:unknown){
    const v=exact(raw,['name','kind','parentId','content']);const name=nameOf(v.name),parentId=v.parentId?text(v.parentId):null;
    const kind=v.kind==='FOLDER'?'FOLDER':v.kind==='FILE'?'FILE':fail('COLLAB_INVALID_VALUE');
    const storageKey=kind==='FILE'?randomUUID():null;let size=0;
    if(kind==='FILE'){
      const bytes=fileBytes(name,v.content);size=bytes.length;
      // Check the parent before persisting any bytes, then recheck under the tree lock.
      if(parentId){const p=await this.require(parentId,2);if(p.row.kind!=='FOLDER'||p.path.length>=12)fail('COLLAB_INVALID_VALUE');}
      await mkdir(storage(),{recursive:true});await writeFile(path.join(storage(),storageKey!),bytes,{flag:'wx',mode:0o600});
    }
    try{return await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
      if(parentId){const p=await this.require(parentId,2,tx);if(p.row.kind!=='FOLDER'||p.path.length>=12)fail('COLLAB_INVALID_VALUE');}
      const row=await tx.personalFile.create({data:{name,kind,parentId,ownerId:this.actor.userId,storageKey,size,accessPolicy:{restricted:!parentId,grants:[ownerGrant(this.actor.userId)]}}});
      await tx.operationLog.create({data:{userId:this.actor.userId,action:'PERSONAL_FILE_CREATE',targetType:'PERSONAL_FILE',targetId:row.id,newValues:JSON.stringify({kind,parentId,size})}});
      return {id:row.id};
    });}catch(e){if(storageKey)await unlink(path.join(storage(),storageKey)).catch(()=>{});throw e;}
  }
  async replace(id:string,raw:unknown){
    const v=exact(raw,['name','version','content']),name=nameOf(v.name),bytes=fileBytes(name,v.content);
    const current=await this.require(id,2);if(current.row.kind!=='FILE')fail('COLLAB_INVALID_VALUE');
    const storageKey=randomUUID();await mkdir(storage(),{recursive:true});
    await writeFile(path.join(storage(),storageKey),bytes,{flag:'wx',mode:0o600});
    let previous:string|null=null;
    try{
      const result=await this.db.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
        const {row}=await this.require(id,2,tx);if(row.version!==integer(v.version))fail('COLLAB_ACCESS_CONFLICT',409);
        previous=row.storageKey;
        await tx.personalFile.update({where:{id},data:{name,storageKey,size:bytes.length,version:{increment:1}}});
        await tx.operationLog.create({data:{userId:this.actor.userId,action:'PERSONAL_FILE_REPLACE',targetType:'PERSONAL_FILE',targetId:id,
          oldValues:JSON.stringify({name:row.name,size:row.size}),newValues:JSON.stringify({name,size:bytes.length})}});
        return {version:row.version+1};
      });
      if(previous&&/^[a-f0-9-]{36}$/.test(previous))await unlink(path.join(storage(),previous)).catch(()=>{});
      return result;
    }catch(e){await unlink(path.join(storage(),storageKey)).catch(()=>{});throw e;}
  }
  async download(id:string){const {row}=await this.require(id);if(row.kind!=='FILE'||!row.storageKey||!/^[a-f0-9-]{36}$/.test(row.storageKey))fail('COLLAB_NOT_FOUND',404);
    const content=await readFile(path.join(storage(),row.storageKey));return {name:row.name,content:content.toString('base64')};}
  async accessSettings(id:string){
    const r=await this.require(id,3),policy=resourcePolicy(r.row.accessPolicy);
    const ids=(type:string)=>policy.grants.filter(g=>g.principalType===type).map(g=>g.principalId);
    const [users,orgs,roles]=await Promise.all([
      this.db.user.findMany({where:{id:{in:ids('USER')}},select:{id:true,username:true,employee:{select:{name:true}}}}),
      this.db.organization.findMany({where:{id:{in:ids('ORG')}},select:{id:true,name:true}}),
      this.db.role.findMany({where:{id:{in:ids('ROLE')}},select:{id:true,name:true}}),
    ]);
    const labels=Object.fromEntries([...users.map(u=>['USER:'+u.id,(u.employee?.name??u.username)+'（用户）']),...orgs.map(o=>['ORG:'+o.id,o.name+'（部门）']),...roles.map(o=>['ROLE:'+o.id,o.name+'（角色）'])]);
    return {id,name:r.row.name,version:r.row.version,policy:r.row.accessPolicy,path:r.path,ownerId:r.row.ownerId,labels};
  }
  async share(id:string,raw:unknown){
    const v=exact(raw,['version','policy']);const policy=resourcePolicy(v.policy);
    if(policy.grants.some(g=>!['USER','ROLE','ORG'].includes(g.principalType)||!['READER','EDITOR','MANAGER','DENY'].includes(g.role)||g.rowScope!=='ALL'||g.hiddenFields.length||g.readonlyFields.length))fail('COLLAB_INVALID_ACCESS');
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
      const {row}=await this.require(id,3,tx);if(row.version!==integer(v.version))fail('COLLAB_ACCESS_CONFLICT',409);
      for(const g of policy.grants){const valid=g.principalType==='USER'?await tx.user.count({where:{id:g.principalId,status:'ENABLED'}}):g.principalType==='ROLE'?await tx.role.count({where:{id:g.principalId,status:'ENABLED'}}):await tx.organization.count({where:{id:g.principalId,status:'ENABLED'}});if(!valid)fail('COLLAB_INVALID_PRINCIPAL');}
      const next={restricted:row.parentId?policy.restricted:true,grants:[...policy.grants.filter(g=>g.principalType!=='USER'||g.principalId!==row.ownerId),ownerGrant(row.ownerId)]};
      await tx.personalFile.update({where:{id},data:{accessPolicy:next as unknown as Prisma.InputJsonValue,version:{increment:1}}});
      await tx.operationLog.create({data:{userId:this.actor.userId,action:'PERSONAL_FILE_SHARE',targetType:'PERSONAL_FILE',targetId:id,oldValues:JSON.stringify(row.accessPolicy),newValues:JSON.stringify(next)}});
      return {version:row.version+1};
    });
  }
  async rename(id:string,raw:unknown){const v=exact(raw,['name','version']);return this.db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
    const {row}=await this.require(id,2,tx);if(row.version!==integer(v.version))fail('COLLAB_ACCESS_CONFLICT',409);
    await tx.personalFile.update({where:{id},data:{name:nameOf(v.name),version:{increment:1}}});return {version:row.version+1};});}
  async people(keyword:string){
    const q=keyword.slice(0,100);
    const [users,organizations,roles]=await Promise.all([
      this.db.user.findMany({where:{status:'ENABLED',OR:[{username:{contains:q}},{employee:{name:{contains:q}}}]},select:{id:true,username:true,employee:{select:{name:true}}},take:30}),
      this.db.organization.findMany({where:{status:'ENABLED',name:{contains:q}},select:{id:true,name:true},take:30}),
      this.db.role.findMany({where:{status:'ENABLED',type:'BUSINESS',name:{contains:q}},select:{id:true,name:true},take:30})]);
    return [...users.map(u=>({value:'USER:'+u.id,label:(u.employee?.name??u.username)+'（用户）'})),...organizations.map(o=>({value:'ORG:'+o.id,label:o.name+'（部门）'})),...roles.map(r=>({value:'ROLE:'+r.id,label:r.name+'（角色）'}))];
  }
}
