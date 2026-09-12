import { join } from 'node:path';
import { CloudProcess, accountKey } from './runtime.mjs';
const readMethods = new Set(['list', 'documents', 'search', 'read', 'wiki', 'graph']);
export class IntelligenceService {
  constructor(dataRoot) {
    this.dataRoot = dataRoot; this.cases = new Map();
    this.wiki = new CloudProcess(join(dataRoot, 'wiki'), 'wiki');
    this.janitor = setInterval(() => {
      for (const [key, owner] of this.cases) if (Date.now() - owner.lastSeen > 120000 || owner.runtime.closed) {
        this.cases.delete(key); for (const wake of owner.waiters) wake(); void owner.runtime.close();
      }
    }, 30000); this.janitor.unref();
  }
  modelConnection() { return { apiKey: process.env.CHENGYE_MODEL_API_KEY || '', baseURL: process.env.CHENGYE_MODEL_BASE_URL || 'https://api.deepseek.com' }; }
  async knowledge(admin, method, request, options = {}) {
    if (!admin && !readMethods.has(method)) throw Object.assign(new Error('只有系统管理员可以维护和编译知识库'), { status: 403 });
    if (!admin && method !== 'list') {
      const list = await this.wiki.call('knowledge', { method: 'list' });
      const base = list.knowledgeBases.find(base => (base.id === request?.ref || base.alias === request?.ref) && base.status === 'active');
      if (!base) throw Object.assign(new Error('知识库不存在或未启用'), { status: 404 });
    }
    if (!admin && method === 'read') {
      const startLine = request.startLine ?? 1;
      if (!Number.isSafeInteger(startLine) || startLine < 1) throw Object.assign(new Error('无效行号'), { status: 400 });
      request = { ...request, startLine, endLine: Math.min(request.endLine ?? startLine + 199, startLine + 199) };
    }
    const value = await this.wiki.call('knowledge', { method, request }, { ...options, connection: this.modelConnection() });
    return !admin && method === 'list' ? { knowledgeBases: value.knowledgeBases.filter(base => base.status === 'active') } : value;
  }
  caseOwner(userId, clientId) {
    if (!/^[a-f0-9-]{36}$/.test(clientId)) throw Object.assign(new Error('无效的浏览器工作区标识'), { status: 400 });
    const key = accountKey(userId + '\0' + clientId);
    let owner = this.cases.get(key);
    if (!owner || owner.runtime.closed) {
      if (this.cases.size >= 32) throw Object.assign(new Error('当前智能服务繁忙，请稍后重试'), { status: 503 });
      owner = { queue: [], cursor: 0, waiters: new Set(), lastSeen: Date.now(), pending: new Map(), sessions: new Set() };
      owner.runtime = new CloudProcess(join(this.dataRoot, 'sessions', key), 'case', event => {
        if (event.kind === 'knowledge-request') {
          void this.handleKnowledge(event).then(value => owner.runtime.call('reply', { id: event.id, sessionId: event.sessionId, value }), () => owner.runtime.call('reply', { id: event.id, sessionId: event.sessionId, error: true })).catch(() => {});
          return;
        }
        if (event.kind === 'browser-request') owner.pending.set(event.id, event.sessionId);
        if (event.kind === 'withdraw') owner.pending.delete(event.id);
        owner.queue.push({ cursor: ++owner.cursor, ...event });
        if (owner.queue.length > 1000) owner.queue.shift();
        for (const wake of owner.waiters) wake(); owner.waiters.clear();
      });
      this.cases.set(key, owner);
    }
    owner.lastSeen = Date.now(); return owner;
  }
  async handleKnowledge(event) {
    const { method, args, refs } = event.request;
    if (!refs.includes(args.ref)) throw new Error('Knowledge binding denied');
    if (method === 'sources') {
      const values = await this.knowledge(false, 'list');
      const base = values.knowledgeBases.find(base => base.id === args.ref || base.alias === args.ref);
      if (!base) throw new Error('Knowledge unavailable');
      return { knowledgeBase: base, ...(await this.knowledge(false, 'documents', { ref: base.id })) };
    }
    if (!['search', 'read'].includes(method)) throw new Error('Unsupported knowledge operation');
    return this.knowledge(false, method, { ...args, limit: 8 });
  }
  async caseCall(userId, clientId, method, args, options = {}) {
    if (method === 'close') {
      const key = accountKey(userId + '\0' + clientId); const owner = this.cases.get(key);
      if (owner) { this.cases.delete(key); for (const wake of owner.waiters) wake(); await owner.runtime.close(); }
      return { closed: true };
    }
    if (method === 'ocr') {
      if (typeof args?.imageBase64 !== 'string' || args.imageBase64.length > 20_000_000) throw Object.assign(new Error('OCR 图片无效'), { status: 400 });
      return this.wiki.call('ocr', args, options);
    }
    if (!['health', 'caseCreate', 'casePrompt', 'caseRead', 'caseResume', 'caseCancel', 'caseDocuments', 'caseDocument', 'reply'].includes(method)) throw Object.assign(new Error('不支持的办案操作'), { status: 400 });
    const owner = this.caseOwner(userId, clientId);
    if (method === 'reply') {
      if (owner.pending.get(args.id) !== args.sessionId) throw Object.assign(new Error('请求已失效'), { status: 409 });
      owner.pending.delete(args.id);
    } else if (args?.id && method !== 'caseResume' && !owner.sessions.has(args.id)) throw Object.assign(new Error('办案会话不存在'), { status: 404 });
    if (args?.refs && (!Array.isArray(args.refs) || args.refs.length > 12 || args.refs.some(ref => typeof ref !== 'string' || ref.length > 100))) throw Object.assign(new Error('知识库选择无效'), { status: 400 });
    const value = await owner.runtime.call(method, args, { ...options, connection: this.modelConnection() });
    if (method === 'caseCreate' || method === 'caseResume') owner.sessions.add(value.id);
    return value;
  }
  async events(userId, clientId, cursor = 0, signal) {
    const owner = this.caseOwner(userId, clientId);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw Object.assign(new Error('无效事件位置'), { status: 400 });
    if (!owner.queue.some(item => item.cursor > cursor)) await new Promise(resolvePromise => {
      const finish = () => { clearTimeout(timer); owner.waiters.delete(finish); signal?.removeEventListener('abort', finish); resolvePromise(); };
      const timer = setTimeout(finish, 20000); owner.waiters.add(finish); signal?.addEventListener('abort', finish, { once: true });
    });
    return { events: owner.queue.filter(item => item.cursor > cursor), cursor: owner.cursor };
  }
  async close() { clearInterval(this.janitor); await Promise.allSettled([this.wiki.close(), ...[...this.cases.values()].map(owner => owner.runtime.close())]); this.cases.clear(); }
}
