import { mkdirSync, readFileSync, writeFileSync, renameSync,openSync,fsyncSync,closeSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
// Single case-service writer. Transactions never yield; atomic rename preserves the last valid JSON.
export class Store {
  constructor(file) { this.file=file; mkdirSync(path.dirname(file),{recursive:true,mode:0o700}) }
  read() { try { return JSON.parse(readFileSync(this.file,'utf8')) } catch(e) { if(e.code==='ENOENT')return {};throw e } }
  update(fn) { const data=this.read(); const result=fn(data); const tmp=this.file+'.'+randomUUID(); const fd=openSync(tmp,'wx',0o600);try{writeFileSync(fd,JSON.stringify(data));fsyncSync(fd)}finally{closeSync(fd)}renameSync(tmp,this.file);const dir=openSync(path.dirname(this.file),'r');try{fsyncSync(dir)}finally{closeSync(dir)}return result }
}
