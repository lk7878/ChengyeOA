import { Controller } from 'egg';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { AuthorizationService } from '../application/authorization/authorization-service';
import { AuthorizationContextLoader } from '../application/authorization/authorization-context-loader';
import { createAuthenticationService } from '../application/auth/authentication-factory';

type Service = {
  desktopKnowledge(userId: string, body: unknown, options?: unknown): Promise<unknown>;
  knowledge(admin: boolean, method: string, args?: unknown, options?: unknown): Promise<unknown>;
  caseCall(userId: string, clientId: string, method: string, args: unknown, options?: unknown): Promise<unknown>;
  events(userId: string, clientId: string, cursor: number, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
};
const services = new WeakMap<object, Promise<Service>>();
const loadModule = new Function('url', 'return import(url)') as (url: string) => Promise<{ IntelligenceService: new (root: string) => Service }>;

export function intelligencePaths(baseDir: string) {
  const root = [resolve(baseDir, '../../../..'), resolve(baseDir, '../../../../..')]
    .find(candidate => existsSync(resolve(candidate, 'integrations/intelligence/cloud/service.mjs')));
  if (!root) throw Object.assign(new Error('智能模块尚未部署，请联系管理员完成独立项目构建'), { status: 503 });
  return { moduleUrl: pathToFileURL(resolve(root, 'integrations/intelligence/cloud/service.mjs')).href,
    dataRoot: resolve(root, 'LayerManage/law-firm-system/var/intelligence') };
}

export default class IntelligenceController extends Controller {
  private intelligenceService() {
    let pending = services.get(this.app);
    if (!pending) {
      const paths = intelligencePaths(this.app.baseDir);
      pending = loadModule(paths.moduleUrl)
        .then(module => new module.IntelligenceService(process.env.CHENGYE_INTELLIGENCE_DATA_DIR || paths.dataRoot));
      services.set(this.app, pending);
      this.app.beforeClose(async () => { await (await pending!).close(); });
    }
    return pending;
  }
  private require(feature: 'knowledge' | 'case') {
    new AuthorizationService().requireAction(this.ctx.state.authorization, feature === 'knowledge' ? 'menu.knowledge' : 'menu.smart_case');
  }
  private async input() {
    if (!this.ctx.is('application/octet-stream')) return this.ctx.request.body;
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of this.ctx.req) {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) this.ctx.throw(413, '资料超出上传限制');
      chunks.push(Buffer.from(chunk));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { this.ctx.throw(400, '请求格式无效'); }
  }
  private signal() {
    const abort = new AbortController(); this.ctx.res.once('close', () => abort.abort()); return abort.signal;
  }
  private async answer(operation: (service: Service, signal: AbortSignal, frame: (value: unknown) => void) => Promise<unknown>) {
    this.ctx.set('Cache-Control', 'no-store');
    const frames: unknown[] = [];
    // Buffer a single bounded operation's frames; the separate case event feed
    // carries interactive checkpoints, questions and approvals without blocking.
    const value = await operation(await this.intelligenceService(), this.signal(), frame => {
      if (frames.length >= 50000) this.ctx.throw(413, '模型返回内容过大'); frames.push(frame);
    });
    this.ctx.body = { code: 200, message: 'success', data: { value, frames } };
  }
  async knowledge() {
    this.require('knowledge'); const body = await this.input();
    if (!body || typeof body.method !== 'string') this.ctx.throw(400, '缺少知识库操作');
    const context = this.ctx.state.authorization;
    await this.answer((service, signal, onFrame) => service.knowledge(context.isSystemSuperAdmin || context.isSystemAdmin, body.method, body.args, { signal, onFrame }));
  }
  async desktopKnowledge() {
    this.require('case'); this.require('knowledge');
    const body = await this.input();
    await this.answer(async (service, signal) => {
      const value = await service.desktopKnowledge(this.ctx.state.user.userId, body, { signal });
      // Long retrievals must not deliver evidence after session/role revocation.
      const user = await createAuthenticationService(this.ctx).authenticate(this.ctx.get('authorization').split(' ')[1]);
      const context = await new AuthorizationContextLoader(this.ctx.prisma).load(user.userId);
      const authorization = new AuthorizationService();
      authorization.requireAction(context, 'menu.smart_case'); authorization.requireAction(context, 'menu.knowledge');
      signal.throwIfAborted();
      return value;
    });
  }
  async caseOperation() {
    this.require('case'); const body = await this.input();
    if (!body || typeof body.method !== 'string' || typeof body.clientId !== 'string') this.ctx.throw(400, '缺少办案操作');
    await this.answer((service, signal, onFrame) => service.caseCall(this.ctx.state.user.userId, body.clientId, body.method, body.args, { signal, onFrame }));
  }
  async events() {
    this.require('case'); const body = await this.input();
    if (!body || typeof body.clientId !== 'string') this.ctx.throw(400, '缺少工作区标识');
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = { code: 200, message: 'success', data: await (await this.intelligenceService()).events(this.ctx.state.user.userId, body.clientId, body.cursor ?? 0, this.signal()) };
  }
}
