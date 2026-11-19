// Run after `npm run build`. Uses only local static assets and mocked APIs.
// Set PLAYWRIGHT_MODULE to an existing @playwright/test/index.mjs if it is not installed here.
import assert from 'node:assert/strict'
import http from 'node:http'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const {chromium,expect}=await import(process.env.PLAYWRIGHT_MODULE||'@playwright/test')
const root=fileURLToPath(new URL('../dist/',import.meta.url))
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local'),rel=url.pathname.replace(/^\/wb\//,'');const file=path.resolve(root,rel||'index.html');if(!file.startsWith(root))throw Error('outside fixture');const data=await readFile(file);res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(data)}catch{res.statusCode=404;res.end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/wb/`
const browser=await chromium.launch({headless:true})
let assertions=0
try{
 const page=await browser.newPage({viewport:{width:1150,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000)
 let account='a',failCreate=false,revoked=false,expired=false,kbFailure=false,submissionsFailure=false,kbDelay=0,slowSearch=false,versionRemoved=false,versionDelay=0
 const requests=[],creates=[]
 const libraries=[{id:'law',name:'法律法规库',canReview:false,count:41},{id:'clinical',name:'临床知识库',canReview:false,count:21}]
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;requests.push([req.method(),p])
  let data={},status=200
  if(expired){status=401;data={error:'expired'}}
  else if(p==='/api/me')data={user:{id:account,username:account,displayName:'成员'+account,roles:['case_owner'],status:'active'}}
  else if(p==='/api/my-presets'){if(kbDelay)await new Promise(r=>setTimeout(r,kbDelay));status=kbFailure?503:200;data=kbFailure?{error:'模拟网络失败'}:{defaultKind:'general',items:['general','disability','injury','malpractice','traffic'].map((id,i)=>({id,name:['通用法律','伤残鉴定','伤情鉴定','医疗损害','交通事故'][i],hint:'测试预设',version:1,available:revoked?[]:libraries,recommended:revoked?[]:['law']}))}}
  else if(p==='/api/directory/users')data={users:[]}
  else if(p==='/api/cases')data={cases:[]}
  else if(p==='/api/oa/cases')data=revoked?[]:[{id:'c1',caseNo:'CASE1',title:'关联案件',status:'PROCESSING'},{id:'c2',caseNo:'CASE2',title:'另一案件',status:'PROCESSING'}]
  else if(p==='/api/oa/files')data={items:[{id:'f1',name:'测试材料.docx',kind:'FILE',contentVersion:2,size:100}]}
  else if(p==='/api/oa/files/f1/versions'){if(versionDelay)await new Promise(r=>setTimeout(r,versionDelay));status=revoked?403:200;data=revoked?{error:'已撤销文件权限'}:[{version:2,name:'测试材料.docx',sha256:'222222222222',size:100},{version:1,name:'测试材料.docx',sha256:'111111111111',size:90}].filter(v=>!versionRemoved||v.version===2)}
  else if(p==='/api/kb'){if(kbDelay)await new Promise(r=>setTimeout(r,kbDelay));status=kbFailure?503:200;data=kbFailure?{error:'模拟网络失败'}:{items:revoked?[]:libraries}}
  else if(/^\/api\/kb\/[^/]+\/documents$/.test(p)){const id=p.split('/')[3];data={items:[{id:'d-'+id,name:id==='law'?'法律文档':'临床文档',size:100,version:1}],total:41}}
  else if(p.endsWith('/search')){if(slowSearch)await new Promise(r=>setTimeout(r,700));data={data:[{title:p.includes('/law/')?'旧库搜索结果':'临床搜索结果',content:'测试内容'}]}}
  else if(p==='/api/submissions'){status=submissionsFailure?503:200;data=submissionsFailure?{error:'投稿暂不可用'}:{items:[]}}
  else if(p==='/api/tasks'&&req.method()==='POST'){creates.push(req.postDataJSON());status=failCreate?500:200;data=failCreate?{error:'模拟创建失败'}:{id:'new-task'}}
  else if(p==='/api/tasks')data={items:[]}
  else if(p==='/api/oa/theme.js'){await route.fulfill({contentType:'application/javascript',body:''});return}
  await route.fulfill({status,json:data})
 })
 const title=page.getByLabel('任务名称'),sidebar=page.getByRole('navigation',{name:'主要栏目'}),law=page.getByLabel('法律法规库',{exact:true})
 const task=async()=>{await sidebar.getByRole('button',{name:'AI助手',exact:true}).click();await expect(title).toBeEnabled()}
 const knowledge=()=>sidebar.getByRole('button',{name:'知识库',exact:true}).click()
 await page.goto(base+'?caseId=c1');await expect(title).toBeEnabled();await expect(page.getByLabel('关联 OA 案件')).toHaveValue('c1')
 await title.fill('保留草稿');await page.getByLabel('测试材料.docx',{exact:true}).check();await page.getByLabel('测试材料.docx版本').selectOption('1');await law.uncheck()
 await knowledge();await expect(page).toHaveURL(/view=knowledge/);await expect(page.getByRole('heading',{name:'知识库概览'})).toBeVisible();await task()
 await expect(title).toHaveValue('保留草稿');await expect(page.getByLabel('测试材料.docx版本')).toHaveValue('1');await expect(law).not.toBeChecked();if(process.env.UI_SNAPSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SNAPSHOT_DIR,'draft.png'),fullPage:true});assertions++
 await page.reload();await expect(title).toBeEnabled();await expect(title).toHaveValue('保留草稿');await expect(law).not.toBeChecked();assertions++
 await page.goBack();await expect(page.getByRole('heading',{name:'知识库概览'})).toBeVisible();await page.goForward();await expect(title).toHaveValue('保留草稿');assertions++
 await expect(sidebar.getByRole('button',{name:'专项能力'})).toHaveCount(0);await page.getByLabel('办案类型').selectOption('injury');await expect(sidebar.getByRole('button',{name:'AI助手'})).toHaveAttribute('aria-current','page');await expect(title).toBeEnabled();await expect(title).toHaveValue('');await title.fill('专项草稿');await task();await expect(title).toHaveValue('保留草稿');assertions++
 failCreate=true;await page.getByRole('button',{name:/创建任务 · 已选/}).click();await expect(page.getByRole('alert')).toContainText('模拟创建失败');await page.reload();await expect(title).toHaveValue('保留草稿');await expect(title).toBeEnabled();assertions++
 account='b';await page.reload();await expect(title).toBeEnabled();await expect(title).toHaveValue('');await title.fill('B 的草稿');account='a';await page.reload();await expect(title).toHaveValue('保留草稿');await expect(title).toBeEnabled();assertions++
 failCreate=false;await page.getByRole('button',{name:/创建任务 · 已选/}).click();await expect(title).toHaveValue('');assert.deepEqual(creates.at(-1).knowledgeBases,[]);assert.deepEqual(creates.at(-1).inputs,[{fileId:'f1',version:1}]);assert.equal(await page.evaluate(()=>sessionStorage.getItem('wb:task-draft:v1:a:general')),null);assertions++
 await title.fill('撤权校验');await page.getByLabel('关联 OA 案件').selectOption('c1');await page.getByLabel('测试材料.docx',{exact:true}).check();await law.check();revoked=true;await page.reload();await expect(title).toBeEnabled();await expect(title).toHaveValue('撤权校验');await expect(page.getByLabel('关联 OA 案件')).toHaveValue('');await expect(page.getByRole('button',{name:'创建任务 · 已选 0 个版本'})).toBeVisible();await expect(page.getByText('草稿中已失效的案件、文件版本或知识库授权已移除，请核对后创建任务。')).toBeVisible();assertions++
 revoked=false;kbFailure=true;await page.reload();await expect(page.getByRole('button',{name:'重新校验草稿'})).toBeVisible();await expect(title).toHaveCount(0);kbFailure=false;await page.getByRole('button',{name:'重新校验草稿'}).click();await expect(title).toBeEnabled();assertions++
 expired=true;await page.reload();await expect(page.getByText('登录已失效，请通过 OA 重新进入。')).toBeVisible();expired=false;await page.reload();await expect(title).toHaveValue('撤权校验');assertions++
 // Explicit case links override only the case association, retaining the saved task draft.
 await page.goto(base+'?view=cases_general&caseId=c2');await expect(title).toBeEnabled();await expect(title).toHaveValue('撤权校验');await expect(page.getByLabel('关联 OA 案件')).toHaveValue('c2');assertions++
 await page.getByLabel('测试材料.docx',{exact:true}).check();await page.getByLabel('测试材料.docx版本').selectOption('1');versionRemoved=true;await page.reload();await expect(title).toBeEnabled();await expect(page.getByRole('button',{name:'创建任务 · 已选 0 个版本'})).toBeVisible();versionRemoved=false;assertions++
 versionDelay=500;await page.getByLabel('测试材料.docx',{exact:true}).click();await page.getByLabel('测试材料.docx（正在读取版本…）',{exact:true}).click();await page.waitForTimeout(600);await expect(page.getByLabel('测试材料.docx',{exact:true})).not.toBeChecked();versionDelay=0;assertions++
 kbDelay=400;await knowledge();await expect(page.getByText('正在加载知识库…',{exact:true})).toBeVisible();await expect(page.getByText('暂无获授权的知识库，请联系管理员分配阅读权限。')).not.toBeVisible();await expect(page.getByRole('button',{name:/法律法规库.*份已发布/})).toBeVisible();kbDelay=0;assertions++
 await page.getByRole('button',{name:/临床知识库.*份已发布/}).click();await page.getByLabel('按文件名称筛选').fill('临床');await expect(page.getByRole('button',{name:/临床文档/})).toBeVisible();await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page).toHaveURL(/kbPage=2/);await page.reload();await expect(page.getByLabel('按文件名称筛选')).toHaveValue('临床');await expect(page.getByRole('status').filter({hasText:'第 2 / 5 页'})).toBeVisible();await task();await knowledge();await expect(page.getByLabel('按文件名称筛选')).toHaveValue('临床');await expect(page.getByRole('status').filter({hasText:'第 2 / 5 页'})).toBeVisible();assertions++
 if(process.env.UI_SNAPSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SNAPSHOT_DIR,'knowledge.png'),fullPage:true});submissionsFailure=true;await page.getByRole('button',{name:'刷新知识库'}).click();assert.equal(requests.some(([,p])=>p==='/api/submissions'),false);await expect(page.getByRole('button',{name:/临床文档/})).toBeVisible();submissionsFailure=false;assertions++
 await page.getByRole('button',{name:/法律法规库.*份已发布/}).click();await page.getByLabel('检索内容').fill('测试');slowSearch=true;await page.getByRole('button',{name:'检索已发布知识'}).click();await page.getByRole('button',{name:/临床知识库.*份已发布/}).click();await page.waitForTimeout(850);await expect(page.getByText('旧库搜索结果')).not.toBeVisible();assertions++
 kbFailure=true;await page.getByRole('button',{name:'刷新知识库'}).click();await expect(page.getByText(/知识库加载失败：模拟网络失败/)).toBeVisible();await expect(page.getByText('暂无获授权的知识库，请联系管理员分配阅读权限。')).not.toBeVisible();kbFailure=false;revoked=true;await page.getByRole('button',{name:'刷新知识库'}).click();await expect(page.getByText('暂无获授权的知识库，请联系管理员分配阅读权限。')).toBeVisible();assertions++
 await page.goto(base+'?view=settings');await expect(page).toHaveURL(/view=dashboard/);await expect(page.getByRole('heading',{name:'概览',exact:true})).toBeVisible();await page.goto(base+'?view=invalid');await expect(page.getByRole('heading',{name:'概览',exact:true})).toBeVisible();assertions++
 await page.getByRole('button',{name:'退出',exact:true}).click();await expect(page.getByRole('link',{name:'通过 OA 登录'})).toBeVisible();assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('wb:task-draft:v1:a:'))),false);assert.ok(await page.evaluate(()=>sessionStorage.getItem('wb:task-draft:v1:b:general')));assertions++
 // The administrator must see who matched without opening a collapsed select.
 const grant={kinds:[],defaultKind:null,readers:[],exceptions:{},revision:'r1'}
 const directory=['罗致洪','罗茂君'].map((name,i)=>({id:String(i),username:['chengyelzh','chengyelmj'][i],employee:{name},smartCaseEligible:true,account:grant}))
 await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'admin',username:'admin',displayName:'管理员',roles:[],isSystemSuperAdmin:true}}}))
 await page.route('**/api/business-presets',route=>route.fulfill({json:{users:directory,versions:{},libraries:[],components:[],connections:[],disabled:[]}}))
 await page.route('**/api/kb-access',route=>route.fulfill({json:{libraries:[],users:[]}}))
 await page.route(/\/api\/(ai-capabilities|model-connections)$/,route=>route.fulfill({json:null}))
 await page.goto(base+'?view=settings')
 await expect(page.locator('main h2').first()).toHaveText('用户办案授权');await expect(page.getByRole('heading',{name:/^(账号与权限|模型与运行)$/})).toHaveCount(0)
 const search=page.getByLabel('搜索账号或姓名')
 await search.fill('罗');await expect(page.getByRole('list',{name:'匹配账号'}).getByRole('button')).toHaveCount(2)
 await search.fill('罗致洪');const match=page.getByRole('button',{name:'罗致洪（chengyelzh）',exact:true});await expect(match).toBeVisible();await match.click()
 const editor=page.getByRole('group',{name:'罗致洪 · 已有智慧办案使用资格',exact:true})
 await expect(editor).toBeVisible();await search.fill('不存在的账号');await expect(page.getByText('未找到匹配账号，请核对账号或姓名。')).toBeVisible();await expect(editor).toBeHidden()
 await search.fill('  CHENGYELMJ  ');await search.press('Enter');await expect(page.getByLabel('选择人员')).toHaveValue('1')
 assert.equal(requests.some(([method,p])=>method==='POST'&&p.startsWith('/api/business-grants')),false);assertions++
 await page.route('**/api/my-presets',route=>route.fulfill({json:{defaultKind:'injury',items:[{id:'injury',name:'伤情鉴定',version:2,available:[],recommended:[]}]}}))
 await page.goto(base+'?view=specialized&preset=general')
 await expect(page).toHaveURL(/view=cases_injury/);await expect(page.getByLabel('办案类型')).toHaveValue('injury')
 await expect(sidebar.getByRole('button',{name:'AI助手'})).toHaveClass(/wb-sidebar__item--active/)
 await expect(page.getByLabel('办案类型').locator('option')).toHaveCount(1);assertions++
 assert.deepEqual(errors,[]);assert.equal(requests.some(([method,p])=>method==='POST'&&p.endsWith('/start')),false)
 console.log(`${assertions} browser scenarios passed: drafts, versions, empty KB choice, navigation/history, account isolation, validation, entry errors, knowledge states and race protection. No real backend used.`)
}finally{await browser.close();await new Promise(r=>server.close(r))}
