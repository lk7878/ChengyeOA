import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { DeepSeekAdapter, resolveAdapterOptions } from '../../../third_party/deepseek-harness/packages/llm/llm-deepseek/lib/index.js';
import { createUserMessage } from '../../../third_party/deepseek-harness/packages/llm/llm/lib/index.js';
import { BrowserSessionPersistence } from './browser-persistence.mjs';
import { KnowledgeController } from '../dist/knowledge-host.mjs';
import { LocalPaddleOcrClient } from '../cloud/ocr-provider.mjs';
import { modelFetch, modelUrl } from '../cloud/model-endpoint.mjs';

export const name = 'chengye-cloud';
export const inject = ['llm', 'agents', 'agentPresets', 'approval', 'sessions', 'typert', 'agentDefaultModel'];
const send = value => { if (process.connected) process.send(value); };
const errorValue = error => ({ code: error?.code ?? 'INTELLIGENCE_FAILED', message: error?.code === 'MISSING_CREDENTIAL' ? '模型尚未配置，请联系管理员配置云端模型 API Key' : error?.code === 'OCR_UNCONFIGURED' ? '云端 OCR 未配置，请联系管理员配置 Python 环境和模型目录' : '智能服务操作失败，请检查配置或稍后重试' });

export function apply(ctx) {
  if (!process.send) throw new Error('OA Harness must run under the managed IPC launcher');
  const handles = new Map(); const creating = new Map(); const active = new Map(); const questions = new Map();
  const bindings = new Map(); const requestScope = new AsyncLocalStorage();
  const anonymous = randomUUID();
  const isWiki = process.env.CHENGYE_RUNTIME_PURPOSE === 'wiki';
  const isServerCase = process.env.CHENGYE_RUNTIME_PURPOSE === 'server-case';
  if (isServerCase) globalThis.fetch = modelFetch;
  let wiki;
  const defaultOptions = resolveAdapterOptions({ maxTokens: 16000 });
  const adapter = new DeepSeekAdapter({
    options: () => requestScope.getStore()?.options ?? defaultOptions,
    resolveApiKey: async options => {
      const key = requestScope.getStore()?.apiKey;
      if (!key) throw Object.assign(new Error('Model key missing'), { code: 'MISSING_CREDENTIAL' });
      return key;
    },
    resolveUserId: () => anonymous,
    resolveAttachments: () => ctx.get('attachments'),
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  });
  ctx.llm.registerAdapter(['deepseek-official'], adapter);

  function connection(input) {
    const baseURL = input?.baseURL || 'https://api.deepseek.com';
    const url = new URL(baseURL);
    const allowed = new Set(['https://api.deepseek.com', ...(process.env.CHENGYE_MODEL_ORIGINS || '').split(',').filter(Boolean)]);
    if (isServerCase) modelUrl(baseURL);
    else if (url.username || url.password || url.search || url.hash || !allowed.has(url.origin) || url.protocol !== 'https:') throw new Error('Model endpoint is not allowed');
    if (input?.apiKey && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey))) throw new Error('Invalid model key');
    const ref = 'OA_' + randomUUID().replaceAll('-', '');
    // Async descendants (including native compilation queues) retain this
    // request snapshot until completion; no global credential cache or files.
    return { apiKey: input?.apiKey || '', options: resolveAdapterOptions({ baseURL, apiKeyEnv: ref, maxTokens: isServerCase ? 4096 : 16000, ...(isServerCase ? { defaultContextWindow: 32768 } : {}) }) };
  }

  function askBrowser(sessionId, type, request, signal) {
    signal?.throwIfAborted(); const id = randomUUID();
    return new Promise((resolvePromise, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); questions.delete(id); };
      const abort = () => { cleanup(); reject(new Error('Browser request cancelled')); send({ kind: 'withdraw', id, sessionId }); };
      const timer = setTimeout(abort, 180000);
      questions.set(id, { sessionId, resolve: value => { cleanup(); resolvePromise(value); }, reject: error => { cleanup(); reject(error); } });
      signal?.addEventListener('abort', abort, { once: true });
      send({ kind: type === 'knowledge' ? 'knowledge-request' : 'browser-request', id, sessionId, type, request });
    });
  }

  ctx.provide('oaIntelligence', {
    async knowledge(sessionId, method, args, signal) {
      const refs = bindings.get(sessionId) || [];
      if (!refs.length) throw new Error('请在智慧办案中选择需要引用的云端知识库');
      if (args.ref && !refs.includes(args.ref)) throw new Error('该知识库未授权给当前办案会话');
      return askBrowser(sessionId, 'knowledge', { method, args: { ...args, ref: args.ref || refs[0] }, refs }, signal);
    },
    listDocuments: sessionId => askBrowser(sessionId, 'workspace', { method: 'files', args: { sessionId } }),
    readDocument: (sessionId, fileName, startLine, endLine) => askBrowser(sessionId, 'workspace', { method: 'readFile', args: { sessionId, fileName, startLine, endLine } }),
    writeDocument: (sessionId, fileName, content) => askBrowser(sessionId, 'workspace', { method: 'writeDocument', args: { sessionId, fileName, content } }),
  });
  if (!isWiki) new BrowserSessionPersistence(ctx, (id, method, args, signal) => askBrowser(id, 'persistence', { method, args }, signal));
  else wiki = new KnowledgeController(ctx, { databasePath: join(process.env.DSH_HOME, 'knowledge.db'), ocrEnabled: true });
  ctx.on('approval/request', request => askBrowser(String(request.agent.id), 'approval', { id: request.id, toolName: request.toolName, reason: request.reason }, request.signal));
  ctx.on('user-questions/request', request => askBrowser(String(request.agent.id), 'question', { questions: request.questions }, request.signal));
  ctx.on('session/event', (session, event) => { if (String(session.id).startsWith('case-')) send({ kind: 'session-event', sessionId: String(session.id), event }); });
  ctx.on('agent/status', ({ agent, status }) => send({ kind: 'session-status', sessionId: String(agent.id), status }));
  ctx.on('agent/error', ({ agent, error }) => send({ kind: 'session-error', sessionId: String(agent.id), error: errorValue(error) }));

  async function getCase(id, model, selected) {
    if (handles.has(id)) return handles.get(id);
    if (creating.has(id)) return creating.get(id);
    const pending = (async () => {
      const cwd = process.cwd();
      const setup = async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'chengye-legal'); };
      const handle = await ctx.agents.create({ sessionId: id, meta: { cwd, agentPreset: 'chengye-legal' },
        agentOptions: { provider: 'deepseek-official', model }, setup });
      handles.set(id, handle); bindings.set(id, selected); return handle;
    })();
    creating.set(id, pending); try { return await pending; } finally { creating.delete(id); }
  }

  async function dispatch(message, signal) {
    const args = message.args || {};
    switch (message.method) {
      case 'ocr': { const ocr = new LocalPaddleOcrClient(); try { return await ocr.recognize(Buffer.from(args.imageBase64, 'base64'), args.pageNumber); } finally { ocr.close(); } }
      case 'knowledge': {
        if (!wiki) throw new Error('Knowledge service unavailable');
        const allowed = new Set(['list', 'create', 'documents', 'importMarkdown', 'importFile', 'documentDetail', 'reprocess', 'search', 'read', 'wiki', 'graph', 'askStream', 'topics', 'previewTopic', 'saveTopic', 'queue', 'conversation', 'modelSettings', 'saveModelSettings', 'compilerSettings', 'saveCompilerSettings', 'compilation', 'compileDocument', 'reviewVision', 'reviewGap', 'testModel', 'semanticIndexStatus', 'rebuildSemanticIndex', 'clearSemanticIndex', 'setStatus', 'deleteDocument', 'delete', 'backup', 'restore']);
        if (!allowed.has(args.method)) throw new Error('Unsupported knowledge method');
        const value = wiki[args.method](args.request, signal);
        if (value?.[Symbol.asyncIterator]) { for await (const frame of value) send({ kind: 'result', id: message.id, frame }); return; }
        return value;
      }
      case 'models': return ctx.llm.listModels(args.provider || 'deepseek-official');
      case 'modelInfo': return ctx.llm.resolveModelInfo(args.provider, args.model, signal);
      case 'prepareModel': { const value = await ctx.llm.prepareCall(args, signal); return { config: value.config, adapterDefaults: value.adapterDefaults }; }
      case 'modelStream': {
        for await (const frame of ctx.llm.stream({ ...args, tools: undefined, signal })) send({ kind: 'result', id: message.id, frame });
        return;
      }
      case 'caseCreate': {
        const id = isServerCase ? args.id : 'case-' + randomUUID();
        if (!/^case-[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid case session');
        const handle = await getCase(id, args.model || 'deepseek-v4-flash', args.refs || []);
        await ctx.sessionPersistence.ensureMaterialized(handle.agent.session);
        return { id, events: handle.agent.session.events, preset: '智慧办案法律助手' };
      }
      case 'casePrompt': {
        const handle = handles.get(args.id); if (!handle) throw new Error('办案会话不存在');
        if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 100000) throw new Error('请输入有效办案需求');
        const conn = requestScope.getStore();
        if (!conn.apiKey) throw Object.assign(new Error('Model key missing'), { code: 'MISSING_CREDENTIAL' });
        bindings.set(args.id, args.refs || []);
        requestScope.run(conn, () => handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: args.text }], source: { kind: 'user' } })));
        return { accepted: true };
      }
      case 'caseRead': { const handle = handles.get(args.id); if (!handle) throw new Error('办案会话不存在'); return { id: args.id, events: handle.agent.session.events }; }
      case 'caseResume': {
        if (!/^case-[a-f0-9-]{36}$/.test(args.id)) throw new Error('Invalid case session');
        if (handles.has(args.id)) return { id: args.id, events: handles.get(args.id).agent.session.events };
        bindings.set(args.id, args.refs || []);
        const handle = await ctx.agents.resume({ resumeSessionId: args.id, agentOptions: { provider: 'deepseek-official', model: args.model || 'deepseek-v4-flash' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'chengye-legal'); } });
        handles.set(args.id, handle); return { id: args.id, events: handle.agent.session.events };
      }
      case 'caseCancel': { const handle = handles.get(args.id); if (handle) { await handle.dispose(); handles.delete(args.id); bindings.delete(args.id); } return { cancelled: true }; }
      case 'caseDocuments': return ctx.oaIntelligence.listDocuments(args.id);
      case 'caseDocument': return ctx.oaIntelligence.readDocument(args.id, args.fileName);
      case 'reply': {
        const question = questions.get(args.id); if (!question || question.sessionId !== args.sessionId) throw new Error('请求已结束');
        if (args.error) question.reject(new Error('本地工作区请求未完成')); else question.resolve(args.value); return { accepted: true };
      }
      case 'health': return { protocol: 2, transport: 'ipc', httpListeners: process.getActiveResourcesInfo().filter(type => type === 'TCPServerWrap').length, providers: ctx.llm.listProviders(), presets: await ctx.agentPresets.list() };
      default: throw new Error('Unsupported intelligence operation');
    }
  }

  const listener = message => {
    if (message?.kind === 'cancel') { active.get(message.id)?.abort(); return; }
    if (message?.kind !== 'request') return;
    const abort = new AbortController(); active.set(message.id, abort);
    let conn;
    Promise.resolve().then(async () => {
      conn = connection(message.connection); return requestScope.run(conn, () => dispatch(message, abort.signal));
    }).then(result => send({ kind: 'result', id: message.id, result, done: true }), error => send({ kind: 'result', id: message.id, error: errorValue(error), done: true }))
      .finally(() => { active.delete(message.id); });
  };
  process.on('message', listener);
  ctx.effect(() => async () => {
    process.off('message', listener); for (const abort of active.values()) abort.abort();
    for (const value of questions.values()) value.reject(new Error('Service closing'));
    await Promise.allSettled([...handles.values()].map(handle => handle.dispose())); bindings.clear();
  });
  setImmediate(() => { void ctx.loader.await().then(() => send({ kind: 'ready', protocol: 2 }), () => send({ kind: 'failed' })); });
}
