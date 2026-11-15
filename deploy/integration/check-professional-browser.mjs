/** Synthetic professional preset smoke checks; no medical/legal conclusion validation. */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile,writeFile} from 'node:fs/promises'
const base=process.env.OA_BUSINESS_ROOT,{chromium}=createRequire(base+'/apps/web/package.json')('playwright')
const flow=JSON.parse(await readFile('runtime/e2e/flow-result.json')),fixture=JSON.parse(await readFile('runtime/e2e/fixtures.json'))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
const kinds={disability:'伤残鉴定',injury:'伤情鉴定',malpractice:'医疗损害分析',traffic:'交通事故分析'}
const results=[]
try{for(const [kind,label]of Object.entries(kinds)){
 if(process.env.SMOKE_KINDS&&!process.env.SMOKE_KINDS.split(',').includes(kind))continue;
 const c=await browser.newContext({storageState:'runtime/e2e/alice-browser.json',viewport:{width:1440,height:960}})
 try{const post=async(route,data)=>{const r=await c.request.post('http://127.0.0.1:5182'+route,{data});assert.ok(r.ok(),await r.text());return r.json()}
 const task=await post('/api/tasks',{title:'合成专项验收-'+label,kind,caseId:fixture.caseId,inputs:[{fileId:flow.inputFile,version:1}]})
 const running=await post(`/api/tasks/${task.id}/start`,{}),p=await c.newPage(),issues=[];p.on('pageerror',e=>issues.push(e.message))
 await p.goto(`http://127.0.0.1:5182/harness/${task.id}/#session=${running.sessionId}&workspace=${running.workspaceId}`)
 await p.waitForTimeout(1800);const intro=p.getByRole('button',{name:'继续',exact:true});if(await intro.isVisible())await intro.click();await p.waitForTimeout(500);
 const input=p.locator(`[data-conversation-session="${running.sessionId}"] [contenteditable="true"]`).first();await input.waitFor({timeout:45000})
 await input.fill(`这是合成系统验收，当前专项为${label}。读取 /workspace/task.json 和 materials 中的唯一文本材料；原件只是合同样例，必须明确其不满足本专项要求，不得编造病历、伤残等级、责任比例或法源。不需要询问补充材料，不调用外部检索；请使用当前专项提供的技能或报告模板，生成一份简短的“材料不足与补充材料清单”，在 /workspace/reports/${kind}-smoke.md 保存。列明本专项适用范围、已读材料文件与位置、缺少的必要材料、人工复核事项。若为伤残鉴定，额外调用原有 md-to-word 工具将该清单导出至 /workspace/reports/disability-smoke.docx。完成后回复验收完成。`)
 await p.getByRole('button',{name:'发送消息',exact:true}).click()
 let saved=false,last;for(let i=0;i<160;i++){await p.waitForTimeout(1500);const allow=p.getByRole('button',{name:/^(Allow once|允许一次|允许|批准)$/});if(await allow.count())await allow.first().click();last=await(await c.request.get('http://127.0.0.1:5182/api/tasks/'+task.id)).json();const outputs=Object.values(last.outputs||{});if(outputs.some(o=>o.name===kind+'-smoke.md'&&o.status==='SAVED')&&(kind!=='disability'||outputs.some(o=>o.name==='disability-smoke.docx'&&o.status==='SAVED'))){saved=true;break}}
 await p.screenshot({path:`runtime/e2e/screenshots/${kind}-smoke.png`,fullPage:true});await writeFile(`runtime/e2e/${kind}-smoke.txt`,await p.locator('body').innerText(),{mode:0o600});const result={kind,saved,issues,taskId:task.id};results.push(result);console.log(JSON.stringify(result));await post(`/api/tasks/${task.id}/stop`,{});assert.ok(saved,kind+' outputs not saved');assert.equal(issues.length,0)
 }finally{await c.close()}
}}finally{await writeFile('runtime/e2e/professional-results.json',JSON.stringify(results,null,2));await browser.close()}
