/** Starts a disposable isolated Harness and checks the real client plugin without OA business data. */
import {createRequire} from 'node:module'
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import assert from 'node:assert/strict'
import {launchIsolatedHarness} from '../../case-service/src/isolated-harness.js'
const {chromium}=createRequire('/opt/oa-system/app/ChengyeOA/LayerManage/law-firm-system/apps/web/package.json')('playwright')
const dir=await mkdtemp(path.join(tmpdir(),'oa-theme-harness-')),id=crypto.randomUUID()
let runtime,browser,mode='dark'
const server=http.createServer(async(req,res)=>{
 if(req.url==='/api/oa/theme.js'){res.setHeader('Content-Type','application/javascript');res.end(await readFile(new URL('../../work_ui/public/oa-theme.js',import.meta.url)));return}
 if(req.url==='/api/me'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({user:{oaUserId:'theme-check',appearance:{colorMode:mode}}}));return}
 const suffix=req.url.replace('/harness/'+id,'')||'/'
 const headers={...req.headers,cookie:runtime.cookie,host:new URL(runtime.base).host};delete headers.referer;delete headers.origin
 const up=http.request(runtime.base+suffix,{method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});up.on('error',()=>{res.statusCode=502;res.end()});req.pipe(up)
})
server.on('upgrade',(req,socket,head)=>{
 const target=new URL(runtime.base),up=net.connect(Number(target.port),target.hostname)
 up.on('connect',()=>{const headers={...req.headers,cookie:runtime.cookie,host:target.host};delete headers.origin;up.write(`${req.method} ${req.url.replace('/harness/'+id,'')} HTTP/1.1\r\n`+Object.entries(headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');if(head.length)up.write(head);socket.pipe(up).pipe(socket)})
 up.on('error',()=>socket.destroy());socket.on('error',()=>up.destroy());socket.on('close',()=>up.destroy())
})
try{
 await mkdir(path.join(dir,'workspace/materials'),{recursive:true})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port
 runtime=await launchIsolatedHarness({dir,id,publicBase:base})
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log(m.text().slice(0,600))});page.on('requestfailed',r=>console.log(r.url(),r.failure()?.errorText))
 await page.goto(base+'/harness/'+id+'/')
 await page.waitForFunction(()=>window.__oaTheme==='dark'&&document.body.hasAttribute('data-ds-dark-theme'),null,{timeout:10000}).catch(async e=>{console.log('debug',errors,(await page.locator('body').innerText()).slice(0,1500));throw e})
 await page.waitForTimeout(1000)
 assert.ok((await page.locator('body').innerText()).length>50,'Harness client must render')
 await page.screenshot({path:'/tmp/oa-theme-review/harness-dark.png',animations:'disabled'})
 mode='light';await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'oa-appearance:theme-check',newValue:JSON.stringify({colorMode:'light'})})))
 await page.waitForFunction(()=>window.__oaTheme==='light'&&!document.body.hasAttribute('data-ds-dark-theme'))
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({result:'pass',harnessClientTheme:true,pageErrors:errors}))
}finally{await browser?.close();runtime?.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true})}
