import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { PersonalFileTransfer } from '../../app/application/collaboration/personal-file-transfer';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
const db=createTestPrisma();
const context=(userId:string,isSystemSuperAdmin=false):AuthorizationContext=>({userId,isSystemSuperAdmin,isSystemAdmin:false,employeeId:null,grants:[],fieldRules:[],permissionCodes:[],evaluatedAt:new Date()});
let dir:string,previousRoot:string|undefined,owner:PersonalFileTransfer,other:PersonalFileTransfer,root:PersonalFileTransfer;
test.before(async()=>{previousRoot=process.env.PERSONAL_FILES_STORAGE_ROOT;dir=await mkdtemp(path.join(tmpdir(),'oa-purge-'));process.env.PERSONAL_FILES_STORAGE_ROOT=dir;});
test.beforeEach(async()=>{await clearTestApplicationData(db);const users=await Promise.all([0,1,2].map(()=>db.user.create({data:{username:randomUUID(),password:'unused'}})));[owner,other,root]=users.map((u,i)=>new PersonalFileTransfer(db,context(u.id,i===2)));});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect();await rm(dir,{recursive:true,force:true});if(previousRoot===undefined)delete process.env.PERSONAL_FILES_STORAGE_ROOT;else process.env.PERSONAL_FILES_STORAGE_ROOT=previousRoot;});
const create=()=>owner.create({name:'待删除.txt',kind:'FILE',content:Buffer.from('v1').toString('base64')});

test('only the owner can purge a trashed file, removing all versions, grants and upload chunks idempotently',async()=>{
 const file=await create();
 await assert.rejects(owner.purge(file.id,{version:1}),/COLLAB_FORBIDDEN/);
 await owner.replace(file.id,{name:'新版.txt',version:1,content:Buffer.from('v2').toString('base64')});
 await owner.versions(file.id);
 const versions=await db.personalFileVersion.findMany({where:{fileId:file.id}});
 assert.equal(versions.length,2);
 const upload=await owner.begin({fileId:file.id,version:2,name:'未完成.txt',size:3});
 await owner.chunk(upload.id,0,Readable.from(Buffer.from('abc')));
 await owner.grantPublication(file.id,{userId:other.actor.userId,allowed:true});
 await owner.remove({files:[{id:file.id,version:2}]});
 await assert.rejects(other.purge(file.id,{version:3}),/COLLAB_FORBIDDEN/);
 await assert.rejects(root.purge(file.id,{version:3}),/COLLAB_FORBIDDEN/);
 await assert.rejects(owner.purge(file.id,{version:2}),/COLLAB_ACCESS_CONFLICT/);
 assert.equal(await db.personalFileVersion.count({where:{fileId:file.id}}),2);
 for(const v of versions)assert.ok(await stat(path.join(dir,v.storageKey)));
 await owner.purge(file.id,{version:3});
 await owner.purge(file.id,{version:3});
 assert.equal(await db.personalFile.count({where:{id:file.id}}),0);
 assert.equal(await db.personalFileVersion.count({where:{fileId:file.id}}),0);
 assert.equal(await db.personalFilePublication.count({where:{fileId:file.id}}),0);
 assert.equal(await db.personalFileUpload.count({where:{id:upload.id}}),0);
 for(const v of versions)await assert.rejects(stat(path.join(dir,v.storageKey)),{code:'ENOENT'});
 await assert.rejects(stat(path.join(dir,'uploads',upload.id)),{code:'ENOENT'});
 await assert.rejects(owner.restore(file.id,{version:3}),/COLLAB_FORBIDDEN/);
 await assert.rejects(owner.content(file.id,1));
 await assert.rejects(owner.complete(upload.id));
 await assert.rejects(other.purge(file.id,{version:3}),/COLLAB_FORBIDDEN/);
 assert.equal((await owner.trash()).items.length,0);
 assert.equal(await db.operationLog.count({where:{action:'PERSONAL_FILE_PURGE'}}),1);
});

test('disk cleanup failure survives a fresh service instance and remains retryable but not restorable',async()=>{
 const file=await create(),row=await db.personalFile.findUniqueOrThrow({where:{id:file.id}});
 await owner.remove({files:[{id:file.id,version:1}]});
 // A directory in place of the blob makes unlink fail without modifying unrelated paths.
 const blob=path.join(dir,row.storageKey!);await rm(blob);await mkdir(blob);
 await assert.rejects(owner.purge(file.id,{version:2}),/PERSONAL_FILE_PURGE_FAILED/);
 const restarted=new PersonalFileTransfer(db,owner.actor);
 const trash=await restarted.trash();assert.equal(trash.items[0].purging,true);
 assert.equal((await other.trash()).items.length,0);
 await assert.rejects(restarted.restore(file.id,{version:2}),/COLLAB_FORBIDDEN/);
 await rm(blob,{recursive:true});
 await restarted.purge(file.id,{version:2});
 assert.equal((await restarted.trash()).items.length,0);
 assert.ok((await db.personalFilePurge.findUniqueOrThrow({where:{fileId:file.id}})).completedAt);
});

test('restore and purge serialize: stale deletion cannot remove a restored file',async()=>{
 const file=await create();await owner.remove({files:[{id:file.id,version:1}]});
 await owner.restore(file.id,{version:2});
 await assert.rejects(owner.purge(file.id,{version:2}),/COLLAB_FORBIDDEN/);
 assert.equal(Buffer.from((await owner.download(file.id)).content,'base64').toString(),'v1');
 await owner.remove({files:[{id:file.id,version:3}]});
 const results=await Promise.allSettled([owner.restore(file.id,{version:4}),owner.purge(file.id,{version:4})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const row=await db.personalFile.findUnique({where:{id:file.id}});
 if(row){assert.equal(row.deletedAt,null);assert.equal((await readFile(path.join(dir,row.storageKey!))).toString(),'v1');}
 else assert.ok((await db.personalFilePurge.findUniqueOrThrow({where:{fileId:file.id}})).completedAt);
});

test('bulk purge validates the entire confirmation snapshot before deleting any file',async()=>{
 const first=await create(),second=await create();
 const foreign=await other.create({name:'他人.txt',kind:'FILE',content:Buffer.from('other').toString('base64')});
 await owner.remove({files:[{id:first.id,version:1},{id:second.id,version:1}]});
 await other.remove({files:[{id:foreign.id,version:1}]});
 await assert.rejects(owner.purgeMany({files:[{id:first.id,version:2},{id:foreign.id,version:2}]}),/COLLAB_FORBIDDEN/);
 await assert.rejects(owner.purgeMany({files:[{id:first.id,version:2},{id:second.id,version:1}]}),/COLLAB_ACCESS_CONFLICT/);
 assert.equal(await db.personalFilePurge.count(),0);assert.equal((await owner.trash()).items.length,2);
 const before=(await db.personalFile.findUniqueOrThrow({where:{id:first.id}})).storageKey!;
 assert.equal((await readFile(path.join(dir,before))).toString(),'v1');
 // A later deletion must not silently join the earlier “empty trash” confirmation.
 const later=await create();await owner.remove({files:[{id:later.id,version:1}]});
 const result=await owner.purgeMany({files:[{id:first.id,version:2},{id:second.id,version:2}]});
 assert.deepEqual(result,{count:2,failed:[]});
 assert.deepEqual((await owner.trash()).items.map(f=>f.id),[later.id]);
 assert.equal((await other.trash()).items[0].id,foreign.id);
});

test('bulk disk cleanup reports partial failure and retries completed items safely',async()=>{
 const first=await create(),second=await create();
 const blob=path.join(dir,(await db.personalFile.findUniqueOrThrow({where:{id:first.id}})).storageKey!);
 await owner.remove({files:[{id:first.id,version:1},{id:second.id,version:1}]});
 await rm(blob);await mkdir(blob);
 const files=[{id:first.id,version:2},{id:second.id,version:2}];
 assert.deepEqual(await owner.purgeMany({files}),{count:1,failed:[first.id]});
 assert.equal((await owner.trash()).items[0].purging,true);
 await rm(blob,{recursive:true});
 assert.deepEqual(await owner.purgeMany({files}),{count:2,failed:[]});
 assert.equal((await owner.trash()).items.length,0);
 assert.equal(await db.operationLog.count({where:{action:'PERSONAL_FILE_PURGE'}}),2);
 await assert.rejects(owner.purgeMany({files:[files[0],files[0]]}),/COLLAB_INVALID_VALUE/);
});
