import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,unlink,rm } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { CollaborationService,Access } from './collaboration-service';
import { exact,fail,integer,text } from './collaboration-policy';
import { resourcePolicy,restrictResourceAccess } from './resource-access';
const storage=()=>path.resolve(process.env.PERSONAL_FILES_STORAGE_ROOT||path.join(process.cwd(),'var/storage/personal-files'));
const nameOf=(raw:unknown)=>{const name=text(raw,150);if(/[\\/]/.test(name)||[...name].some(c=>c.charCodeAt(0)<32)||['.','..'].includes(name))fail('COLLAB_INVALID_VALUE');return name;};
const ownerGrant=(id:string)=>({principalType:'USER',principalId:id,role:'MANAGER',rowScope:'ALL',canCreate:true,hiddenFields:[] as string[],readonlyFields:[] as string[]});
function fileBytes(name:string,content:unknown){
  if(!/\.(pdf|docx?|xlsx?|pptx?|txt|csv|png|jpe?g|gif|webp|zip|rar|7z)$/i.test(name))fail('COLLAB_FILE_TYPE_UNSUPPORTED');
  if(typeof content!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(content))fail('COLLAB_INVALID_FILE');
  const bytes=Buffer.from(content,'base64');if(!bytes.length)fail('COLLAB_FILE_TOO_LARGE');
  return bytes;
}
// Expand structural descendants, including separately trashed items, once per tree.
function subtree<T extends {id:string;parentId:string|null}>(rows:T[], ids:string[]) {
  const children=new Map<string,T[]>();
  for(const row of rows)if(row.parentId)children.set(row.parentId,[...(children.get(row.parentId)??[]),row]);
  const byId=new Map(rows.map(row=>[row.id,row])),seen=new Set<string>(),result:T[]=[];
  const queue=[...ids];
  for(let i=0;i<queue.length;i++){
    const id=queue[i];if(seen.has(id))continue;seen.add(id);
    const row=byId.get(id);if(row)result.push(row);
    for(const child of children.get(id)??[])queue.push(child.id);
  }
  return result;
}
export class PersonalFiles extends CollaborationService {
  private async snapshot(tx:Prisma.TransactionClient=this.db){
    const [rows,principals]=await Promise.all([tx.personalFile.findMany({where:{deletedAt:null}}),this.principals(tx)]);
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
  protected async require(id:string,level=1,tx:Prisma.TransactionClient=this.db){const s=await this.snapshot(tx),r=s.resolve(id);if(!r||r.access.level<level)fail('COLLAB_FORBIDDEN',403);return r;}
  protected async snapshotVersion(id:string,tx:Prisma.TransactionClient){
    const row=await tx.personalFile.findUniqueOrThrow({where:{id}});
    if(row.kind!=='FILE'||!row.storageKey)fail('COLLAB_NOT_FOUND',404);
    if(await tx.personalFileVersion.findUnique({where:{fileId_version:{fileId:id,version:row.contentVersion}}}))return;
    const hash=createHash('sha256');
    for await(const chunk of createReadStream(path.join(storage(),row.storageKey)))hash.update(chunk);
    await tx.personalFileVersion.create({data:{fileId:id,version:row.contentVersion,name:row.name,storageKey:row.storageKey,size:row.size,sha256:hash.digest('hex'),source:'existing'}});
  }
  async list(raw:unknown){
    const v=exact(raw,['scope','parentId']);const scope=v.scope==='shared'?'shared':'mine';const parentId=v.parentId?text(v.parentId):null;
    const s=await this.snapshot();const parent=parentId?s.resolve(parentId):null;if(parentId&&(!parent||parent.row.kind!=='FOLDER'))fail('COLLAB_FORBIDDEN',403);
    return {path:parent?.path??[],canUpload:!parent||parent.access.level>=2,items:s.rows.flatMap(row=>{
      if(parentId?row.parentId!==parentId:scope==='mine'?row.ownerId!==this.actor.userId||!!row.parentId:row.ownerId===this.actor.userId)return [];
      const v=s.resolve(row.id);return v?[{id:row.id,name:row.name,kind:row.kind,size:row.kind==='FOLDER'?s.rows.reduce((total,child)=>{const visible=child.kind==='FILE'?s.resolve(child.id):null;return total+(visible?.path.some(part=>part.id===row.id)?child.size:0);},0):row.size,contentVersion:row.contentVersion,version:row.version,parentId:row.parentId,ownerId:row.ownerId,level:v.access.level,updatedAt:row.updatedAt,sharingState:this.sharingState(v.path.map(p=>s.rows.find(r=>r.id===p.id)!))}]:[];
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

    try{
      const result=await this.db.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
        const {row}=await this.require(id,2,tx);if(row.version!==integer(v.version))fail('COLLAB_ACCESS_CONFLICT',409);
        await this.snapshotVersion(id,tx);
        await tx.personalFile.update({where:{id},data:{name,storageKey,size:bytes.length,contentVersion:{increment:1},version:{increment:1}}});
        await tx.operationLog.create({data:{userId:this.actor.userId,action:'PERSONAL_FILE_REPLACE',targetType:'PERSONAL_FILE',targetId:id,
          oldValues:JSON.stringify({name:row.name,size:row.size}),newValues:JSON.stringify({name,size:bytes.length})}});
        return {version:row.version+1};
      });

      return result;
    }catch(e){await unlink(path.join(storage(),storageKey)).catch(()=>{});throw e;}
  }
  async download(id:string){const {row}=await this.require(id);if(row.kind!=='FILE'||!row.storageKey||!/^[a-f0-9-]{36}$/.test(row.storageKey))fail('COLLAB_NOT_FOUND',404);
    const content=await readFile(path.join(storage(),row.storageKey));return {name:row.name,content:content.toString('base64')};}
  private sharingState(chain: { ownerId: string; accessPolicy: unknown }[]) {
    let shared = false, inherited = false;
    for (const row of chain) {
      const policy = resourcePolicy(row.accessPolicy);
      inherited = shared && !policy.restricted;
      shared = inherited || policy.grants.some(g => g.role !== 'DENY' && !(g.principalType === 'USER' && g.principalId === row.ownerId));
    }
    return shared ? inherited ? 'inherited' : 'direct' : 'private';
  }
  private async sharingReport(id: string, path: {id:string;name:string}[]) {
    const rows = await this.db.personalFile.findMany({where:{id:{in:path.map(p=>p.id)},deletedAt:null}});
    const chain = path.map(p=>rows.find(r=>r.id===p.id)).filter((r):r is typeof rows[number]=>!!r);
    if(chain.length!==path.length) fail('COLLAB_ACCESS_CONFLICT',409);
    const grants=chain.flatMap(r=>resourcePolicy(r.accessPolicy).grants);
    const ids=(type:string)=>grants.filter(g=>g.principalType===type).map(g=>g.principalId);
    const [users,orgs,roles]=await Promise.all([
      this.db.user.findMany({where:{id:{in:ids('USER')}},select:{id:true,username:true,employee:{select:{name:true}}}}),
      this.db.organization.findMany({where:{id:{in:ids('ORG')}},select:{id:true,name:true}}),
      this.db.role.findMany({where:{id:{in:ids('ROLE')}},select:{id:true,name:true}}),
    ]);
    const labels=Object.fromEntries([...users.map(u=>['USER:'+u.id,(u.employee?.name?u.employee.name+'（'+u.username+'）':u.username)]),...orgs.map(o=>['ORG:'+o.id,o.name+'（部门）']),...roles.map(o=>['ROLE:'+o.id,o.name+'（角色）'])]);
    const sources=chain.map(row=>({id:row.id,name:row.name,ownerId:row.ownerId,restricted:resourcePolicy(row.accessPolicy).restricted,inherited:row.id!==id,grants:resourcePolicy(row.accessPolicy).grants}));
    // Resolve actual current principals using the same rules as content access, including
    // assignment dates, department ancestry, role expiry and departed employees.
    const candidates=await this.db.user.findMany({where:{status:'ENABLED',...(grants.some(g=>g.principalType!=='USER')?{}:{id:{in:ids('USER')}})},select:{id:true,username:true,employeeId:true,employee:{select:{name:true}}},orderBy:{username:'asc'}});
    const audience: {userId:string;name:string;username:string;level:number;matches:{sourceId:string;principalType:string;principalId:string;role:string}[]}[]=[];
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(6,candidates.length)},async()=>{
      while(cursor<candidates.length){
        const user=candidates[cursor++];
        const actor:typeof this.actor={...this.actor,userId:user.id,employeeId:user.employeeId,previewRoleId:undefined};
        const principals=await new PersonalFiles(this.db,actor).principals(this.db);
        const matches=sources.flatMap(source=>source.grants.filter(g=>principals.some(p=>p.principalType===g.principalType&&p.principalId===g.principalId)).map(g=>({sourceId:source.id,principalType:g.principalType,principalId:g.principalId,role:g.role})));
        if(!matches.length)continue;
        let access:Access={level:3,canCreate:true,canManageAccess:true,selfOnly:false,hidden:[],readonly:[],workspaceId:'personal',organizationId:null};
        try{for(const row of chain)access=restrictResourceAccess(access,row.accessPolicy,principals);}
        catch(e){if((e as {code:string}).code!=='COLLAB_FORBIDDEN')throw e;access={...access,level:0};}
        audience.push({userId:user.id,name:user.employee?.name||user.username,username:user.username,level:access.level,matches});
      }
    }));
    audience.sort((a,b)=>a.username.localeCompare(b.username));
    return {labels,sources,audience};
  }
  async accessSettings(id:string){
    const r=await this.require(id,3);
    const report=await this.sharingReport(id,r.path);
    return {id,name:r.row.name,kind:r.row.kind,version:r.row.version,policy:r.row.accessPolicy,path:r.path,ownerId:r.row.ownerId,...report};
  }
  async revokeShare(id:string,raw:unknown){
    const v=exact(raw,['version','principalType','principalId']);
    const principalType=text(v.principalType),principalId=text(v.principalId);
    if(!['USER','ROLE','ORG'].includes(principalType))fail('COLLAB_INVALID_ACCESS');
    const before=await this.require(id,3);
    const report=await this.sharingReport(id,before.path);
    const affected=report.audience.filter(u=>u.matches.some(m=>m.sourceId===id&&m.principalType===principalType&&m.principalId===principalId)).map(u=>u.userId);
    await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
      const {row}=await this.require(id,3,tx);
      if(row.version!==integer(v.version))fail('COLLAB_ACCESS_CONFLICT',409);
      if(principalType==='USER'&&principalId===row.ownerId)fail('COLLAB_FORBIDDEN',403);
      const policy=resourcePolicy(row.accessPolicy);
      if(!policy.grants.some(g=>g.principalType===principalType&&g.principalId===principalId))fail('COLLAB_ACCESS_CONFLICT',409);
      const next={...policy,grants:policy.grants.filter(g=>g.principalType!==principalType||g.principalId!==principalId)};
      await tx.personalFile.update({where:{id},data:{accessPolicy:next as unknown as Prisma.InputJsonValue,version:{increment:1}}});
      await tx.operationLog.create({data:{userId:this.actor.userId,action:'PERSONAL_FILE_SHARE_REVOKE',targetType:'PERSONAL_FILE',targetId:id,oldValues:JSON.stringify(row.accessPolicy),newValues:JSON.stringify(next)}});
    });
    const after=await this.sharingReport(id,before.path);
    return {retained:after.audience.filter(u=>affected.includes(u.userId)&&u.level>0).map(u=>({...u,sources:u.matches.filter(m=>m.role!=='DENY').map(m=>(after.sources.find(s=>s.id===m.sourceId)?.name||'')+' · '+(after.labels[m.principalType+':'+m.principalId]||m.principalType))}))};
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
  async remove(raw:unknown){
    const v=exact(raw,['files']);
    if(!Array.isArray(v.files)||v.files.length<1||v.files.length>1000)fail('COLLAB_INVALID_VALUE');
    const files=(v.files as unknown[]).map(item=>{const ref=exact(item,['id','version']);return {id:text(ref.id),version:integer(ref.version)};});
    if(new Set(files.map(f=>f.id)).size!==files.length)fail('COLLAB_INVALID_VALUE');
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
      // Validate the whole batch before any mutation, including inherited rights.
      const snapshot=await this.snapshot(tx);
      for(const file of files){const resolved=snapshot.resolve(file.id);if(!resolved||resolved.access.level<3)fail('COLLAB_FORBIDDEN',403);const {row}=resolved;if(row.version!==file.version)fail('COLLAB_ACCESS_CONFLICT',409);}
      for(const row of subtree(snapshot.rows,files.map(f=>f.id))){
        if((snapshot.resolve(row.id)?.access.level??0)<3)fail('COLLAB_FORBIDDEN',403);
      }
      // Only tombstone selected roots. Their descendants become inaccessible through
      // the ancestor check and restore together; earlier trashed children stay trashed.
      const selected=new Set(files.map(f=>f.id));
      const roots=files.filter(f=>!snapshot.resolve(f.id)!.path.slice(0,-1).some(p=>selected.has(p.id)));
      for(const file of roots){await tx.personalFile.update({where:{id:file.id},data:{deletedAt:new Date(),version:{increment:1}}});await tx.operationLog.create({data:{userId:this.actor.userId,action:'PERSONAL_FILE_DELETE',targetType:'PERSONAL_FILE',targetId:file.id}});}
      return {count:roots.length};
    });
  }
  async trash(){
    const [files,pending]=await Promise.all([
      this.db.personalFile.findMany({where:{ownerId:this.actor.userId,deletedAt:{not:null}},select:{id:true,name:true,kind:true,version:true,deletedAt:true},orderBy:{deletedAt:'desc'}}),
      this.db.personalFilePurge.findMany({where:{ownerId:this.actor.userId,completedAt:null},orderBy:{createdAt:'desc'}}),
    ]);
    return {items:[...pending.map(p=>({id:p.fileId,name:p.name,version:p.version,deletedAt:p.createdAt,purging:true})),...files.map(f=>({...f,purging:false}))]};
  }
  async purge(id:string,raw:unknown){
    const input=exact(raw,['version']);
    const result=await this.purgeMany({files:[{id,version:input.version}]});
    if(result.failed.length)fail('PERSONAL_FILE_PURGE_FAILED',500);
    return {ok:true};
  }
  async purgeMany(raw:unknown){
    const input=exact(raw,['files']);
    if(!Array.isArray(input.files)||!input.files.length||input.files.length>10000)fail('COLLAB_INVALID_VALUE');
    const refs=input.files.map(value=>{const ref=exact(value,['id','version']);return {id:text(ref.id),version:integer(ref.version)};});
    const rootIds=refs.map(ref=>ref.id);
    let ids=[...rootIds];
    if(new Set(ids).size!==ids.length)fail('COLLAB_INVALID_VALUE');
    // The submitted list is the confirmation snapshot. Never include files newly
    // moved to trash after the user reviewed a “clear recycle bin” confirmation.
    const [files,jobs]=await Promise.all([this.db.personalFile.findMany({where:{id:{in:ids}}}),this.db.personalFilePurge.findMany({where:{fileId:{in:ids}}})]);
    const byFile=new Map(files.map(f=>[f.id,f])),byJob=new Map(jobs.map(j=>[j.fileId,j]));
    for(const {id} of refs){const file=byFile.get(id),job=byJob.get(id);if(job?job.ownerId!==this.actor.userId:!file||file.ownerId!==this.actor.userId||!file.deletedAt)fail('COLLAB_FORBIDDEN',403);}
    const tree=await this.db.personalFile.findMany();
    const descendants=subtree(tree,rootIds);
    for(const row of descendants)if(row.ownerId!==this.actor.userId)fail('COLLAB_FORBIDDEN',403);
    // Capture every descendant version before taking upload locks; recheck the
    // entire tree under the lock, so concurrent restore/purge cannot be swept in.
    const expanded=new Map(refs.map(ref=>[ref.id,ref]));
    for(const row of descendants)if(!expanded.has(row.id))expanded.set(row.id,{id:row.id,version:row.version});
    ids=[...expanded.keys()];
    // Upload completion takes upload locks before the tree lock. A concurrent
    // restore changes the version, checked again before committing the whole batch.
    const uploads=await this.db.personalFileUpload.findMany({where:{OR:[{fileId:{in:ids}},{resultId:{in:ids}}]},select:{id:true,fileId:true,resultId:true},orderBy:{id:'asc'}});
    const receipts=await this.db.$transaction(async tx=>{
      for(const upload of uploads)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${upload.id},0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
      const currentTree=subtree(await tx.personalFile.findMany(),rootIds);
      const expected=new Map(descendants.map(row=>[row.id,row.version]));
      if(currentTree.length!==expected.size||currentTree.some(row=>expected.get(row.id)!==row.version))fail('COLLAB_ACCESS_CONFLICT',409);
      // Deepest nodes first to satisfy the parent foreign key. Pending cleanup
      // receipts have no live node and can be retried independently.
      const byId=new Map(currentTree.map(row=>[row.id,row]));
      const depth=(id:string):number=>{const seen=new Set<string>();let row=byId.get(id);while(row?.parentId&&byId.has(row.parentId)&&!seen.has(row.id)){seen.add(row.id);row=byId.get(row.parentId);}return seen.size;};
      const order=[...currentTree].sort((a,b)=>depth(b.id)-depth(a.id)).map(row=>expanded.get(row.id)!);
      order.push(...refs.filter(ref=>!expected.has(ref.id)));
      const receipts=[];
      for(const {id,version} of order){
        const previous=await tx.personalFilePurge.findUnique({where:{fileId:id}});
        if(previous){if(previous.ownerId!==this.actor.userId)fail('COLLAB_FORBIDDEN',403);if(previous.version!==version)fail('COLLAB_ACCESS_CONFLICT',409);receipts.push(previous);continue;}
        const row=await tx.personalFile.findUnique({where:{id}});
        if(!row||row.ownerId!==this.actor.userId||(rootIds.includes(id)&&!row.deletedAt))fail('COLLAB_FORBIDDEN',403);
        if(row.version!==version)fail('COLLAB_ACCESS_CONFLICT',409);
        const versions=await tx.personalFileVersion.findMany({where:{fileId:id}});
        const storageKeys=[...new Set([row.storageKey,...versions.map(v=>v.storageKey)].filter((key):key is string=>!!key))];
        const uploadIds=uploads.filter(u=>u.fileId===id||u.resultId===id).map(u=>u.id);
        if([...storageKeys,...uploadIds].some(key=>!/^[a-f0-9-]{36}$/i.test(key)))fail('COLLAB_INVALID_FILE');
        // A physical object referenced by another file must never be removed.
        if(await tx.personalFile.count({where:{id:{not:id},storageKey:{in:storageKeys}}})||await tx.personalFileVersion.count({where:{fileId:{not:id},storageKey:{in:storageKeys}}}))fail('PERSONAL_FILE_PURGE_REFERENCED',409);
        const job=await tx.personalFilePurge.create({data:{fileId:id,ownerId:row.ownerId,name:row.name,version,storageKeys,uploadIds}});
        await tx.personalFilePublication.deleteMany({where:{fileId:id}});
        await tx.personalFileVersion.deleteMany({where:{fileId:id}});
        await tx.personalFileUpload.deleteMany({where:{OR:[{fileId:id},{resultId:id}]}});
        await tx.personalFile.delete({where:{id}});
        await tx.operationLog.create({data:{userId:this.actor.userId,action:'PERSONAL_FILE_PURGE_REQUEST',targetType:'PERSONAL_FILE',targetId:id}});
        receipts.push(job);
      }
      return receipts;
    },{timeout:120000});
    // All permissions and versions passed before any disk deletion. Independent
    // cleanup failures remain retryable without holding up the rest of the batch.
    const failed:string[]=[];
    for(const receipt of receipts){
      try{await this.finishPurge(receipt);}catch{failed.push(receipt.fileId);}
    }
    return {count:receipts.length-failed.length,failed};
  }
  private async finishPurge(receipt:import('@prisma/client').PersonalFilePurge){
    if(receipt.completedAt)return;
    for(const key of receipt.storageKeys as string[])await unlink(path.join(storage(),key)).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});
    for(const uploadId of receipt.uploadIds as string[])await rm(path.join(storage(),'uploads',uploadId),{recursive:true,force:true});
    await this.db.$transaction(async tx=>{
      const result=await tx.personalFilePurge.updateMany({where:{fileId:receipt.fileId,completedAt:null},data:{completedAt:new Date(),storageKeys:[],uploadIds:[]}});
      if(result.count)await tx.operationLog.create({data:{userId:this.actor.userId,action:'PERSONAL_FILE_PURGE',targetType:'PERSONAL_FILE',targetId:receipt.fileId}});
    });
  }
  async restore(id:string,raw:unknown){
    const v=exact(raw,['version']);return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
      const row=await tx.personalFile.findUnique({where:{id}});
      if(!row||row.ownerId!==this.actor.userId||!row.deletedAt)fail('COLLAB_FORBIDDEN',403);
      if(row.version!==integer(v.version))fail('COLLAB_ACCESS_CONFLICT',409);
      if(row.parentId)await this.require(row.parentId,2,tx);
      await tx.personalFile.update({where:{id},data:{deletedAt:null,version:{increment:1}}});
      await tx.operationLog.create({data:{userId:this.actor.userId,action:'PERSONAL_FILE_RESTORE',targetType:'PERSONAL_FILE',targetId:id}});
      return {ok:true};
    });
  }
  async people(keyword:string){
    const q=keyword.slice(0,100);
    const [users,organizations,roles]=await Promise.all([
      this.db.user.findMany({where:{status:'ENABLED',OR:[{username:{contains:q}},{employee:{name:{contains:q}}}]},select:{id:true,username:true,employee:{select:{name:true}}},take:30}),
      this.db.organization.findMany({where:{status:'ENABLED',name:{contains:q}},select:{id:true,name:true},take:30}),
      this.db.role.findMany({where:{status:'ENABLED',type:'BUSINESS',name:{contains:q}},select:{id:true,name:true},take:30})]);
    return [...users.map(u=>({value:'USER:'+u.id,label:(u.employee?.name?u.employee.name+'（'+u.username+'）':u.username)+' · 用户'})),...organizations.map(o=>({value:'ORG:'+o.id,label:o.name+'（部门）'})),...roles.map(r=>({value:'ROLE:'+r.id,label:r.name+'（角色）'}))];
  }
}
