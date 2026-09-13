import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { _electron, expect } from '../../../../LayerManage/law-firm-system/apps/web/node_modules/@playwright/test/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vendor = resolve(root, '../../third_party/deepseek-harness');
const require = createRequire(join(vendor, 'apps/product-desktop/package.json'));
const home = await mkdtemp(join(tmpdir(), 'chengye-desktop-e2e-'));
const work = join(home, '中文案件目录'); await mkdir(work);
const source = join(work, '案情摘要.txt'), output = join(work, '办案草稿.md');
const deniedDirectory = join(root, 'run', home.split(/[\\/]/).at(-1));
await mkdir(deniedDirectory, { recursive: true });
const outside = join(deniedDirectory, '不应写入.txt');
await writeFile(source, '测试案件编号 CY-TEST-001。委托人提供的证据需要核验。');
const resultText = '# 办案草稿\n\n案件 CY-TEST-001：请律师核验原始证据。\n';
const requests = [], errors = [];
const model = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    assert.equal(req.headers.authorization, 'Bearer desktop-fixture');
    const tools = body.tools?.map(tool => tool.function?.name) || [];
    // Session title generation has no tool catalog; keep it separate from the agent flow.
    let tool;
    if (tools.includes('read')) {
      const results = body.messages.filter(message => message.role === 'tool');
      if (!results.length) tool = { name: 'read', arguments: JSON.stringify({ file_path: source }) };
      else if (results.length === 1) {
        assert.ok(JSON.stringify(results).includes('CY-TEST-001'), 'actual local read result reaches the model');
        tool = { name: 'write', arguments: JSON.stringify({ file_path: output, content: resultText }) };
      } else if (results.length === 2) {
        assert.ok(JSON.stringify(results).includes('办案草稿.md'));
        tool = { name: 'write', arguments: JSON.stringify({ file_path: outside, content: 'This outside-workspace write must be denied.' }) };
      } else assert.match(JSON.stringify(results.at(-1)), /sandbox|denied/i, 'native workspace boundary must reject the outside write');
    }
    const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'desktop-call-' + requests.length, type: 'function', function: tool }] }
      : { role: 'assistant', content: tools.length ? '已读取本地案情并保存办案草稿，请律师复核。' : '本地办案验证' };
    res.setHeader('Content-Type', 'text/event-stream');
    for (const value of [{ choices: [{ delta }] }, { choices: [{ delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }]) res.write(`data: ${JSON.stringify(value)}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (error) { errors.push(error.message); res.statusCode = 500; res.end(); }
});
await new Promise(done => model.listen(0, '127.0.0.1', done));

async function run(command, args, env) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
    child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error(logs)));
  });
}
const env = { ...process.env, CHENGYE_DESKTOP_HOME: home }; delete env.ELECTRON_RUN_AS_NODE;
let app, oa, agent, launches = 0;
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [join(root, 'dist/desktop')], env });
  app.process().stderr.on('data', value => { if (String(value).includes('Harness startup:')) console.error(String(value)); });
  oa = await app.firstWindow(); oa.setDefaultTimeout(30000);
  await oa.waitForLoadState();
  await expect(oa.getByRole('button', { name: '智慧办案', exact: true })).toBeVisible();
  assert.equal(await (await app.browserWindow(oa)).evaluate(window => window.isVisible()), true);
  const next = app.waitForEvent('window', { timeout: 90000 });
  await oa.getByRole('button', { name: '智慧办案', exact: true }).click();
  agent = await next; agent.setDefaultTimeout(30000); await agent.waitForLoadState();
  if (launches++ === 0) await agent.getByRole('button', { name: '继续', exact: true }).click();
  await expect(agent.getByText('新会话', { exact: true }).first()).toBeVisible({ timeout: 60000 });
  console.log('Native UI ready.');
}

try {
  await run(process.execPath, ['scripts/desktop.mjs', 'setup', '--oa-url', 'http://localhost:3000/e2e/intelligence.html'], env);
  await writeFile(join(home, 'harness/.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: desktop-fixture\n');
  await writeFile(join(home, 'harness/settings.yaml'), JSON.stringify({ 'llm-deepseek': { baseURL: `http://127.0.0.1:${model.address().port}`, thinking: 'disabled', reasoningEffort: 'off' } }));
  await launch();
  assert.deepEqual(await oa.evaluate(() => ({ node: typeof window.require, keys: Object.keys(window.chengyeDesktop) })), { node: 'undefined', keys: ['version', 'openAssistant'] });
  assert.equal(await agent.evaluate(() => typeof window.chengyeDesktop), 'undefined');
  assert.equal(await oa.getByRole('dialog', { name: '智慧办案浮动工作台' }).count(), 0);
  await oa.screenshot({ path: join(home, 'oa-entry.png') });
  await agent.getByRole('button', { name: '选择工作区', exact: true }).click();
  await run('pwsh.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'desktop/tests/select-directory.ps1'), '-Directory', work, '-AppProcessId', String(app.process().pid)], env);
  console.log('Native directory selected.');
  await expect(agent.getByText('中文案件目录', { exact: true }).first()).toBeVisible();
  await agent.screenshot({ path: join(home, 'native-workspace.png') });
  const composer = agent.locator('[contenteditable=true]').first();
  await composer.fill('请读取案情摘要.txt，并生成办案草稿.md。');
  await composer.press('Enter');
  // Any native permission question remains visible; do not bypass its decision path.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await agent.getByText('已读取本地案情并保存办案草稿，请律师复核。', { exact: true }).isVisible()) break;
    for (const name of ['仅本次允许', '允许一次', '允许', '确认', '信任此工作区']) {
      const approval = agent.getByRole('button', { name, exact: true });
      if (await approval.count() === 1 && await approval.isVisible()) { await approval.click(); console.log('Native approval:', name); }
    }
    await new Promise(done => setTimeout(done, 500));
  }
  console.log('Conversation:', (await agent.locator('body').innerText()).slice(-5000));
  await expect(agent.getByText('已读取本地案情并保存办案草稿，请律师复核。', { exact: true })).toBeVisible();
  assert.equal(await readFile(output, 'utf8'), resultText);
  await assert.rejects(readFile(outside), { code: 'ENOENT' });
  assert.equal(await readFile(source, 'utf8'), '测试案件编号 CY-TEST-001。委托人提供的证据需要核验。');
  await agent.screenshot({ path: join(home, 'native-result.png') });
  const agentId = await (await app.browserWindow(agent)).evaluate(window => window.id);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http://127.0.0.1:')).close(); });
  await oa.getByRole('button', { name: '智慧办案', exact: true }).click();
  assert.equal(await (await app.browserWindow(agent)).evaluate(window => window.id), agentId);
  assert.equal(app.windows().length, 2);
  const stoppedOrigin = new URL(agent.url()).origin;
  await app.close(); app = undefined;
  await assert.rejects(fetch(stoppedOrigin, { signal: AbortSignal.timeout(1500) }), 'quitting must close the native Host listener');
  await launch();
  await agent.getByText('本地办案验证', { exact: true }).first().click();
  await expect(agent.getByText('已读取本地案情并保存办案草稿，请律师复核。', { exact: true })).toBeVisible({ timeout: 30000 });
  assert.equal(await readFile(output, 'utf8'), resultText);
  await agent.screenshot({ path: join(home, 'native-restored.png') });
  assert.deepEqual(errors, []);
  assert.ok(requests.some(body => body.tools?.some(tool => tool.function?.name === 'read')));
  console.log('PASS: native directory/read/write/window restore/restart persistence. Artifacts: ' + home);
} finally {
  if (agent && !agent.isClosed()) {
    await agent.screenshot({ path: join(home, 'last-state.png') }).catch(() => {});
    await writeFile(join(home, 'last-state.txt'), await agent.locator('body').innerText().catch(() => 'closed'));
  }
  await app?.close();
  await new Promise(done => model.close(done));
  console.log('Test home: ' + home);
}
