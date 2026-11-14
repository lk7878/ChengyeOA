import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeBroker } from '../knowledge-broker.mjs';
import { knowledgeCall } from '../knowledge-contract.mjs';
import { IntelligenceService } from '../../cloud/service.mjs';
import { sessionRoot } from '../../desktop-plugin/session-root.mjs';

test('read-only wire rejects mutation, extra fields and unbounded reads', () => {
  for (const method of ['delete', 'create', 'askStream', 'compileDocument', 'modelSettings', '__proto__']) assert.throws(() => knowledgeCall(method), { status: 400 });
  for (const args of [{ ref: 'a', url: 'https://example.com' }, { ref: 'a', query: 'a'.repeat(2001) }, { ref: 'a', query: '' }]) assert.throws(() => knowledgeCall('search', args));
  assert.throws(() => knowledgeCall('read', { ref: 'a', documentId: 'b', endLine: 201 }));
  assert.throws(() => knowledgeCall('read', { ref: 'a', documentId: 'b', startLine: 10, endLine: 1 }));
  assert.deepEqual(knowledgeCall('read', { ref: 'a', documentId: 'b' }).args, { ref: 'a', documentId: 'b', startLine: 1, endLine: 200 });
});
test('login, account/server bindings, cancellation and late replies are isolated', () => {
  const events = [], replies = [], owner = {};
  const broker = new KnowledgeBroker('https://oa.example', event => events.push(event));
  const call = (extra = {}) => broker.request({ kind: 'chengye-wiki-request', id: 'native-call', method: 'list', args: {}, ...extra }, value => replies.push(value), owner);
  call(); assert.match(replies.pop().error, /先在 OA 登录/);
  broker.setIdentity('lawyer-a'); call({ binding: { origin: 'https://other.example', userId: 'lawyer-a' } }); assert.match(replies.pop().error, /新建会话/);
  call(); const id = events.at(-1).id;
  broker.setIdentity('lawyer-b'); assert.match(replies.at(-1).error, /变化/);
  const count = replies.length; broker.accept({ id, value: { userId: 'lawyer-a', result: 'late private evidence' } }); assert.equal(replies.length, count);
  call({ binding: { origin: 'https://oa.example', userId: 'lawyer-a' } }); assert.match(replies.at(-1).error, /新建会话/);
  call(); broker.accept({ id: events.at(-1).id, value: { userId: 'lawyer-b', result: { sources: [] } } });
  assert.deepEqual(replies.at(-1).binding, { origin: 'https://oa.example', userId: 'lawyer-b' });
  call(); broker.request({ kind: 'chengye-wiki-cancel', id: 'native-call' }, () => {}, {}); assert.equal(broker.pending.size, 1);
  broker.detach(owner); assert.equal(broker.pending.size, 0);
});
test('identity mismatch, oversized response, and timeout never return evidence', async () => {
  const events = [], replies = [];
  const broker = new KnowledgeBroker('https://oa.example', value => events.push(value), 10);
  const call = () => broker.request({ kind: 'chengye-wiki-request', id: 'call', method: 'list' }, value => replies.push(value), {});
  broker.setIdentity('a'); call(); broker.accept({ id: events.at(-1).id, value: { userId: 'b', result: 'private' } }); assert.match(replies.pop().error, /身份不匹配/);
  call(); broker.accept({ id: events.at(-1).id, value: { userId: 'a', result: 'x'.repeat(150000) } }); assert.match(replies.pop().error, /过大/);
  call(); await new Promise(done => setTimeout(done, 25)); assert.match(replies.pop().error, /超时/); assert.equal(broker.pending.size, 0);
});
test('compiled reads project persisted publication with source facts, never OCR candidates or secrets', async () => {
  const service = Object.create(IntelligenceService.prototype), calls = [];
  service.knowledge = async (admin, method) => { assert.equal(admin, false); assert.equal(method, 'documents'); return { documents: [{ id: 'doc', name: '法律资料.md' }] }; };
  service.wiki = { call: async (method, args) => {
    calls.push({ method, args });
    return { status: 'stale', error: 'private provider diagnostics', vision: [{ attachmentId: 'internal-file', text: 'unreviewed candidate' }], publication: {
      title: '编译材料', createdAt: '2026-09-13', sourceHash: 'source', contentHash: 'content',
      sections: Array.from({ length: 6 }, (_, index) => ({ heading: String(index), text: '编译结论', factIds: [String(index)] })),
      facts: Array.from({ length: 6 }, (_, index) => ({ id: String(index), startLine: index + 1, endLine: index + 1, quote: '原文', sourceHash: 'source' })), gaps: ['待复核'],
    } };
  } };
  const { result } = await service.desktopKnowledge('a', { userId: 'a', method: 'compiled', args: { ref: 'base', documentId: 'doc', offset: 5 } });
  assert.equal(calls[0].args.method, 'compilation'); assert.equal(calls.length, 1);
  assert.equal(result.status, 'stale'); assert.equal(result.publication.sections.length, 1); assert.equal(result.publication.facts[0].startLine, 6);
  assert.equal(result.publication.nextOffset, null); assert.equal(result.vision, undefined); assert.equal(result.error, undefined);
  assert.ok(!JSON.stringify(result).includes('internal-file'));
});
test('native forks/subagents share the root binding and missing ancestry fails closed', async () => {
  const root = { id: 'root' }, fork = { id: 'fork', parentSession: 'root' }, child = { id: 'child', parentSession: 'fork' };
  const headers = new Map([root, fork, child].map(header => [header.id, header]));
  assert.equal(await sessionRoot(child, async id => headers.get(id)), 'root');
  await assert.rejects(sessionRoot(child, async () => undefined), /新建会话/);
  headers.set('root', { id: 'root', parentSession: 'child' });
  await assert.rejects(sessionRoot(child, async id => headers.get(id)), /来源异常/);
});
