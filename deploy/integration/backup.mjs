/** Consistent cold backup of OA authority and smart-case metadata/files. */
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import path from 'node:path'
const root=process.cwd(),oaRoot=process.env.OA_BUSINESS_ROOT,destination=process.argv[2]
if(!oaRoot||!destination||!path.isAbsolute(destination))throw Error('OA_BUSINESS_ROOT and new absolute backup directory are required')
const require=createRequire(oaRoot+'/apps/server/package.json'),env=require('dotenv').parse(await readFile(oaRoot+'/apps/server/.env')),url=new URL(env.DATABASE_URL)
if(url.pathname.endsWith('_test'))throw Error('Production authority expected')
await mkdir(destination,{mode:0o700});await chmod(destination,0o700)
const run=(cmd,args,extra={})=>{const r=spawnSync(cmd,args,{stdio:['ignore','pipe','pipe'],...extra});if(r.status!==0)throw Error(cmd+' failed: '+String(r.stderr).slice(0,400));return String(r.stdout)}
const units=['oa-main','oa-smart-workbench','oa-smart-case','oa-smart-knowledge'],active=units.filter(u=>spawnSync('systemctl',['--user','is-active','--quiet',u]).status===0)
try{run('systemctl',['--user','stop',...active]);const pg=process.env.PG_DUMP||'/opt/oa-system/toolchain/pgclient/usr/lib/postgresql/16/bin/pg_dump';run(pg,['--host',url.hostname,'--port',url.port,'--username',decodeURIComponent(url.username),'--format=custom','--file',path.join(destination,'oa.dump'),url.pathname.slice(1)],{env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)}})
run('tar',['-czf',path.join(destination,'files.tgz'),'-C',oaRoot+'/apps/server','var/storage','.env','-C',root,'data/integration','.dsh/.env','.dsh/settings.yaml','WeKnora/.env.lite','WeKnora/config','konwledge-md'])
const hashes={};for(const name of ['oa.dump','files.tgz']){await chmod(path.join(destination,name),0o600);const h=createHash('sha256');for await(const part of createReadStream(path.join(destination,name)))h.update(part);hashes[name]=h.digest('hex')}
await writeFile(path.join(destination,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),oaRoot,smartCaseRoot:root,hashes},null,2),{mode:0o600});console.log('Consistent backup completed: '+destination)
}finally{run('systemctl',['--user','start',...active])}
