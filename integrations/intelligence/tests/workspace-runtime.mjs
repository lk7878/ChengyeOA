import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { zipSync, strToU8 } from 'fflate';
import { chromium } from '../../../LayerManage/law-firm-system/apps/web/node_modules/@playwright/test/index.mjs';
import { CloudProcess } from '../cloud/runtime.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const assets = resolve(root, 'LayerManage/law-firm-system/apps/web/public/intelligence');
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Workspace contract test</title>'); return; }
    const path = resolve(assets, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(assets + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) throw new Error('path');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const directory = await mkdtemp(join(tmpdir(), 'chengye-workspace-contract-'));
let runtime; let modelServer; let rejectPersistence = false;
const requests = []; const failures = [];
async function connect() {
  runtime = new CloudProcess(directory, 'case', event => {
    if (event.kind !== 'browser-request') return;
    requests.push(event.type);
    void (async () => {
      assert.ok(['persistence', 'approval', 'workspace'].includes(event.type));
      if (rejectPersistence && event.type === 'persistence') { await runtime.call('reply', { id: event.id, sessionId: event.sessionId, error: true }); return; }
      const value = event.type === 'approval' ? 'allowed-once' : await page.evaluate(({ request, type }) => window.workspace.call(type === 'persistence' ? 'persistence' : request.method, type === 'persistence' ? request : request.args), { request: event.request, type: event.type });
      await runtime.call('reply', { id: event.id, sessionId: event.sessionId, value });
    })().catch(error => failures.push(error));
  });
  return runtime.call('health');
}
const local = (method, args) => page.evaluate(({ method, args }) => window.workspace.call(method, args), { method, args });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => { const { openWorkspace } = await import('/case-view.js'); window.workspace = await openWorkspace('test-lawyer', async () => { throw new Error('OCR must be explicitly configured'); }); });
  const health = await connect(); assert.equal(health.httpListeners, 0);
  const created = await runtime.call('caseCreate', {}, { timeoutMs: 30000 });
  assert.match(created.id, /^case-/); assert.ok(requests.includes('persistence'));
  assert.equal((await local('sessions'))[0].id, created.id);
  await local('writeDocument', { sessionId: created.id, fileName: '测试文书.md', content: '# 律师测试\n这是留在本机的文书。' });
  assert.match((await local('readFile', { sessionId: created.id, fileName: '测试文书.md' })).text, /留在本机/);
  const importFile = (fileName, bytes) => local('importFile', { sessionId: created.id, fileName, base64: Buffer.from(bytes).toString('base64') });
  const docx = zipSync({ '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'), 'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>律师文档材料</w:t></w:r></w:p></w:body></w:document>') });
  await importFile('材料.docx', docx);
  assert.match((await local('readFile', { sessionId: created.id, fileName: '材料.docx' })).text, /律师文档材料/);
  const requireNative = createRequire(new URL('../../../third_party/deepseek-harness/packages/product/product-knowledge/package.json', import.meta.url));
  const { Workbook } = requireNative('exceljs'); const workbook = new Workbook(); workbook.addWorksheet('证据').addRow(['材料名称', '核验状态']);
  await importFile('材料.xlsx', await workbook.xlsx.writeBuffer());
  assert.match((await local('readFile', { sessionId: created.id, fileName: '材料.xlsx' })).text, /核验状态/);
  const stream = 'BT /F1 12 Tf 30 700 Td (Case evidence must be reviewed by a qualified lawyer.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0]; for (let i = 0; i < objects.length; i++) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length; pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await importFile('evidence.pdf', Buffer.from(pdf));
  assert.match((await local('readFile', { sessionId: created.id, fileName: 'evidence.pdf' })).text, /qualified lawyer/);
  const backup = await local('backup'); assert.equal(backup.files.length, 4);
  await assert.rejects(local('restore', { backup }), /重复/);
  await assert.rejects(local('writeDocument', { sessionId: created.id, fileName: '../escape.txt', content: 'no' }), /无效/);
  await runtime.close();
  await page.evaluate(() => window.workspace.close());
  await page.reload();
  await page.evaluate(async () => { const { openWorkspace } = await import('/case-view.js'); window.workspace = await openWorkspace('test-lawyer', async () => {}); });
  await connect();
  const resumed = await runtime.call('caseResume', { id: created.id }, { timeoutMs: 30000 });
  assert.equal(resumed.id, created.id);
  assert.equal((await local('files', { sessionId: created.id })).length, 4);
  await assert.rejects(runtime.call('casePrompt', { id: created.id, text: '请核对已上传文件', refs: [] }), /模型尚未配置/);
  await runtime.call('caseCancel', { id: created.id });
  assert.ok((await local('persistence', { method: 'load', args: { id: created.id } })).events.length > 0);

  // A scripted TLS endpoint exercises the real native model/tool loop without
  // sending user data or credentials to an external provider.
  const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  const key = join(directory, 'test-key.pem'); const cert = join(directory, 'test-cert.pem');
  const generated = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
  assert.equal(generated.status, 0, 'OpenSSL is required for the local TLS model fixture');
  let modelCalls = 0;
  modelServer = createHttpsServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
    try {
      const buffers = []; for await (const buffer of req) buffers.push(buffer);
      const body = JSON.parse(Buffer.concat(buffers).toString());
      assert.equal(req.headers.authorization, 'Bearer test-only-model-credential');
      assert.ok(body.messages.length);
      const saved = await local('persistence', { method: 'load', args: { id: created.id } });
      assert.ok(saved.events.some(event => event.type === 'user/message'), 'model must wait for durable user-message checkpoint');
      res.setHeader('Content-Type', 'text/event-stream');
      const scripted = ++modelCalls === 1
        ? [{ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-save', type: 'function', function: { name: 'case_save_document', arguments: JSON.stringify({ fileName: '测试草稿.md', content: '# 待律师复核\n本地测试草稿。' }) } }] } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]
        : [{ choices: [{ delta: { role: 'assistant', content: '草稿已保存，请律师复核。' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 3 } }];
      for (const value of scripted) res.write(`data: ${JSON.stringify(value)}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch (error) { failures.push(error); res.statusCode = 500; res.end(); }
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  const connection = { baseURL: `https://127.0.0.1:${modelServer.address().port}`, apiKey: 'test-only-model-credential' };
  process.env.CHENGYE_MODEL_ORIGINS = connection.baseURL; process.env.NODE_EXTRA_CA_CERTS = cert;
  await runtime.close(); await connect();
  await runtime.call('caseResume', { id: created.id }, { connection });
  await runtime.call('casePrompt', { id: created.id, text: '请保存一份待律师复核的本地测试草稿', refs: [] }, { connection });
  const deadline = Date.now() + 30000;
  let completed = false;
  while (Date.now() < deadline) {
    const current = await runtime.call('caseRead', { id: created.id });
    if (current.events.some(event => event.type === 'assistant/chunk' && event.data.chunk?.text?.includes('草稿已保存'))) { completed = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(completed, 'native model and tool loop did not finish');
  assert.equal(modelCalls, 2); assert.ok(requests.includes('approval')); assert.ok(requests.includes('workspace'));
  assert.match((await local('readFile', { sessionId: created.id, fileName: '测试草稿.md' })).text, /待律师复核/);
  await runtime.call('caseCancel', { id: created.id });
  await runtime.call('caseResume', { id: created.id }, { connection });
  rejectPersistence = true;
  await runtime.call('casePrompt', { id: created.id, text: 'This failed checkpoint must never reach a model', refs: [] }, { connection });
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.equal(modelCalls, 2, 'model advanced without browser persistence acknowledgement');
  rejectPersistence = false; await runtime.call('caseCancel', { id: created.id });
  assert.equal(failures.length, 0, String(failures[0]));
  async function walk(dir) { return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : join(dir, entry.name)))).flat(); }
  const paths = await walk(directory);
  assert.ok(!paths.some(path => /\.jsonl$|knowledge\.db$|sessions\.db$/.test(path)), paths.join('\n'));
  for (const path of paths) if (/\.(json|yaml|yml|log|txt|md)$/.test(path)) assert.ok(!(await readFile(path, 'utf8')).includes('本地测试草稿。'), 'personal draft persisted in cloud file: ' + path);
  console.log('PASS: native IPC case creation, browser checkpoints before model calls, approval and document save, OPFS refresh/resume, cancel, no cloud session files (scripted local TLS model)');
} finally {
  await runtime?.close(); await page.evaluate(() => window.workspace?.close()).catch(() => {});
  await browser.close(); await new Promise(resolve => server.close(resolve));
  if (modelServer) await new Promise(resolve => modelServer.close(resolve));
}
