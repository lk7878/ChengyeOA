import '../browser/globals';
import { openLocalDatabase, closeLocalDatabase } from '../browser/sqlite';
import { KnowledgeBaseStore } from '../../../third_party/deepseek-harness/packages/product/product-knowledge/src/store';

self.onmessage = async ({ data }) => {
  let store: KnowledgeBaseStore | undefined;
  try {
    await openLocalDatabase(data.partition);
    store = new KnowledgeBaseStore('/knowledge.db');
    if (data.write) {
      store.create('spec-library', '本地知识库验收');
      await store.importFile('spec-library', '持久化原文.txt', Buffer.from('SQLite persistence evidence\n本地保存律师资料及编译结果。').toString('base64'));
    }
    const bases = store.list(); const docs = store.documents('spec-library');
    const result: Record<string, unknown> = { bases, docs, hits: store.search('spec-library', 'persistence'), wiki: store.wiki('spec-library'), detail: store.detail('spec-library', docs[0].id) };
    if (data.backup) {
      const backup = store.backup('spec-library', true);
      store.delete('spec-library', 'spec-library');
      result.restored = store.restore(backup.json);
      result.restoredDetail = store.detail('spec-library', store.documents('spec-library')[0].id);
    }
    store.close(); store = undefined; closeLocalDatabase();
    self.postMessage({ ok: true, result });
  } catch (error) {
    store?.close(); closeLocalDatabase();
    self.postMessage({ ok: false, error: error instanceof Error ? error.stack : String(error) });
  }
};
