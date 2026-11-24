import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fail } from './collaboration-policy';

type Entry = {id:string;parentId:string|null;name:string;folder:boolean;path?:string};
let active = 0;
// Bound disk/CPU consumption without loading the archive into server memory.
const MAX_BYTES = 2 * 1024 ** 3;
export async function buildFolderZip(entries:Entry[],validate:()=>Promise<void>,signal?:AbortSignal){
  if(!entries.length||entries.length>10000)fail('PERSONAL_FOLDER_DOWNLOAD_LIMIT',413);
  if(active>=2)fail('PERSONAL_FOLDER_DOWNLOAD_BUSY',429);
  active++;
  let directory:string|undefined,cleaned=false;
  const cleanup=async()=>{if(cleaned)return;cleaned=true;try{if(directory)await rm(directory,{recursive:true,force:true});}finally{active--;}};
  try{
    signal?.throwIfAborted();
    let bytes=0;
    for(const entry of entries)if(!entry.folder){
      const stat=await lstat(entry.path!);
      if(!stat.isFile())fail('COLLAB_NOT_FOUND',404);
      bytes+=stat.size;
      if(bytes>MAX_BYTES)fail('PERSONAL_FOLDER_DOWNLOAD_LIMIT',413);
    }
    directory=await mkdtemp(path.join(tmpdir(),'oa-folder-zip-'));
    const target=path.join(directory,'download.zip');
    const archive=archiver('zip',{zlib:{level:5}});
    // Missing blobs must fail the whole download, never silently omit a file.
    archive.on('warning',error=>archive.destroy(error));
    const streamSignal=AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])]);
    const output=createWriteStream(target,{flags:'wx',mode:0o600});
    const transfer=pipeline(archive,output,{signal:streamSignal});
    const paths=new Map<string,string>(),used=new Map<string,Set<string>>();
    for(const entry of entries){
      const parent=paths.get(entry.parentId??'')??'';
      const names=used.get(parent)??new Set<string>();used.set(parent,names);
      // Portable names and collision suffixes preserve every item, including
      // duplicate sibling names; never emit traversal or absolute ZIP paths.
      let safe=[...entry.name.normalize('NFC')].map(c=>c.charCodeAt(0)<32?'_':c).join('').replace(/[\\/:*?"<>|]/g,'_').replace(/[. ]+$/g,'')||'未命名';
      if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe))safe='_'+safe;
      let name=safe,index=2;const ext=entry.folder?'':path.posix.extname(safe),base=ext?safe.slice(0,-ext.length):safe;
      while(names.has(name.toLowerCase()))name=base+' ('+(index++)+')'+ext;
      names.add(name.toLowerCase());
      const destination=parent+name+(entry.folder?'/':'');paths.set(entry.id,destination);
      if(entry.folder)archive.append('',{name:destination,type:'directory'});
      else archive.file(entry.path!,{name:destination});
    }
    try{await Promise.all([transfer,archive.finalize()]);}
    catch(error){archive.abort();await transfer.catch(()=>{});throw error;}
    signal?.throwIfAborted();
    // Recheck permissions and versions after compression, before sending bytes.
    await validate();
    return {path:target,name:paths.get(entries[0].id)!.slice(0,-1)+'.zip',cleanup};
  }catch(error){await cleanup();throw error;}
}
