import { join } from 'node:path';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { CloudProcess, accountKey } from './runtime.mjs';
import { ServerWorkspace, credentialKey, fail, CHUNK_BYTES } from './server-workspace.mjs';
import { modelUrl, endpointAddresses } from './model-endpoint.mjs';
import { parseFile } from './parse-file.mjs';
import { SharedModelSettings } from './shared-model-settings.mjs';
import { probeModel } from './model-probe.mjs';

export class ServerCaseService {
  constructor(root, knowledge, options = {}) {
    this.root = join(root, 'case-server'); this.knowledge = knowledge; this.owners = new Map();
    this.key = credentialKey(this.root); this.Runtime = options.Runtime || CloudProcess; this.parser = options.parser || parseFile;
    this.models = new SharedModelSettings(this.root, this.key); this.probes = new Set();
    this.janitor = setInterval(() => {
      for (const owner of this.owners.values()) if (owner.runtime && !owner.runtime.closed && !owner.active.size && !owner.creating.size && Date.now() - owner.lastSeen > 10 * 60000) void owner.runtime.close();
    }, 60000); this.janitor.unref();
  }
  owner(userId, authorize) {
    let owner = this.owners.get(userId);
    if (!owner) {
      const root = join(this.root, accountKey(userId));
      owner = { root, store: new ServerWorkspace(root, this.key), queue: [], cursor: 0, waiters: new Set(), pending: new Map(), active: new Set(), creating: new Set(), parsing: new Set(), serial: Promise.resolve() };
      this.owners.set(userId, owner);
    }
    if (authorize) owner.authorize = authorize;
    owner.lastSeen = Date.now();
    return owner;
  }
  async check(owner, feature = 'case') { if (!owner.authorize) throw fail('需要有效的OA登录授权', 401); await owner.authorize(feature); }
  emit(owner, event) { owner.queue.push({ ...event, cursor: ++owner.cursor }); if (owner.queue.length > 1000) owner.queue.shift(); for (const wake of owner.waiters) wake(); owner.waiters.clear(); }
  runtime(owner) {
    if (!owner.runtime || owner.runtime.closed) {
      if ([...this.owners.values()].filter(value => value.runtime && !value.runtime.closed).length >= 16) throw fail('智慧办案正在处理较多任务，请稍后重试', 503);
      owner.runtime = new this.Runtime(join(owner.root, 'engine'), 'server-case', event => {
        void this.handle(owner, event).catch(error => {
          if (error.status === 401 || error.status === 403) {
            owner.active.clear(); owner.pending.clear();
            owner.store.db.prepare("UPDATE sessions SET status='interrupted' WHERE status NOT IN ('idle','interrupted')").run();
            void owner.runtime.close(); return;
          }
          if (event.id) void owner.runtime.call('reply', { id: event.id, sessionId: event.sessionId, error: true }).catch(() => {});
        });
      });
    }
    return owner.runtime;
  }
  async handle(owner, event) {
    await this.check(owner);
    const id = event.sessionId;
    if (id && !owner.creating.has(id)) owner.store.session(id);
    if (event.kind === 'knowledge-request') {
      await this.check(owner, 'knowledge');
      const value = await this.knowledge(event); await this.check(owner, 'knowledge');
      return owner.runtime.call('reply', { id: event.id, sessionId: id, value });
    }
    if (event.kind === 'browser-request') {
      const { request } = event;
      if (event.type === 'persistence') {
        if (request.args.id && request.args.id !== id || request.args.meta?.id && request.args.meta.id !== id) throw fail('会话身份不匹配', 403);
        const value = owner.store.persistence(request.method, request.args);
        return owner.runtime.call('reply', { id: event.id, sessionId: id, value });
      }
      if (event.type === 'workspace') {
        if (request.args.sessionId !== id) throw fail('材料不属于当前会话', 403);
        const args = request.args; let value;
        if (request.method === 'files') value = owner.store.files(id);
        else if (request.method === 'readFile') value = owner.store.read(id, args.fileName, args.startLine, args.endLine);
        else if (request.method === 'writeDocument') value = owner.store.writeDocument(id, args.fileName, args.content);
        else throw fail('不支持的材料操作');
        return owner.runtime.call('reply', { id: event.id, sessionId: id, value });
      }
      if (!['approval', 'question'].includes(event.type)) throw fail('不支持的交互');
      owner.pending.set(event.id, event);
    }
    if (event.kind === 'withdraw') owner.pending.delete(event.id);
    if (event.kind === 'session-status') {
      owner.store.db.prepare('UPDATE sessions SET status=? WHERE id=?').run(event.status, id);
      if (['idle', 'disposed', 'error'].includes(event.status)) {
        owner.active.delete(id); clearTimeout(owner.deadlines?.get(id)); owner.deadlines?.delete(id);
      }
    }
    if (event.kind === 'session-error') { owner.active.delete(id); clearTimeout(owner.deadlines?.get(id)); owner.deadlines?.delete(id); owner.store.db.prepare("UPDATE sessions SET status='interrupted' WHERE id=?").run(id); }
    this.emit(owner, event);
  }
  connection() { return this.models.connection(); }
  parse(owner, file, allowOcr = false) {
    if (owner.parsing.has(file.id) || file.status === 'ready') return;
    owner.parsing.add(file.id);
    owner.store.db.prepare("UPDATE files SET status='parsing',error=NULL WHERE id=?").run(file.id);
    const task = (async () => {
      try {
        await this.check(owner); owner.store.session(file.session_id);
        const text = await this.parser(owner.store.path(file.id), file.name, allowOcr);
        await this.check(owner); owner.store.session(file.session_id);
        owner.store.db.prepare("UPDATE files SET text=?,status='ready',error=NULL WHERE id=?").run(text, file.id);
      } catch (e) { owner.store.db.prepare("UPDATE files SET status='failed',error=? WHERE id=?").run(e.status === 401 || e.status === 403 ? '权限已失效，解析停止；原件已保留' : '解析失败或超时，请检查格式、OCR配置或拆分文件后重试；原件已保留', file.id); }
      finally { owner.parsing.delete(file.id); this.emit(owner, { kind: 'files-changed', sessionId: file.session_id }); }
    })();
    owner.parseTasks ??= new Set(); owner.parseTasks.add(task); void task.finally(() => owner.parseTasks.delete(task));
  }
  async call(userId, method, args = {}, options = {}) {
    const owner = this.owner(userId, options.authorize); await this.check(owner);
    // Upload and state reads need no Harness process; restart recovery is driven by durable metadata.
    if (method === 'sessions') return owner.store.list(args.filter);
    if (method === 'settings') {
      let canManage = false;
      try { await this.check(owner, 'model-admin'); canManage = true; } catch (e) { if (e.status !== 403) throw e; }
      return { ...this.models.visible(canManage), maxFileBytes: 200 * 1024 ** 2 };
    }
    if (['saveSettings', 'clearSettings', 'testSettings'].includes(method)) {
      await this.check(owner, 'model-admin');
      if (method === 'clearSettings') return this.models.clear();
      let candidate;
      try { candidate = this.models.candidate(args); }
      catch (e) { throw fail(e.message, 400); }
      if (method === 'testSettings') {
        if (this.probes.has(userId) || this.probes.size >= 2) throw fail('已有连通性测试正在进行，请稍后重试', 429);
        this.probes.add(userId);
        try { const result = await probeModel(candidate, options.signal); await this.check(owner, 'model-admin'); return result; }
        finally { this.probes.delete(userId); }
      }
      try { await endpointAddresses(candidate.baseURL); } catch { throw fail('模型地址无法访问或不被允许，请检查Base URL和内部网关配置', 400); }
      await this.check(owner, 'model-admin'); return this.models.save(candidate, userId);
    }
    if (method === 'files') {
      const rows = owner.store.files(args.sessionId);
      for (const file of rows) if (file.status === 'queued') this.parse(owner, owner.store.file(args.sessionId, file.name));
      return rows;
    }
    if (method === 'uploadBegin') return owner.store.beginUpload(args);
    if (method === 'uploadChunk') return owner.store.chunk(args);
    if (method === 'uploadAbort') { const row = owner.store.upload(args.uploadId); if (!row.completed) owner.store.db.prepare('DELETE FROM uploads WHERE id=?').run(row.id); return { cancelled: true }; }
    if (method === 'uploadFinish') { const file = owner.store.finishUpload(args.uploadId); this.parse(owner, file, file.ocr); return { saved: true, id: file.id, status: file.status }; }
    if (method === 'retryParse') { owner.store.requireEditable(args.sessionId); const file = owner.store.file(args.sessionId, args.fileName); this.parse(owner, file, args.allowOcr); return { accepted: true }; }
    if (method === 'downloadChunk') {
      const file = owner.store.file(args.sessionId, args.fileName); const offset = args.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= file.size) throw fail('下载位置无效');
      const handle = await open(owner.store.path(file.id), 'r'); const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, file.size - offset));
      try { const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); await this.check(owner); owner.store.session(args.sessionId); return { base64: buffer.subarray(0, bytesRead).toString('base64'), size: file.size, next: offset + bytesRead }; } finally { await handle.close(); }
    }
    if (method === 'state') {
      owner.store.session(args.id); const saved = owner.store.load(args.id);
      return { id: args.id, events: saved.events, revision: saved.revision, status: owner.active.has(args.id) ? 'running' : owner.store.session(args.id).status, pending: [...owner.pending.values()].filter(item => item.sessionId === args.id) };
    }
    if (method === 'close') return { detached: true }; // Browser close never destroys durable data or cancels a running task.
    const operation = () => this.operation(owner, method, args);
    const pending = owner.serial.then(operation, operation); owner.serial = pending.catch(() => {}); return pending;
  }
  async operation(owner, method, args) {
    await this.check(owner);
    if (method === 'sessionChange') {
      if (owner.active.has(args.id)) throw fail('请先停止任务再修改会话', 409);
      if (['delete', 'archive'].includes(args.action) && owner.runtime && !owner.runtime.closed) await owner.runtime.call('caseCancel', { id: args.id });
      return owner.store.change(args.id, args.action, args.title);
    }
    if (method === 'caseCancel') {
      owner.store.session(args.id); if (owner.runtime && !owner.runtime.closed) await owner.runtime.call('caseCancel', { id: args.id });
      owner.active.delete(args.id); owner.store.db.prepare("UPDATE sessions SET status='idle' WHERE id=?").run(args.id);
      clearTimeout(owner.deadlines?.get(args.id)); owner.deadlines?.delete(args.id);
      for (const [key, item] of owner.pending) if (item.sessionId === args.id) owner.pending.delete(key);
      return { cancelled: true };
    }
    if (method === 'reply') {
      const event = owner.pending.get(args.id); if (!event || event.sessionId !== args.sessionId) throw fail('交互已失效，请刷新会话', 409);
      owner.store.requireEditable(args.sessionId); const result = await this.runtime(owner).call('reply', args); owner.pending.delete(args.id); return result;
    }
    if (!['caseCreate', 'casePrompt'].includes(method)) throw fail('不支持的智慧办案操作');
    if (typeof args.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(args.requestId)) throw fail('缺少幂等请求标识');
    const previous = owner.store.db.prepare('SELECT * FROM requests WHERE id=?').get(args.requestId);
    if (previous) { if (args.id && previous.session_id !== args.id) throw fail('请求标识冲突', 409); owner.store.session(previous.session_id); return JSON.parse(previous.result); }
    const connection = this.connection(); const runtime = this.runtime(owner);
    if (method === 'caseCreate') {
      const id = 'case-' + randomUUID(); owner.creating.add(id);
      try {
        const value = await runtime.call('caseCreate', { id, model: connection.model }, { connection });
        owner.store.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(args.requestId, value.id, JSON.stringify(value)); return value;
      } finally { owner.creating.delete(id); }
    }
    owner.store.requireEditable(args.id);
    if (owner.active.has(args.id)) throw fail('此会话正在处理，请等待完成或停止任务', 409);
    if (owner.active.size >= 4) throw fail('每个账号最多同时运行4个办案任务', 429);
    if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 100000) throw fail('请输入有效办案需求（最多10万字符）');
    if (owner.store.load(args.id).revision !== args.revision) throw fail('会话已在其他页面更新，请重新打开后发送', 409);
    if (!connection.apiKey) throw fail('管理员尚未配置智慧办案模型，请联系管理员在“AI模型配置”中完成配置', 422);
    if (!Array.isArray(args.refs) || args.refs.length > 12 || args.refs.some(ref => typeof ref !== 'string' || ref.length > 100)) throw fail('知识库选择无效');
    if (args.refs.length) await this.check(owner, 'knowledge');
    const files = owner.store.files(args.id); if (files.some(file => ['queued', 'parsing'].includes(file.status))) throw fail('请等待材料解析完成后再发送', 409);
    if (files.some(file => file.status === 'failed')) throw fail('有材料解析失败，请重试解析或新建会话后发送，避免遗漏材料', 409);
    await endpointAddresses(modelUrl(connection.baseURL));
    // Recreate from the durable checkpoint so the latest administrator configuration applies.
    await runtime.call('caseCancel', { id: args.id });
    await runtime.call('caseResume', { id: args.id, model: connection.model, refs: args.refs }, { connection });
    const value = { accepted: true, id: args.id };
    owner.active.add(args.id); owner.store.db.prepare("UPDATE sessions SET status='running',model=?,preset=? WHERE id=?").run(connection.model, 'chengye-legal@2026-11-07', args.id);
    owner.deadlines ??= new Map();
    const deadline = setTimeout(() => {
      void runtime.call('caseCancel', { id: args.id }).catch(() => {}).finally(() => {
        owner.active.delete(args.id); owner.deadlines.delete(args.id);
        owner.store.db.prepare("UPDATE sessions SET status='interrupted' WHERE id=?").run(args.id);
        this.emit(owner, { kind: 'session-error', sessionId: args.id, error: { message: '本次任务超过15分钟，已停止；会话与材料已保留，可继续提问' } });
      });
    }, 15 * 60000); deadline.unref(); owner.deadlines.set(args.id, deadline);
    owner.store.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(args.requestId, args.id, JSON.stringify(value));
    try { await runtime.call('casePrompt', { id: args.id, text: args.text, refs: args.refs }, { connection }); return value; }
    catch (e) { owner.active.delete(args.id); clearTimeout(owner.deadlines?.get(args.id)); owner.deadlines?.delete(args.id); owner.store.db.prepare("UPDATE sessions SET status='interrupted' WHERE id=?").run(args.id); owner.store.db.prepare('DELETE FROM requests WHERE id=?').run(args.requestId); throw e; }
  }
  async events(userId, cursor, signal, authorize) {
    const owner = this.owner(userId, authorize); await this.check(owner);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw fail('无效事件位置');
    const reset = cursor > owner.cursor || (!!owner.queue.length && cursor < owner.queue[0].cursor - 1);
    if (!reset && !owner.queue.some(item => item.cursor > cursor)) await new Promise(resolve => {
      const done = () => { clearTimeout(timer); owner.waiters.delete(done); signal?.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 15000); owner.waiters.add(done); signal?.addEventListener('abort', done, { once: true });
    });
    await this.check(owner); return { events: reset ? [] : owner.queue.filter(item => item.cursor > cursor), cursor: owner.cursor, reset };
  }
  async close() {
    clearInterval(this.janitor);
    for (const owner of this.owners.values()) { for (const timer of owner.deadlines?.values() || []) clearTimeout(timer); for (const wake of owner.waiters) wake(); await owner.runtime?.close(); await Promise.allSettled([...(owner.parseTasks || [])]); owner.store.close(); }
    this.owners.clear(); this.models.close();
  }
}
