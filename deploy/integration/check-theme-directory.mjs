/** UI regression with intercepted APIs: never writes business data or changes a real account. */
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
const require=createRequire('/opt/oa-system/app/ChengyeOA/LayerManage/law-firm-system/apps/web/package.json')
const {chromium}=require('playwright')
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1440,height:960}})
let appearance={fontSize:'standard',background:'default',rowHeight:'standard',colorMode:'light'},fileRequests=0
const user={id:'theme-test',oaUserId:'theme-test',username:'test',name:'外观验收',displayName:'外观验收',roles:['case_owner'],status:'active'}
const auth={userId:user.id,employeeId:null,isSystemSuperAdmin:true,isSystemAdmin:true,grants:[],permissionCodes:[],menuCodes:[],fieldCapabilities:[],evaluatedAt:new Date().toISOString()}
const errors=[]
context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>console.log('requestfailed',r.url(),r.failure()?.errorText));p.on('console',m=>{if(m.type()==='error')console.log('console',m.text().slice(0,300))})})
await context.route('**/api/**',async route=>{
 const url=new URL(route.request().url()),p=url.pathname
 if(!p.startsWith('/api/'))return route.continue()
 let data={items:[],total:0}
 if(p==='/api/v1/auth/refresh')data={token:'test-only',csrfToken:'test-only',expiresIn:900}
 else if(p==='/api/v1/auth/me')data=user
 else if(p==='/api/v1/authorization/me')data=auth
 else if(p==='/api/v1/auth/appearance') {if(route.request().method()==='PATCH')appearance=route.request().postDataJSON();data=appearance}
 else if(p==='/api/me')data={user:{...user,appearance}}
 else if(p==='/api/oa/files'){fileRequests++;data={items:url.searchParams.has('parentId')?[]:[{id:'folder',name:'测试目录',kind:'FOLDER'}]}}
 else if(p==='/api/oa/cases')data=[]
 else if(p==='/api/llm/status')data={balance:{hidden:true,ok:true}}
 if(p.startsWith('/api/v1/'))data={code:200,data,message:'success'}
 await route.fulfill({json:data})
})
try{
 const oa=await context.newPage(),wb=await context.newPage()
 await oa.goto('http://127.0.0.1:3000/')
 await oa.getByRole('button',{name:'切换深色模式'}).waitFor({timeout:10000}).catch(async e=>{console.log((await oa.locator('body').innerText()).slice(0,1500),errors);throw e})
 await wb.goto('http://127.0.0.1:3000/wb/')
 await wb.getByRole('button',{name:'AI助手',exact:true}).click()
 await wb.getByRole('button',{name:'已在根目录',exact:true}).waitFor()
 assert.equal(await wb.getByRole('button',{name:'已在根目录',exact:true}).isDisabled(),true)
 const before=fileRequests
 await wb.getByRole('button',{name:'刷新文件',exact:true}).click()
 await wb.getByText('已加载 1 项',{exact:true}).waitFor()
 assert.ok(fileRequests>before)
 await wb.getByRole('button',{name:'📁 测试目录',exact:true}).click()
 await wb.getByText('此目录暂无可用文件；上传后点击“刷新文件”。',{exact:true}).waitFor()
 assert.ok(await wb.getByRole('navigation',{name:'当前文件目录'}).getByText('测试目录',{exact:true}).isVisible())
 await wb.getByRole('button',{name:'返回根目录',exact:true}).click()
 await wb.getByRole('button',{name:'📁 测试目录',exact:true}).waitFor()
 await wb.getByPlaceholder('例如：合同履行争议分析').fill('保留中的任务草稿')
 await oa.getByRole('button',{name:'切换深色模式'}).click()
 await oa.waitForFunction(()=>document.documentElement.dataset.oaColorMode==='dark')
 await wb.waitForFunction(()=>document.body.hasAttribute('data-ds-dark-theme'))
 assert.equal(await wb.getByPlaceholder('例如：合同履行争议分析').inputValue(),'保留中的任务草稿')
 assert.equal(await wb.getByRole('button',{name:'深色',exact:true}).count(),0)
 await mkdir('/tmp/oa-theme-review',{recursive:true})
 await oa.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-label="切换浅色模式"]')).backgroundColor==='rgb(28, 32, 39)')
 await oa.screenshot({path:'/tmp/oa-theme-review/oa-dark.png',fullPage:true,animations:'disabled'})
 await wb.screenshot({path:'/tmp/oa-theme-review/workbench-dark.png',fullPage:true,animations:'disabled'})
 await wb.reload();await wb.waitForFunction(()=>document.body.hasAttribute('data-ds-dark-theme'))
 await oa.getByRole('button',{name:'切换浅色模式'}).click()
 await wb.waitForFunction(()=>!document.body.hasAttribute('data-ds-dark-theme'))
 await oa.screenshot({path:'/tmp/oa-theme-review/oa-light.png',fullPage:true,animations:'disabled'})
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({result:'pass',crossTabTheme:true,reloadPersistence:true,folderNavigation:true,rootRefresh:true,draftPreserved:true,pageErrors:errors}))
}finally{await browser.close()}
