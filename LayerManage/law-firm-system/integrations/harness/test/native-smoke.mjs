// Opt-in: node test/native-smoke.mjs <config.local.json>. Uses temporary personal data and no model calls.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { HarnessRuntime } from '../runtime.mjs';
import { validateConfig } from '../connector.mjs';
const require=createRequire(new URL('../../../apps/web/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const root=mkdtempSync(join(tmpdir(),'chengye-harness-native-'));
const config=validateConfig({...JSON.parse(readFileSync(process.argv[2],'utf8')),dataRoot:root});
const runtime=new HarnessRuntime(config);let browser;
async function wiki(result){
  const page=await browser.newPage({viewport:{width:1500,height:1050}});page.setDefaultTimeout(15000);
  await page.goto(result.url+'#oa-view=knowledge');
  await expect(page.getByText('知识库中心',{exact:true})).toBeVisible();
  for(let n=0;n<3;n++){
    for(const name of ['继续','稍后配置']){const button=page.getByRole('button',{name,exact:true});if(await button.isVisible()){await button.click();await page.waitForTimeout(300);}}
    await page.waitForTimeout(300);
  }
  await page.getByText('我的法律知识库',{exact:true}).click();return page;
}
try{
  const [a,same]=await Promise.all([runtime.launch('native-user-a'),runtime.launch('native-user-a')]);assert.equal(a.url,same.url);
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await wiki(a);
  await page.getByRole('button',{name:'导入源文件',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'OA集成验收.md',mimeType:'text/markdown',buffer:Buffer.from('# OA集成验收\n\n虚构测试案卷：本地知识库原文应在重启后保留。\n')});
  await page.getByRole('button',{name:'导入源文件',exact:true}).click();
  await expect(page.getByText('OA集成验收.md — 已导入',{exact:true})).toBeVisible();
  await expect(page.getByText('源文件字节已在本地持久化 · 已完成',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Wiki',exact:true}).click();
  await page.screenshot({path:join(root,'wiki.png')});
  console.log('Native raw import and Wiki view passed.');
  const b=await runtime.launch('native-user-b');assert.notEqual(a.dataDirectory,b.dataDirectory);assert.notEqual(new URL(a.url).port,new URL(b.url).port);
  const second=await wiki(b);await expect(second.getByText('尚无源文档',{exact:true})).toBeVisible();await second.close();runtime.stop('native-user-b');
  await page.close();runtime.stop('native-user-a');
  const restarted=await runtime.launch('native-user-a');assert.equal(restarted.dataDirectory,a.dataDirectory);
  const reopened=await wiki(restarted);await expect(reopened.getByText('OA集成验收.md',{exact:true})).toBeVisible();
  await reopened.getByRole('button',{name:'返回会话',exact:true}).click();await expect(reopened.getByText('智慧办案法律助手',{exact:true})).toBeVisible();
  await reopened.screenshot({path:join(root,'legal-assistant.png')});
  console.log('Same-user single instance, different-user storage, restart persistence, and legal preset passed.');
  console.log('Test artifacts (no credentials printed): '+root);
}finally{await browser?.close();runtime.close();}
