import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeModel } from '../cloud/model-probe.mjs';
const connection = { baseURL: 'https://model.example/v1', model: 'example-model', apiKey: 'test-secret' };
const stream = value => new Response(value, { headers: { 'Content-Type': 'text/event-stream' } });

test('probe makes a bounded real chat request with fixed text and tools, accepting split SSE chunks', async () => {
  const fetch = async (url, init) => {
    assert.equal(url, 'https://model.example/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer test-secret');
    const body = JSON.parse(init.body); assert.equal(body.model, 'example-model'); assert.equal(body.stream, true);
    assert.equal(body.max_tokens, 32); assert.equal(body.messages.length, 1); assert.equal(body.messages[0].content, 'Connection test only. Reply OK.');
    assert.equal(body.tools[0].function.name, 'connection_test');
    return stream(new ReadableStream({ start(controller) {
      for (const part of ['data: {"choices":', '[{"delta":{"content":"OK"}}]}\n', '\ndata: [DONE]\n\n']) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    } }));
  };
  const result = await probeModel(connection, undefined, { fetch }); assert.equal(result.ok, true); assert(result.latencyMs >= 0);
  assert(!JSON.stringify(result).includes(connection.apiKey));
});
test('authentication, missing model and quota failures are actionable and never echo upstream secrets', async () => {
  for (const [status, text] of [[401, /Key无效/], [403, /无权/], [404, /不存在/], [429, /额度/], [500, /暂时不可用/]]) {
    await assert.rejects(probeModel(connection, undefined, { fetch: async () => new Response('test-secret', { status }) }), error => text.test(error.message) && !error.message.includes('test-secret'));
  }
});
test('HTTP 200 alone is insufficient: reject HTML, malformed data and empty completion', async () => {
  for (const response of [new Response('<html>login</html>'), stream('data: broken\n\n'), stream('data: [DONE]\n\n')]) {
    await assert.rejects(probeModel(connection, undefined, { fetch: async () => response }), { status: 422 });
  }
});
test('upstream error payload is not treated as success', async () => {
  await assert.rejects(probeModel(connection, undefined, { fetch: async () => stream('data: {"error":{"message":"test-secret"}}\n\n') }), error => error.status === 422 && !error.message.includes('test-secret'));
});
test('deadline bounds even a stalled resolver or upstream', async () => {
  await assert.rejects(probeModel(connection, undefined, { timeoutMs: 15, fetch: () => new Promise(() => {}) }), { status: 408 });
});
test('oversized stream fails without storing or returning its contents', async () => {
  await assert.rejects(probeModel(connection, undefined, { fetch: async () => stream('x'.repeat(65537)) }), /测试响应异常/);
});
