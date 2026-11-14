import { join } from 'node:path';
import { CloudProcess } from './runtime.mjs';
import { boundedReply, knowledgeCall } from '../desktop/knowledge-contract.mjs';
import { ServerCaseService } from './server-case-service.mjs';
const readMethods = new Set(['list', 'documents', 'search', 'read', 'wiki', 'graph']);
export class IntelligenceService {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.wiki = new CloudProcess(join(dataRoot, 'wiki'), 'wiki');
    this.serverCases = new ServerCaseService(dataRoot, event => this.handleKnowledge(event));
  }
  modelConnection() { return { apiKey: process.env.CHENGYE_MODEL_API_KEY || '', baseURL: process.env.CHENGYE_MODEL_BASE_URL || 'https://api.deepseek.com' }; }
  async desktopKnowledge(userId, body, options = {}) {
    if (!body || Object.keys(body).some(key => !['userId', 'method', 'args'].includes(key)) || body.userId !== userId) throw Object.assign(new Error('OA 身份不匹配，请重新登录或新建办案会话'), { status: 403 });
    const { method, args } = knowledgeCall(body.method, body.args);
    const { offset = 0, ...nativeArgs } = args;
    if (method === 'search') nativeArgs.limit = 8;
    let result;
    if (method === 'compiled') {
      // Recheck active-base access, then read persisted publication only. Never generate.
      const documents = await this.knowledge(false, 'documents', { ref: nativeArgs.ref }, options);
      const document = documents.documents.find(item => item.id === nativeArgs.documentId);
      if (!document) throw Object.assign(new Error('知识库文档不存在'), { status: 404 });
      const state = await this.wiki.call('knowledge', { method: 'compilation', request: nativeArgs }, options);
      const publication = state.publication;
      const sections = publication?.sections.slice(offset, offset + 5) ?? [];
      const factIds = new Set(sections.flatMap(section => section.factIds));
      result = { ref: nativeArgs.ref, documentId: document.id, documentName: document.name, status: state.status,
        publication: publication ? { title: publication.title, createdAt: publication.createdAt, sourceHash: publication.sourceHash, contentHash: publication.contentHash,
          sections, facts: publication.facts.filter(fact => factIds.has(fact.id)), gaps: publication.gaps,
          nextOffset: offset + 5 < publication.sections.length ? offset + 5 : null } : null };
    } else result = await this.knowledge(false, method, nativeArgs, options);
    const page = rows => ({ items: rows.slice(offset, offset + 20), total: rows.length, nextOffset: offset + 20 < rows.length ? offset + 20 : null });
    if (method === 'list') result = { knowledgeBases: page(result.knowledgeBases) };
    if (method === 'documents') result = { documents: page(result.documents.map(({ error: _error, ...document }) => document)) };
    if (method === 'wiki') {
      result = { ...result, pages: args.documentId ? result.pages.map(({ academicGuide: _guide, ...item }) => ({ ...item, sections: page(item.sections) }))
        : page(result.pages.map(({ sections: _sections, academicGuide: _guide, ...item }) => item)) };
    }
    // No full source contents or arbitrary provider errors in list metadata.
    return boundedReply({ userId, result });
  }
  async knowledge(admin, method, request, options = {}) {
    if (!admin && !readMethods.has(method)) throw Object.assign(new Error('只有系统管理员可以维护和编译知识库'), { status: 403 });
    if (!admin && method !== 'list') {
      const list = await this.wiki.call('knowledge', { method: 'list' }, options);
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
  async caseCall(userId, _clientId, method, args, options = {}) {
    return this.serverCases.call(userId, method, args, options);
  }
  async events(userId, _clientId, cursor = 0, signal, authorize) {
    return this.serverCases.events(userId, cursor, signal, authorize);
  }
  async close() { await Promise.allSettled([this.wiki.close(), this.serverCases.close()]); }
}
