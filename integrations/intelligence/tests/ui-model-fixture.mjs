import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** Keyless, local TLS model exercising native question -> approval -> Markdown UI. */
export async function uiModelFixture(directory) {
  const key = join(directory, 'ui-model-key.pem'), cert = join(directory, 'ui-model-cert.pem');
  const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  assert.equal(spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { windowsHide: true, stdio: 'ignore' }).status, 0);
  let calls = 0; const errors = [];
  const server = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(req.headers.authorization, 'Bearer ui-model-fixture'); assert.ok(body.messages.length);
      const turn = ++calls;
      if (turn === 2) assert.ok(JSON.stringify(body.messages).includes('起诉状'), 'native question answer must reach the model');
      const tool = turn === 1 ? { name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ id: 'document-type', question: '请选择本次需要的文书', options: [{ label: '起诉状' }, { label: '答辩状' }] }] }) }
        : { name: 'case_save_document', arguments: JSON.stringify({ fileName: '起诉状草稿.md', content: '# 起诉状草稿\n\n请律师复核事实与请求。' }) };
      const values = turn <= 2
        ? [{ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'ui-call-' + turn, type: 'function', function: tool }] } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]
        : [{ choices: [{ delta: { role: 'assistant', content: '## 草稿已保存\n\n**请律师复核**事实与请求。\n\n| 项目 | 状态 |\n| --- | --- |\n| 文书 | 待复核 |' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 6 } }];
      res.setHeader('Content-Type', 'text/event-stream');
      for (const value of values) res.write(`data: ${JSON.stringify(value)}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch (error) { errors.push(error); res.statusCode = 500; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const keys = ['CHENGYE_MODEL_ORIGINS', 'NODE_EXTRA_CA_CERTS', 'CHENGYE_MODEL_API_KEY', 'CHENGYE_MODEL_BASE_URL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const baseURL = `https://127.0.0.1:${server.address().port}`;
  process.env.CHENGYE_MODEL_ORIGINS = baseURL; process.env.NODE_EXTRA_CA_CERTS = cert;
  delete process.env.CHENGYE_MODEL_API_KEY;
  return { enable() { process.env.CHENGYE_MODEL_API_KEY = 'ui-model-fixture'; process.env.CHENGYE_MODEL_BASE_URL = baseURL; },
    verify() { assert.equal(calls, 3); assert.deepEqual(errors, []); },
    async close() { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } await new Promise(resolve => server.close(resolve)); },
  };
}
