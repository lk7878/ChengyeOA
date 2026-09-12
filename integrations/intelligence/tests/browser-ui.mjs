import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '../../../LayerManage/law-firm-system/apps/web/node_modules/@playwright/test/index.mjs';
import { IntelligenceService } from '../cloud/service.mjs';
const directory = await mkdtemp(join(tmpdir(), 'chengye-intelligence-ui-'));
const service = new IntelligenceService(join(directory, 'runtime'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(20000); let admin = false; const errors = [];
expect.configure({ timeout: 20000 });
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/v1/intelligence/*', async route => {
  try {
    const body = JSON.parse(route.request().postData()); const path = new URL(route.request().url()).pathname.split('/').pop();
    const frames = []; const options = { onFrame: frame => frames.push(frame) };
    const data = path === 'events' ? await service.events('intelligence-browser-test', body.clientId, body.cursor)
      : { value: path === 'knowledge' ? await service.knowledge(admin, body.method, body.args, options) : await service.caseCall('intelligence-browser-test', body.clientId, body.method, body.args, options), frames };
    await route.fulfill({ json: { code: 200, data } });
  } catch (error) { await route.fulfill({ status: error.status || 500, json: { code: error.status || 500, message: error.message } }).catch(() => {}); }
});
try {
  const ref = (await service.knowledge(true, 'create', { alias: 'ui-law', name: '律所办案知识库' })).knowledgeBase.id;
  await service.knowledge(true, 'importMarkdown', { ref, name: '证据核验指引', markdown: '# 证据核验指引\n\n核对原件、来源与形成时间。' });
  await page.goto('http://localhost:3000/e2e/intelligence.html');
  await expect(page.getByText('V1.2.0', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '云端知识库' })).toBeVisible();
  await expect(page.getByText('核对原件、来源与形成时间。', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '检索知识库' }).fill('证据'); await page.getByRole('button', { name: '检索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '检索结果' })).toBeVisible();
  assert.equal(await page.getByRole('button', { name: '新建知识库', exact: true }).count(), 0);
  await page.screenshot({ path: join(directory, 'lawyer-wiki.png') });
  admin = true; await page.goto('http://localhost:3000/e2e/intelligence.html?admin=1');
  await expect(page.getByText('知识库中心', { exact: true })).toBeVisible();
  await page.screenshot({ path: join(directory, 'admin-wiki.png') });
  admin = false; await page.goto('http://localhost:3000/e2e/intelligence.html?case=1');
  await page.getByRole('button', { name: '新建办案会话', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '办案需求' })).toBeVisible({ timeout: 60000 });
  await page.locator('input[type=file][accept*=pdf]').setInputFiles({ name: '案情摘要.txt', mimeType: 'text/plain', buffer: Buffer.from('当事人提供材料，仍需律师核验。') });
  await expect(page.getByText('案情摘要.txt', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '办案需求' }).fill('请阅读案情摘要'); await page.getByRole('button', { name: '发送办案需求' }).click();
  await expect(page.getByRole('alert')).toContainText('模型尚未配置');
  await expect(page.getByRole('textbox', { name: '办案需求' })).toHaveValue('请阅读案情摘要');
  await page.screenshot({ path: join(directory, 'smart-case.png') });
  await page.reload();
  await page.getByRole('button', { name: /· [a-f0-9]{8}$/ }).click();
  await expect(page.getByText('案情摘要.txt', { exact: true })).toBeVisible({ timeout: 60000 });
  assert.deepEqual(errors, []);
  console.log('PASS: standalone admin and lawyer Wiki, OA brand/navigation, case file import, model configuration error, refresh recovery. Screenshots: ' + directory);
} catch (error) { console.error('UI state:', await page.locator('body').innerText(), errors); await page.screenshot({ path: join(directory, 'failure.png') }); throw error; }
finally { await browser.close(); await service.close(); }
