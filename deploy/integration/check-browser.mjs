import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
const root=process.cwd(),oaRoot=process.env.OA_BUSINESS_ROOT||'/opt/oa-system/app/ChengyeOA/LayerManage/law-firm-system'
const require=createRequire(oaRoot+'/apps/web/package.json'),{chromium}=require('playwright')
const fixture=JSON.parse(await readFile(root+'/runtime/e2e/fixtures.json','utf8'))
await mkdir(root+'/runtime/e2e/screenshots',{recursive:true})
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
try{
 for(const user of fixture.users){const context=await browser.newContext({viewport:{width:1440,height:960},...(existsSync(root+'/runtime/e2e/'+user.name+'-browser.json')?{storageState:root+'/runtime/e2e/'+user.name+'-browser.json'}:{})})
 if(!existsSync(root+'/runtime/e2e/'+user.name+'-browser.json'))await context.addCookies([{name:'chengye_refresh',value:user.refreshToken,domain:'127.0.0.1',path:'/api/v1/auth',httpOnly:true,sameSite:'Lax'},{name:'chengye_csrf',value:user.csrfToken,domain:'127.0.0.1',path:'/',sameSite:'Lax'}])
 const page=await context.newPage();const issues=[];page.on('pageerror',e=>issues.push(e.message));
 await page.goto('http://127.0.0.1:3001/smart-case');await page.waitForURL('http://127.0.0.1:5182/',{timeout:45000});await page.getByText('承业智慧办案',{exact:true}).first().waitFor();
 await page.screenshot({path:root+'/runtime/e2e/screenshots/'+user.name+'-dashboard.png',fullPage:true});
 const me=await context.request.get('http://127.0.0.1:5182/api/me');if(!me.ok())throw Error('SSO failed for '+user.name);
 await context.storageState({path:root+'/runtime/e2e/'+user.name+'-browser.json'});console.log(JSON.stringify({user:user.name,sso:me.status(),issues}));
 if(user.name==='admin'){await page.getByRole('button',{name:'知识库',exact:true}).first().click();await page.getByRole('link',{name:'打开原生知识管理'}).waitFor();await page.screenshot({path:root+'/runtime/e2e/screenshots/knowledge.png',fullPage:true});await page.goto('http://127.0.0.1:5182/knowledge-native/');await page.waitForTimeout(2500);await page.screenshot({path:root+'/runtime/e2e/screenshots/native-knowledge.png',fullPage:true});console.log(JSON.stringify({nativeTitle:await page.title(),nativeIssues:issues}))}
 await context.close()
 }
}finally{await browser.close()}
