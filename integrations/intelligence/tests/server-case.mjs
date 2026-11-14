import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createServer, globalAgent } from 'node:https';
import { spawnSync } from 'node:child_process';
import { ServerCaseService } from '../cloud/server-case-service.mjs';
import { publicAddress, modelUrl } from '../cloud/model-endpoint.mjs';

const root = await mkdtemp(join(tmpdir(), 'chengye-server-case-'));
const authorize = async feature => { if (feature === 'model-admin') throw Object.assign(new Error('administrator only'), { status: 403 }); };
const adminAuthorize = async () => {};
const originalCa = globalAgent.options.ca;
let service = new ServerCaseService(root, async () => ({ sources: [] }));
const call = (user, method, args = {}, auth = user === 'administrator' ? adminAuthorize : authorize) => service.call(user, method, args, { authorize: auth });
const check = (condition, message) => assert.ok(condition, message);
let modelServer;
try {
  for (const address of ['127.0.0.1', '10.1.1.1', '172.16.0.1', '192.168.2.3', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(publicAddress(address), false);
  assert.equal(publicAddress('8.8.8.8'), true); assert.throws(() => modelUrl('http://localhost')); assert.throws(() => modelUrl('https://user:key@example.com'));
  const created = await call('lawyer-a', 'caseCreate', { requestId: randomUUID() });
  console.log('native Harness server session created');
  const sessionId = created.id;
  assert.equal((await call('lawyer-a', 'sessions')).length, 1);
  assert.equal((await call('lawyer-b', 'sessions')).length, 0);
  assert.equal((await call('administrator', 'sessions')).length, 0);
  await assert.rejects(call('lawyer-b', 'state', { id: sessionId }), /不存在/);
  await assert.rejects(call('lawyer-b', 'caseCancel', { id: sessionId }), /不存在/);
  await assert.rejects(call('lawyer-a', 'sessions', {}, async () => { throw Object.assign(new Error('revoked'), { status: 403 }); }), /revoked/);
  await call('lawyer-a', 'sessionChange', { id: sessionId, action: 'rename', title: '服务器恢复测试' });
  await call('lawyer-a', 'sessionChange', { id: sessionId, action: 'archive' }); assert.equal((await call('lawyer-a', 'sessions')).length, 0);
  assert.equal((await call('lawyer-a', 'sessions', { filter: 'archived' }))[0].title, '服务器恢复测试');
  await call('lawyer-a', 'sessionChange', { id: sessionId, action: 'unarchive' });
  const large = Buffer.concat([Buffer.from('# Large material\nA legal test fixture.\n'), Buffer.alloc(21 * 1024 ** 2, 32)]);
  const uploadId = randomUUID(); const begin = { uploadId, sessionId, fileName: '大于20MB的材料.md', size: large.length };
  await call('lawyer-a', 'uploadBegin', begin); await call('lawyer-a', 'uploadBegin', begin);
  await assert.rejects(call('lawyer-b', 'uploadChunk', { uploadId, offset: 0, base64: 'eA==' }), /不存在/);
  await assert.rejects(call('lawyer-a', 'uploadBegin', { ...begin, uploadId: randomUUID(), fileName: '../escape.txt' }), /文件名/);
  await assert.rejects(call('lawyer-a', 'uploadBegin', { ...begin, uploadId: randomUUID(), size: 201 * 1024 ** 2 }), /200MB/);
  for (let offset = 0; offset < large.length; offset += 4 * 1024 ** 2) {
    const args = { uploadId, offset, base64: large.subarray(offset, offset + 4 * 1024 ** 2).toString('base64') };
    await call('lawyer-a', 'uploadChunk', args); await call('lawyer-a', 'uploadChunk', args);
  }
  await call('lawyer-a', 'uploadFinish', { uploadId }); await call('lawyer-a', 'uploadFinish', { uploadId });
  await Promise.all([...service.owners.get('lawyer-a').parseTasks]);
  const files = await call('lawyer-a', 'files', { sessionId }); assert.equal(files.length, 1); assert.equal(files[0].status, 'ready');
  const chunks = []; let offset = 0;
  while (offset < large.length) { const value = await call('lawyer-a', 'downloadChunk', { sessionId, fileName: begin.fileName, offset }); chunks.push(Buffer.from(value.base64, 'base64')); offset = value.next; }
  assert.equal(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), createHash('sha256').update(large).digest('hex'));
  console.log('21MB upload, retry, parse and download verified');
  await call('lawyer-a', 'sessionChange', { id: sessionId, action: 'delete' });
  await assert.rejects(call('lawyer-a', 'downloadChunk', { sessionId, fileName: begin.fileName }), /不存在/);
  await call('lawyer-a', 'sessionChange', { id: sessionId, action: 'restore' });
  await service.close(); service = new ServerCaseService(root, async () => ({ sources: [] }));
  assert.equal((await call('lawyer-a', 'sessions'))[0].title, '服务器恢复测试'); assert.equal((await call('lawyer-a', 'files', { sessionId }))[0].size, large.length);
  console.log('restart persistence, deletion/restore and account isolation verified');

  const openssl = 'C:/Program Files/Git/usr/bin/openssl.exe'; const key = join(root, 'test-key.pem'); const cert = join(root, 'test-cert.pem');
  assert.equal(spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { windowsHide: true, stdio: 'ignore' }).status, 0);
  let calls = 0; let concurrentPhase = false; const failures = [];
  modelServer = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks));
      if (body.messages[0]?.content === 'Connection test only. Reply OK.') {
        assert.equal(req.url, '/chat/completions'); assert.equal(req.headers.authorization, 'Bearer test-only-secret');
        if (body.model === 'missing-model') { res.statusCode = 404; res.end('not found'); return; }
        assert.equal(body.tools[0].function.name, 'connection_test');
        res.setHeader('Content-Type', 'text/event-stream'); res.end('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'); return;
      }
      assert.equal(body.model, 'test-legal-model'); assert.equal(req.headers.authorization, 'Bearer test-only-secret');
      check(body.tools.some(tool => tool.function.name === 'legal_skill'), 'legal skill plugin missing');
      check(body.tools.some(tool => tool.function.name === 'knowledge_search'), 'knowledge plugin missing');
      check(!body.tools.some(tool => /bash|pwsh|shell|exec/.test(tool.function.name)), 'arbitrary command tool exposed');
      const step = ++calls;
      if (concurrentPhase) {
        const label = JSON.stringify(body.messages).includes('并发乙') ? '乙' : '甲';
        res.setHeader('Content-Type', 'text/event-stream');
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '隔离结果' + label } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`); return;
      }
      const tool = step === 1 ? { name: 'legal_skill', arguments: JSON.stringify({ name: 'contract-review' }) }
        : step === 2 ? { name: 'case_save_document', arguments: JSON.stringify({ fileName: '律师复核草稿.md', content: '# 法律助手\n服务器测试草稿，待律师复核。' }) } : null;
      res.setHeader('Content-Type', 'text/event-stream');
      const values = tool ? [{ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + step, type: 'function', function: tool }] } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]
        : [{ choices: [{ delta: { role: 'assistant', content: '草稿已保存，请律师复核。' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }];
      for (const value of values) res.write(`data: ${JSON.stringify(value)}\n\n`); res.end('data: [DONE]\n\n');
    } catch (e) { failures.push(e); res.statusCode = 500; res.end(); }
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  const baseURL = `https://127.0.0.1:${modelServer.address().port}`; process.env.CHENGYE_MODEL_ORIGINS = baseURL; process.env.NODE_EXTRA_CA_CERTS = cert;
  globalAgent.options.ca = await readFile(cert);
  const draft = { baseURL, model: 'test-legal-model', apiKey: 'test-only-secret' };
  for (const method of ['saveSettings', 'clearSettings', 'testSettings']) await assert.rejects(call('lawyer-a', method, draft), { status: 403 });
  const probe = await call('administrator', 'testSettings', draft); assert.equal(probe.ok, true);
  assert.equal((await call('administrator', 'settings')).configured, false, 'probe must not save configuration');
  await assert.rejects(call('administrator', 'testSettings', { ...draft, model: 'missing-model' }), /模型或接口不存在/);
  const saved = await call('administrator', 'saveSettings', draft);
  check(saved.configured && !JSON.stringify(saved).includes('test-only-secret'), 'secret leaked in settings');
  check(!service.models.db.prepare('SELECT value FROM model_settings').get().value.includes('test-only-secret'), 'secret not encrypted');
  assert.deepEqual(await call('lawyer-a', 'settings'), { configured: true, canManage: false, maxFileBytes: 200 * 1024 ** 2 });
  // An existing personal configuration must no longer change this user's effective model.
  service.owners.get('lawyer-a').store.saveSettings({ baseURL, model: 'retired-personal-model', apiKey: 'retired-personal-key' });
  await assert.rejects(call('lawyer-a', 'casePrompt', { id: sessionId, requestId: randomUUID(), revision: 'stale', text: 'test', refs: [] }), /其他页面/);
  const state = await call('lawyer-a', 'state', { id: sessionId });
  const prompt = { id: sessionId, requestId: randomUUID(), revision: state.revision, text: '请加载合同审查技能并保存草稿。', refs: [] };
  await call('lawyer-a', 'casePrompt', prompt); await call('lawyer-a', 'casePrompt', prompt);
  let complete = false;
  for (let i = 0; i < 150; i++) {
    const state = await call('lawyer-a', 'state', { id: sessionId });
    for (const event of state.pending) await call('lawyer-a', 'reply', { id: event.id, sessionId, value: 'allowed-once' });
    if (state.events.some(event => event.type === 'assistant/chunk' && event.data.chunk?.text?.includes('草稿已保存'))) { complete = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.deepEqual(failures, []); check(complete, 'native model loop did not complete'); check(calls >= 3);
  check((await call('lawyer-a', 'files', { sessionId })).some(file => file.name === '律师复核草稿.md'), 'approved output missing');
  console.log('mock TLS model, legal skill, permission-bound tools and approved server output verified');
  concurrentPhase = true;
  const second = await call('lawyer-b', 'caseCreate', { requestId: randomUUID() });
  // Wait for native idle, then run distinct accounts concurrently through the actual adapter.
  for (let i = 0; i < 50 && service.owners.get('lawyer-a').active.size; i++) await new Promise(resolve => setTimeout(resolve, 100));
  await Promise.all([['lawyer-a', sessionId, '并发甲'], ['lawyer-b', second.id, '并发乙']].map(async ([user, id, text]) => {
    const state = await call(user, 'state', { id }); await call(user, 'casePrompt', { id, text, refs: [], revision: state.revision, requestId: randomUUID() });
  }));
  for (const [user, id, label, forbidden] of [['lawyer-a', sessionId, '甲', '乙'], ['lawyer-b', second.id, '乙', '甲']]) {
    let output = '';
    for (let i = 0; i < 100; i++) {
      const state = await call(user, 'state', { id }); output = state.events.filter(event => event.type === 'assistant/chunk').map(event => event.data.chunk?.text || '').join('');
      if (output.includes('隔离结果' + label)) break; await new Promise(resolve => setTimeout(resolve, 100));
    }
    check(output.includes('隔离结果' + label)); check(!output.includes('隔离结果' + forbidden));
  }
  assert.deepEqual(failures, []);
  console.log('parallel account model execution does not mix context or results');
  const badUpload = randomUUID();
  await call('lawyer-b', 'uploadBegin', { uploadId: badUpload, sessionId: second.id, fileName: '损坏材料.pdf', size: 4 });
  await call('lawyer-b', 'uploadChunk', { uploadId: badUpload, offset: 0, base64: Buffer.from('nope').toString('base64') });
  await call('lawyer-b', 'uploadFinish', { uploadId: badUpload });
  await Promise.all([...service.owners.get('lawyer-b').parseTasks]);
  assert.equal((await call('lawyer-b', 'files', { sessionId: second.id }))[0].status, 'failed');
  assert.equal(Buffer.from((await call('lawyer-b', 'downloadChunk', { sessionId: second.id, fileName: '损坏材料.pdf' })).base64, 'base64').toString(), 'nope');
  await service.close(); service = new ServerCaseService(root, async () => ({ sources: [] }));
  assert.equal((await call('lawyer-a', 'settings')).configured, true);
  assert.equal(service.models.connection().apiKey, 'test-only-secret');
  assert.equal((await call('administrator', 'settings')).configured, true);
  assert.equal((await call('administrator', 'testSettings', { baseURL, model: 'test-legal-model', apiKey: '' })).ok, true);
  await call('administrator', 'clearSettings'); assert.equal((await call('lawyer-a', 'settings')).configured, false);
  console.log('shared admin configuration, draft connectivity probe, private-key retirement and restart verified');
} finally { globalAgent.options.ca = originalCa; await service.close(); await new Promise(resolve => modelServer ? modelServer.close(resolve) : resolve()); }
console.log('Server smart-case acceptance passed (isolated temporary data; mock model).');
