import net from 'node:net'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {mkdirSync} from 'node:fs'
// Linux abstract-domain socket locks disappear when the process exits, including
// SIGKILL. They avoid stale PID files and serialize independent service starters.
export async function acquireWriter(root){
 mkdirSync(root,{recursive:true,mode:0o700})
 const name='\0oa-case-writer-'+createHash('sha256').update(path.resolve(root)).digest('hex')
 const lock=net.createServer(socket=>socket.destroy())
 await new Promise((resolve,reject)=>{lock.once('error',()=>reject(Error('已有接入服务运行，禁止多个 JSON 写入进程')));lock.listen(name,resolve)})
 lock.unref();return ()=>lock.close()
}
