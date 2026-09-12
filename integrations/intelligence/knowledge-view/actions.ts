import type { KnowledgeClientActions } from '../../../third_party/deepseek-harness/packages/product/product-knowledge/src/client/KnowledgeBaseCenter';
type Call = (method: string, args?: any, signal?: AbortSignal, onFrame?: (value: any) => void) => Promise<any>;

export function knowledgeActions(call: Call, close: () => void): KnowledgeClientActions {
  return {
    close,
    list: async () => (await call('list')).knowledgeBases,
    create: async (alias, name) => (await call('create', { alias, name })).knowledgeBase,
    documents: async ref => (await call('documents', { ref })).documents,
    importMarkdown: async (ref, name, markdown) => { await call('importMarkdown', { ref, name, markdown }); },
    importFile: async (ref, file, stageOnly) => {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return call('importFile', { ref, fileName: file.name, base64: btoa(binary), ...(stageOnly ? { stageOnly } : {}) });
    },
    documentDetail: (ref, documentId) => call('documentDetail', { ref, documentId }),
    reprocess: (ref, documentId) => call('reprocess', { ref, documentId }),
    search: (ref, query) => call('search', { ref, query, limit: 8 }),
    wiki: (ref, documentId) => call('wiki', { ref, ...(documentId ? { documentId } : {}) }),
    graph: ref => call('graph', { ref }),
    ask: async (ref, question, mode, onFrame, signal, conversation) => {
      let answer;
      await call('askStream', { ref, question, mode, ...(conversation ? { conversation } : {}) }, signal, frame => { onFrame(frame); if (frame.type === 'complete') answer = frame.answer; });
      if (!answer) throw new Error('问答未返回完整结果'); return answer;
    },
    topics: ref => call('topics', { ref }), previewTopic: (request, signal) => call('previewTopic', request, signal),
    saveTopic: (ref, topic) => call('saveTopic', { ref, topic }), queue: (ref, documentIds) => call('queue', { ref, ...(documentIds ? { documentIds } : {}) }),
    conversation: (ref, before) => call('conversation', { ref, ...(before === undefined ? {} : { before }) }),
    modelSettings: () => call('modelSettings'), saveModelSettings: settings => call('saveModelSettings', { settings }),
    compilerSettings: () => call('compilerSettings'), saveCompilerSettings: settings => call('saveCompilerSettings', { settings }),
    compilation: request => call('compilation', request), compileDocument: (request, signal) => call('compileDocument', request, signal),
    reviewVision: request => call('reviewVision', request), reviewGap: request => call('reviewGap', request), testModel: signal => call('testModel', {}, signal),
    semanticIndexStatus: async ref => (await call('semanticIndexStatus', { ref })).status,
    rebuildSemanticIndex: async (ref, signal) => (await call('rebuildSemanticIndex', { ref }, signal)).status,
    clearSemanticIndex: async ref => (await call('clearSemanticIndex', { ref })).status,
    setStatus: async (ref, status) => (await call('setStatus', { ref, status })).knowledgeBase,
    deleteDocument: async (ref, documentId) => { await call('deleteDocument', { ref, documentId }); },
    deleteKnowledgeBase: async (ref, expectedAlias) => { await call('delete', { ref, expectedAlias }); },
    backup: (ref, complete) => call('backup', { ref, ...(complete ? { complete } : {}) }),
    restore: async json => (await call('restore', { json })).knowledgeBase,
  };
}
