import { randomUUID, createHash } from 'node:crypto';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PersonalFileTransfer } from '../collaboration/personal-file-transfer';
import { AuthorizationContext } from '../authorization/authorization-service';
import { requireCaseAccess } from '../case/case-scope';
import { exact, text, integer, fail } from '../collaboration/collaboration-policy';
export class SmartCaseArchive {
  constructor(private db:PrismaClient,private actor:AuthorizationContext){}
  async archive(raw:unknown){
    const v=exact(raw,['fileId','version','caseId']),fileId=text(v.fileId),version=integer(v.version),caseId=text(v.caseId);
    const owner=await this.db.personalFile.findUnique({where:{id:fileId}});
    if(owner?.ownerId!==this.actor.userId)fail('COLLAB_FORBIDDEN',403);
    if(!(await new PersonalFileTransfer(this.db,this.actor).publication(fileId,version)).canPublish)fail('COLLAB_FORBIDDEN',403);
    const source=await new PersonalFileTransfer(this.db,this.actor).content(fileId,version);
    const key=createHash('sha256').update(JSON.stringify([this.actor.userId,fileId,version,caseId])).digest('hex');
    const storageKey=randomUUID(),root=path.resolve(process.env.CASE_FILES_STORAGE_ROOT||'var/storage/case-files');await mkdir(root,{recursive:true});
    try{return await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
      if(!(await new PersonalFileTransfer(this.db,this.actor).publication(fileId,version,new Set(),tx)).canPublish)fail('COLLAB_FORBIDDEN',403);
      await tx.$queryRaw`SELECT id FROM "case" WHERE id=${caseId} FOR UPDATE`;
      const parent=await requireCaseAccess(this.db,this.actor,caseId,'case.file.manage',tx);
      if(['CLOSED','ARCHIVED'].includes(parent.status))fail('CASE_STATE_INVALID',409);
      const existing=await tx.smartCaseArchive.findUnique({where:{key}});if(existing)return existing;
      await copyFile(source.path,path.join(root,storageKey));
      const file=await tx.caseFile.create({data:{caseId,fileName:source.name,fileType:path.extname(source.name).slice(1)||'bin',filePath:storageKey,fileSize:source.size,uploadedBy:this.actor.userId}});
      const result=await tx.smartCaseArchive.create({data:{key,ownerId:this.actor.userId,fileId,fileVersion:version,caseId,caseFileId:file.id}});
      await tx.case.update({where:{id:caseId},data:{version:{increment:1},updatedBy:this.actor.userId}});
      await tx.operationLog.create({data:{userId:this.actor.userId,action:'SMART_CASE_ARCHIVE',targetType:'CASE_FILE',targetId:file.id,newValues:JSON.stringify({fileId,version,caseId,sha256:source.sha256})}});
      return result;
    },{timeout:120000+Math.ceil(source.size/(1024*1024))*1000});}catch(error){await rm(path.join(root,storageKey),{force:true});throw error;}
  }
}
