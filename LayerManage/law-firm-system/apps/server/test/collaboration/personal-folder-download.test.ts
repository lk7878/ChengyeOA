import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { PersonalFileTransfer } from '../../app/application/collaboration/personal-file-transfer';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
const db=createTestPrisma();
const context=(userId:string):AuthorizationContext=>({userId,isSystemSuperAdmin:false,isSystemAdmin:false,employeeId:null,grants:[],fieldRules:[],permissionCodes:[],evaluatedAt:new Date()});
let dir:string,previous:string|undefined,owner:PersonalFileTransfer,reader:PersonalFileTransfer;
test.before(async()=>{previous=process.env.PERSONAL_FILES_STORAGE_ROOT;dir=await mkdtemp(path.join(tmpdir(),'oa-zip-test-'));process.env.PERSONAL_FILES_STORAGE_ROOT=dir;});
test.beforeEach(async()=>{await clearTestApplicationData(db);const users=await Promise.all([0,1].map(()=>db.user.create({data:{username:randomUUID(),password:'unused'}})));[owner,reader]=users.map(u=>new PersonalFileTransfer(db,context(u.id)));});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect();await rm(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.PERSONAL_FILES_STORAGE_ROOT;else process.env.PERSONAL_FILES_STORAGE_ROOT=previous;});
const file=(parentId:string,name:string,content:string)=>owner.create({parentId,name,kind:'FILE',content:Buffer.from(content).toString('base64')});
const share=(id:string,version:number)=>owner.share(id,{version,policy:{restricted:true,grants:[{principalType:'USER',principalId:reader.actor.userId,role:'READER',rowScope:'ALL',canCreate:false,hiddenFields:[],readonlyFields:[]}]}});

test('ZIP preserves Chinese names, nested and empty folders, current versions and duplicate names',async()=>{
 const root=await owner.create({name:'中文材料',kind:'FOLDER'});
 const nested=await owner.create({name:'子目录',kind:'FOLDER',parentId:root.id});
 await owner.create({name:'空目录',kind:'FOLDER',parentId:root.id});
 const first=await file(nested.id,'说明.txt','old');
 await owner.replace(first.id,{name:'说明.txt',version:1,content:Buffer.from('新版内容').toString('base64')});
 await file(nested.id,'说明.txt','duplicate');
 await file(nested.id,'CON.txt','portable');
 const removed=await owner.create({name:'已删除',kind:'FOLDER',parentId:root.id});
 await file(removed.id,'隐藏.txt','hidden');await owner.remove({files:[{id:removed.id,version:1}]});
 const result=await owner.folderArchive(root.id);
 try{
  const zip=await JSZip.loadAsync(await readFile(result.path));
  assert.equal(result.name,'中文材料.zip');
  assert.ok(zip.files['中文材料/空目录/'].dir);
  const values=await Promise.all(['说明.txt','说明 (2).txt'].map(n=>zip.file('中文材料/子目录/'+n)!.async('string')));
  assert.deepEqual(values.sort(),['duplicate','新版内容'].sort());
  assert.equal(await zip.file('中文材料/子目录/_CON.txt')!.async('string'),'portable');
  assert.ok(!Object.keys(zip.files).some(n=>n.includes('已删除')));
 }finally{await result.cleanup();}
 await assert.rejects(stat(result.path),{code:'ENOENT'});
 const empty=await owner.create({name:'空',kind:'FOLDER'}),emptyZip=await owner.folderArchive(empty.id);
 try{assert.deepEqual(Object.keys((await JSZip.loadAsync(await readFile(emptyZip.path))).files),['空/']);}finally{await emptyZip.cleanup();}
});

test('read-only recipient can download; private descendants and revoked shares block the entire ZIP',async()=>{
 const root=await owner.create({name:'共享',kind:'FOLDER'}),child=await file(root.id,'资料.txt','private');
 await assert.rejects(reader.folderArchive(root.id),/COLLAB_FORBIDDEN/);
 await share(root.id,1);
 const zip=await reader.folderArchive(root.id);await zip.cleanup();
 await owner.share(child.id,{version:1,policy:{restricted:true,grants:[]}});
 await assert.rejects(reader.folderArchive(root.id),/PERSONAL_FOLDER_DOWNLOAD_FORBIDDEN/);
 await owner.share(child.id,{version:2,policy:{restricted:false,grants:[]}});
 await owner.share(root.id,{version:2,policy:{restricted:true,grants:[]}});
 await assert.rejects(reader.folderArchive(root.id),/COLLAB_FORBIDDEN/);
});

test('permission revoked during compression is rechecked before delivering bytes',async()=>{
 const root=await owner.create({name:'撤销测试',kind:'FOLDER'});await file(root.id,'材料.txt','test');await share(root.id,1);
 // Intercept the user check, deliberately after compression and before the ACL read.
 const extended=db.$extends({query:{user:{async findUnique({args,query}){
  await owner.share(root.id,{version:2,policy:{restricted:true,grants:[]}});
  return query(args);
 }}}});
 const downloading=new PersonalFileTransfer(extended as typeof db,reader.actor);
 await assert.rejects(downloading.folderArchive(root.id),/PERSONAL_FOLDER_DOWNLOAD_FORBIDDEN/);
});

test('missing content and cancelled requests never return a partial archive',async()=>{
 const root=await owner.create({name:'失败测试',kind:'FOLDER'}),child=await file(root.id,'丢失.txt','test');
 const row=await db.personalFile.findUniqueOrThrow({where:{id:child.id}});await rm(path.join(dir,row.storageKey!));
 await assert.rejects(owner.folderArchive(root.id),{code:'ENOENT'});
 const controller=new AbortController();controller.abort();await assert.rejects(owner.folderArchive(root.id,controller.signal),{name:'AbortError'});
});
