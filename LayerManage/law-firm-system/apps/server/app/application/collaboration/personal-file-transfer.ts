import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, statfs } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { PersonalFiles } from './personal-files';
import { exact, fail, integer, text } from './collaboration-policy';

const root = () => path.resolve(process.env.PERSONAL_FILES_STORAGE_ROOT||path.join(process.cwd(), 'var/storage/personal-files'));
const chunkSize = 4 * 1024 * 1024;
const validName = (v: unknown) => { const n = text(v, 150); if (/[\\/]/.test(n) || [...n].some(c => c.charCodeAt(0) < 32) || ['.', '..'].includes(n)) fail('COLLAB_INVALID_VALUE'); return n; };
const hashFile = async (file: string) => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
export class PersonalFileTransfer extends PersonalFiles {
  async begin(raw: unknown) {
    const v = exact(raw, ['name', 'size', 'parentId', 'fileId', 'version', 'lineage', 'source']);
    const name = validName(v.name), total = Number(v.size);
    if (!Number.isSafeInteger(total) || total < 0) fail('COLLAB_INVALID_VALUE');
    const fileId = v.fileId ? text(v.fileId) : null, parentId = v.parentId ? text(v.parentId) : null;
    if (fileId) { const r = await this.require(fileId, 2); if (r.row.kind !== 'FILE' || r.row.version !== integer(v.version)) fail('COLLAB_ACCESS_CONFLICT', 409); }
    if (parentId) { const r = await this.require(parentId, 2); if (r.row.kind !== 'FOLDER' || r.path.length >= 12) fail('COLLAB_INVALID_VALUE'); }
    const lineage:{fileId:string;version:number;sha256:string}[]=[];
    if(v.lineage!==undefined){if(!Array.isArray(v.lineage)||v.lineage.length>1000)fail('COLLAB_INVALID_VALUE');for(const input of v.lineage){const ref=exact(input,['fileId','version','sha256']);const source=await this.content(text(ref.fileId),integer(ref.version));if(source.sha256!==ref.sha256)fail('COLLAB_ACCESS_CONFLICT',409);lineage.push({fileId:source.fileId,version:source.version,sha256:source.sha256});}}
    const source=v.source?text(v.source,150):'upload';
    await mkdir(root(), { recursive: true });
    const space = await statfs(root());
    if (total * 2 > space.bavail * space.bsize) fail('PERSONAL_STORAGE_FULL', 507);
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
      if(fileId){const r=await this.require(fileId,2,tx);if(r.row.kind!=='FILE'||r.row.version!==integer(v.version))fail('COLLAB_ACCESS_CONFLICT',409);}
      if(parentId)await this.require(parentId,2,tx);
      return tx.personalFileUpload.create({ data: { id: randomUUID(), ownerId: this.actor.userId, lineage, source, name, total, parentId, fileId, expectedVersion: fileId ? integer(v.version) : null } });
    });
  }
  async uploadStatus(id: string) {
    const row = await this.db.personalFileUpload.findUnique({ where: { id } });
    if (!row || row.ownerId !== this.actor.userId) fail('COLLAB_FORBIDDEN', 403);
    return { ...row, chunkSize };
  }
  async chunk(id: string, offset: number, stream: AsyncIterable<Buffer>) {
    await this.uploadStatus(id);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % chunkSize !== 0) fail('COLLAB_INVALID_VALUE');
    const dir = path.join(root(), 'uploads', id); await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, randomUUID()); let bytes = 0;
    try {
      await pipeline(Readable.from((async function* () { for await (const part of stream) { bytes += part.length; if (bytes > chunkSize) fail('UPLOAD_CHUNK_TOO_LARGE', 413); yield part; } })()), createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
      return await this.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id},0))`;
        const row = await tx.personalFileUpload.findUniqueOrThrow({ where: { id } });
        if (row.resultId) return { offset: row.offset };
        if (bytes !== Math.min(chunkSize, row.total - offset) || bytes <= 0) fail('UPLOAD_CHUNK_INVALID', 400);
        const dest = path.join(dir, String(offset));
        if (offset < row.offset) {
          if (await hashFile(tmp) !== await hashFile(dest)) fail('UPLOAD_CHUNK_CONFLICT', 409);
          return { offset: row.offset };
        }
        if (offset !== row.offset) fail('UPLOAD_OFFSET_CONFLICT', 409);
        await rename(tmp, dest);
        await tx.personalFileUpload.update({ where: { id }, data: { offset: offset + bytes } });
        return { offset: offset + bytes };
      });
    } finally { await rm(tmp, { force: true }); }
  }
  async complete(id: string) {
    const initialUpload=await this.uploadStatus(id);
    const storageKey = randomUUID(), target = path.join(root(), storageKey);
    try {
      const result = await this.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id},0))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
        const upload = await tx.personalFileUpload.findUniqueOrThrow({ where: { id } });
        if (upload.resultId) return { id: upload.resultId, version: upload.resultVersion };
        if (upload.offset !== upload.total) fail('UPLOAD_INCOMPLETE', 409);
        const current = upload.fileId ? await this.require(upload.fileId, 2, tx) : null;
        if (current && current.row.version !== upload.expectedVersion) fail('COLLAB_ACCESS_CONFLICT', 409);
        if (upload.parentId) await this.require(upload.parentId, 2, tx);
        for(const input of (Array.isArray(upload.lineage)?upload.lineage:[])){const ref=input as {fileId:string;version:number;sha256:string};await this.require(ref.fileId,1,tx);const source=await tx.personalFileVersion.findUnique({where:{fileId_version:{fileId:ref.fileId,version:ref.version}}});if(source?.sha256!==ref.sha256)fail('COLLAB_ACCESS_CONFLICT',409);}
        const hash = createHash('sha256');
        await pipeline(Readable.from((async function* () {
          for (let offset = 0; offset < upload.total; offset += chunkSize) {
            for await (const part of createReadStream(path.join(root(), 'uploads', id, String(offset)))) { hash.update(part); yield part; }
          }
        })()), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
        const sha256 = hash.digest('hex');
        if (current) await this.snapshotVersion(current.row.id, tx);
        const contentVersion = current ? current.row.contentVersion + 1 : 1;
        const values = { name: upload.name, size: upload.total, storageKey, contentVersion };
        const file = current ? await tx.personalFile.update({ where: { id: current.row.id }, data: { ...values, version: { increment: 1 } } }) : await tx.personalFile.create({ data: { ...values, kind: 'FILE', parentId: upload.parentId, ownerId: this.actor.userId, accessPolicy: { restricted: !upload.parentId, grants: [{ principalType: 'USER', principalId: this.actor.userId, role: 'MANAGER', rowScope: 'ALL', canCreate: true, hiddenFields: [], readonlyFields: [] }] } } });
        await tx.personalFileVersion.create({ data: { fileId: file.id, version: contentVersion, name: upload.name, size: upload.total, storageKey, sha256, lineage: upload.lineage, source: upload.source, parseStatus: 'PENDING' } });
        await tx.personalFileUpload.update({ where: { id }, data: { resultId: file.id, resultVersion: contentVersion } });
        await tx.operationLog.create({ data: { userId: this.actor.userId, action: 'PERSONAL_FILE_CONTENT', targetType: 'PERSONAL_FILE', targetId: file.id, newValues: JSON.stringify({ version: contentVersion, sha256, size: upload.total }) } });
        return { id: file.id, version: contentVersion };
      }, { timeout: 120000+Math.ceil(initialUpload.total/(1024*1024))*1000 });
      await rm(path.join(root(), 'uploads', id), { recursive: true, force: true });
      return result;
    } catch (error) { await rm(target, { force: true }); throw error; }
  }
  async versions(id: string) {
    await this.require(id);
    await this.db.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`; await this.snapshotVersion(id, tx); });
    return this.db.personalFileVersion.findMany({ where: { fileId: id }, select: { version: true, name: true, size: true, sha256: true, parseStatus: true, source: true, createdAt: true }, orderBy: { version: 'desc' } });
  }
  async content(id: string, version: number, global = false) {
    if (global) {
      if (!this.actor.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN', 403);
      await this.db.operationLog.create({ data: { userId: this.actor.userId, action: 'ALL_FILES_READ', targetType: 'PERSONAL_FILE', targetId: id, newValues: JSON.stringify({ version }) } });
    } else await this.require(id);
    await this.db.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`; await this.snapshotVersion(id, tx); });
    const row = await this.db.personalFileVersion.findUnique({ where: { fileId_version: { fileId: id, version } } });
    if (!row) fail('COLLAB_NOT_FOUND', 404);
    return { ...row, path: path.join(root(), row.storageKey) };
  }
  async publication(id:string,version?:number,seen=new Set<string>(),tx?:Prisma.TransactionClient):Promise<{canPublish:boolean}>{
    const {row}=await this.require(id,1,tx);const selected=version??row.contentVersion,key=id+':'+selected;
    if(seen.has(key)||seen.size>1000)return {canPublish:false};seen.add(key);
    if(row.ownerId!==this.actor.userId&&!await (tx??this.db).personalFilePublication.findUnique({where:{fileId_userId:{fileId:id,userId:this.actor.userId}}}))return {canPublish:false};
    const snapshot=tx?(await this.snapshotVersion(id,tx),await tx.personalFileVersion.findUnique({where:{fileId_version:{fileId:id,version:selected}}})):await this.content(id,selected);if(!snapshot)fail('COLLAB_NOT_FOUND',404);
    const lineage=Array.isArray(snapshot.lineage)?snapshot.lineage:[];
    for(const input of lineage){const ref=input as {fileId:string;version:number};try{if(!(await this.publication(ref.fileId,ref.version,new Set(seen),tx)).canPublish)return {canPublish:false};}catch{return {canPublish:false};}}
    return {canPublish:true};
  }
  async grantPublication(id:string,raw:unknown){
    const v=exact(raw,['userId','allowed']),userId=text(v.userId);
    if(typeof v.allowed!=='boolean')fail('COLLAB_INVALID_VALUE');
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
      const {row}=await this.require(id,3,tx);if(row.ownerId!==this.actor.userId)fail('COLLAB_FORBIDDEN',403);
      if(v.allowed)await tx.personalFilePublication.upsert({where:{fileId_userId:{fileId:id,userId}},create:{fileId:id,userId},update:{}});
      else await tx.personalFilePublication.deleteMany({where:{fileId:id,userId}});
      await tx.operationLog.create({data:{userId:this.actor.userId,action:'PERSONAL_FILE_PUBLICATION_GRANT',targetType:'PERSONAL_FILE',targetId:id,newValues:JSON.stringify(v)}});
      return {ok:true};
    });
  }
  async allFiles() {
    if (!this.actor.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN', 403);
    await this.db.operationLog.create({ data: { userId: this.actor.userId, action: 'ALL_FILES_LIST', targetType: 'PERSONAL_FILE', targetId: '*' } });
    return { items: await this.db.personalFile.findMany({ where:{deletedAt:null}, select: { id: true, name: true, ownerId: true, parentId: true, kind: true, size: true, contentVersion: true, updatedAt: true } }), path: [] as {id:string;name:string}[], canUpload: false };
  }
}
