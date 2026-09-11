// Opt-in integration UI fixture: real connector + native Harness, stub only OA ticket issuance/verification.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createConnector, validateConfig } from '../connector.mjs';
const require=createRequire(new URL('../../../apps/web/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const root=mkdtempSync(join(tmpdir(),'chengye-oa-browser-'));
const config=validateConfig({...JSON.parse(readFileSync(process.argv[2],'utf8')),dataRoot:root,allowedOrigins:['http://localhost:3000']});
const server=createConnector(config,{verify:async body=>({protocol:1,userId:'ui-smoke-user',feature:body.feature,challenge:body.challenge})});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}});page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/v1/harness/ticket',route=>route.fulfill({json:{code:200,data:{ticket:'isolated-browser-test-ticket'}}}));
  await page.goto('http://localhost:3000/e2e/harness-integration.html');
  await expect(page.locator('.main-sidebar-title')).toContainText('律师智慧管理系统');await expect(page.getByText('V1.1.0',{exact:true})).toBeVisible();
  await page.getByRole('spinbutton',{name:'本机连接器端口'}).fill(String(server.address().port));
  await page.getByRole('button',{name:'连接本机助手',exact:true}).click();
  await expect(page.getByRole('link',{name:'在新窗口打开'})).toBeVisible({timeout:120000});
  const frame=page.frameLocator('iframe');
  await expect(frame.getByText('智慧办案法律助手',{exact:true})).toBeVisible();
  for(let n=0;n<3;n++){for(const name of ['继续','稍后配置']){const button=frame.getByRole('button',{name,exact:true});if(await button.isVisible()){await button.click();await page.waitForTimeout(300);}}await page.waitForTimeout(300);}
  await page.screenshot({path:join(root,'oa-smart-case.png')});
  await page.getByRole('button',{name:'知识库',exact:true}).click();
  await page.getByRole('spinbutton',{name:'本机连接器端口'}).fill(String(server.address().port));
  await page.getByRole('button',{name:'连接本机助手',exact:true}).click();
  await expect(page.frameLocator('iframe').getByText('知识库中心',{exact:true})).toBeVisible();
  await expect(page.frameLocator('iframe').getByText('我的法律知识库',{exact:true})).toBeVisible();
  await page.screenshot({path:join(root,'oa-knowledge.png')});
  await page.getByRole('button',{name:'停止本机助手',exact:true}).click();await page.getByRole('button',{name:'停止助手',exact:true}).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  assert.deepEqual(errors,[]);console.log('OA desktop navigation, branding, real native iframes, reconnect and stop passed. Artifacts: '+root);
}finally{await browser?.close();server.shutdown();}
