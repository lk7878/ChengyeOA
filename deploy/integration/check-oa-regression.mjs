/** Run OA regressions on a disposable schema clone, never the live database. */
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import path from 'node:path'
const base=process.env.OA_BUSINESS_ROOT,backup=process.argv[2]
if(!base||!backup)throw Error('OA_BUSINESS_ROOT and backup directory are required')
const require=createRequire(base+'/apps/server/package.json'),env=require('dotenv').parse(await readFile(base+'/apps/server/.env')),{PrismaClient}=require('@prisma/client')
const admin=new URL(process.env.RESTORE_ADMIN_URL||'postgresql://postgres@localhost:55432/postgres?host=/opt/oa-system/runtime/postgres/socket'),db=new PrismaClient({datasources:{db:{url:admin.href}}}),name='smart_regression_'+randomBytes(8).toString('hex')+'_test',url=new URL(admin);url.pathname='/'+name;let created=false
const run=(cmd,args,options={})=>new Promise((resolve,reject)=>{const child=spawn(cmd,args,{stdio:'inherit',...options});child.on('error',reject);child.on('exit',code=>resolve(code??1))})
try{
 await db.$executeRawUnsafe('CREATE DATABASE "'+name+'"');created=true
 const restore=await run(process.env.PG_RESTORE||'/opt/oa-system/toolchain/pgclient/usr/lib/postgresql/16/bin/pg_restore',['--host',admin.searchParams.get('host')||admin.hostname,'--port',admin.port,'--username',decodeURIComponent(admin.username),'--dbname',name,'--schema-only','--no-owner','--exit-on-error',path.join(backup,'oa.dump')],{env:{...process.env,PGPASSWORD:decodeURIComponent(admin.password)}})
 if(restore)throw Error('Schema clone failed')
 process.exitCode=await run(process.execPath,[require.resolve('tsx/cli'),'scripts/ci/run-node-tests-serial.ts'],{cwd:base+'/apps/server',env:{...process.env,...env,DATABASE_URL:url.href,DATABASE_URL_TEST:url.href,JWT_SECRET:'01234567890123456789012345678901',EGG_TYPESCRIPT:'true'}})
}finally{if(created)await db.$executeRawUnsafe('DROP DATABASE "'+name+'" WITH (FORCE)');await db.$disconnect()}
