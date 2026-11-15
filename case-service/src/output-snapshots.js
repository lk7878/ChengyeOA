import {open,readdir,unlink} from 'node:fs/promises'
import {constants,createWriteStream} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'

// Walk through held directory descriptors. O_NOFOLLOW on every component
// prevents task-written symlinks from making the host read another task's data.
export async function* outputSnapshots(workspace,destination) {
 const root=await open(workspace,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)
 async function* walk(parent,prefix){
  const names=await readdir(`/proc/self/fd/${parent.fd}`)
  for(const name of names){let handle
   try{handle=await open(`/proc/self/fd/${parent.fd}/${name}`,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)}catch(e){if(['ELOOP','ENOENT'].includes(e.code))continue;throw e}
   try{
    const stat=await handle.stat(),relative=path.join(prefix,name)
    if(stat.isDirectory()){yield* walk(handle,relative);continue}
    if(!stat.isFile()||Date.now()-stat.mtimeMs<1500)continue
    const snapshot=path.join(destination,randomUUID()+'.output')
    try{
     await pipeline(handle.createReadStream({autoClose:false}),createWriteStream(snapshot,{flags:'wx',mode:0o600}))
     const after=await handle.stat()
     if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)continue
     yield {name,relative,snapshot,size:stat.size}
    }finally{await unlink(snapshot).catch(()=>{})}
   }finally{await handle.close()}
  }
 }
 try{for(const folder of ['drafts','reports']){let directory;try{directory=await open(`/proc/self/fd/${root.fd}/${folder}`,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)}catch(e){if(['ENOENT','ELOOP','ENOTDIR'].includes(e.code))continue;throw e}try{yield* walk(directory,folder)}finally{await directory.close()}}}finally{await root.close()}
}
