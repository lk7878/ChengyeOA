import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntelligenceService } from '../cloud/service.mjs';
import { CloudProcess, cleanEnvironment } from '../cloud/runtime.mjs';

const root = await mkdtemp(join(tmpdir(), 'chengye-wiki-contract-'));
const service = new IntelligenceService(root);
const admin = (method, args) => service.knowledge(true, method, args);
const lawyer = (method, args) => service.knowledge(false, method, args);
try {
  for (const method of ['create', 'importFile', 'delete', 'setStatus', 'backup', 'restore', 'modelSettings', 'conversation', 'compileDocument']) {
    await assert.rejects(lawyer(method, {}), error => error.status === 403);
  }
  const created = await admin('create', { alias: 'law-contract-test', name: '云端测试知识库' });
  const ref = created.knowledgeBase.id;
  const doc = await admin('importFile', { ref, fileName: '证据指引.txt', base64: Buffer.from('证据核验\n核对原件、来源与形成时间。\n不得推定未提供的证据。').toString('base64') });
  assert.ok(doc.document.id);
  assert.equal((await lawyer('list')).knowledgeBases.length, 1);
  assert.equal((await lawyer('documents', { ref })).documents.length, 1);
  const hits = await lawyer('search', { ref, query: '证据' }); assert.ok(hits.hits.length);
  const read = await lawyer('read', { ref, documentId: doc.document.id, startLine: 1, endLine: 999 }); assert.match(read.content, /核对原件/);
  const wiki = await lawyer('wiki', { ref }); assert.ok(wiki.pages.length);
  const desktop = (method, args) => service.desktopKnowledge('lawyer', { userId: 'lawyer', method, args });
  assert.equal((await desktop('list')).result.knowledgeBases.items.length, 1);
  assert.ok((await desktop('search', { ref, query: '证据' })).result.hits[0].documentId);
  const excerpt = (await desktop('read', { ref, documentId: doc.document.id, startLine: 1, endLine: 2 })).result;
  assert.match(excerpt.content, /证据指引/); assert.equal(excerpt.startLine, 1); assert.equal(excerpt.endLine, 2);
  assert.ok((await desktop('wiki', { ref, documentId: doc.document.id })).result.pages[0].sections.items.length);
  const unpublished = (await desktop('compiled', { ref, documentId: doc.document.id })).result;
  assert.equal(unpublished.publication, null); assert.equal(unpublished.status, 'uncompiled'); assert.equal(unpublished.vision, undefined);
  await assert.rejects(desktop('compileDocument', { ref }), error => error.status === 400);
  await assert.rejects(service.desktopKnowledge('other', { userId: 'lawyer', method: 'list' }), error => error.status === 403);
  await admin('modelSettings'); await admin('compilerSettings');
  const backup = await admin('backup', { ref, complete: true });
  assert.ok(backup.json);
  await admin('setStatus', { ref, status: 'archived' });
  assert.equal((await lawyer('list')).knowledgeBases.length, 0);
  await assert.rejects(lawyer('documents', { ref }), error => error.status === 404);
  await assert.rejects(desktop('read', { ref, documentId: doc.document.id }), error => error.status === 404);
  await assert.rejects(service.handleKnowledge({ request: { method: 'sources', refs: [ref], args: { ref } } }));
  await admin('delete', { ref, expectedAlias: 'law-contract-test' });
  const restored = await admin('restore', { json: backup.json });
  assert.equal((await admin('documents', { ref: restored.knowledgeBase.id })).documents.length, 1);
  const contender = new CloudProcess(join(root, 'wiki'), 'wiki');
  await assert.rejects(contender.call('health'), /数据目录已被占用/); await contender.close();
  await assert.rejects(service.caseCall('user1', 'x', 'health', {}), error => error.status === 400);
  const client = 'a'.repeat(8) + '-0000-0000-0000-' + 'b'.repeat(12);
  const owner1 = service.caseOwner('user1', client); const owner2 = service.caseOwner('user2', client);
  assert.notEqual(owner1, owner2);
  await assert.rejects(service.caseCall('user2', client, 'reply', { id: 'other', sessionId: 'case-other' }), error => error.status === 409);
  await assert.rejects(service.caseCall('user1', client, 'ocr', { imageBase64: 'aGVsbG8=' }), /OCR 未配置/);
  const safe = cleanEnvironment(root, 'case'); assert.equal(safe.DATABASE_URL, undefined); assert.equal(safe.CHENGYE_MODEL_API_KEY, undefined);
  console.log('PASS: real native cloud Wiki import/search/read/backup/restore, read-only and archive enforcement, user isolation, singleton lock, OCR missing-config');
} finally { await service.close(); }
