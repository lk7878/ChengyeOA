import { randomUUID } from 'node:crypto';
import { boundedReply, knowledgeCall } from './knowledge-contract.mjs';

/** Main-process relay. Identity is metadata, never an OA credential. */
export class KnowledgeBroker {
  constructor(origin, deliver, timeout = 45000) {
    this.origin = origin; this.deliver = deliver; this.timeout = timeout; this.pending = new Map(); this.identity = null;
  }
  setIdentity(identity) {
    const next = typeof identity === 'string' && identity.length > 0 && identity.length <= 160 ? identity : null;
    if (next !== this.identity) { this.invalidate(); this.identity = next; }
  }
  invalidate() {
    this.identity = null;
    for (const id of [...this.pending.keys()]) this.finish(id, { error: 'OA 登录或权限已变化，请重新登录；更换账号请新建办案会话' });
  }
  finish(id, result) {
    const item = this.pending.get(id); if (!item) return;
    this.pending.delete(id); clearTimeout(item.timer);
    this.deliver({ kind: 'cancel', id });
    item.reply({ kind: 'chengye-wiki-reply', id: item.sourceId, ...result });
  }
  request(message, reply, owner) {
    if (message?.kind === 'chengye-wiki-cancel') {
      for (const [id, item] of this.pending) if (item.owner === owner && item.sourceId === message.id) this.finish(id, { error: '知识库查询已取消' });
      return;
    }
    if (message?.kind !== 'chengye-wiki-request' || typeof message.id !== 'string' || message.id.length > 80) return;
    try {
      if (!this.identity) throw new Error('请先在 OA 登录，并取得知识库与智慧办案权限');
      if (message.binding && (message.binding.userId !== this.identity || message.binding.origin !== this.origin)) throw new Error('此办案会话已绑定其他 OA 账号或服务器，请新建会话');
      const call = knowledgeCall(message.method, message.args);
      if (this.pending.size >= 16) throw new Error('知识库查询繁忙，请稍后重试');
      const id = randomUUID();
      this.pending.set(id, { owner, reply, sourceId: message.id, identity: this.identity,
        timer: setTimeout(() => this.finish(id, { error: '知识库查询超时，请检查网络后重试' }), this.timeout) });
      this.deliver({ kind: 'query', id, userId: this.identity, ...call });
    } catch (error) { reply({ kind: 'chengye-wiki-reply', id: message.id, error: error.message }); }
  }
  accept(message) {
    const item = this.pending.get(message?.id); if (!item) return;
    if (item.identity !== this.identity) return this.finish(message.id, { error: 'OA 身份已变化' });
    try {
      if (message.error) {
        const errors = { AUTH: 'OA 登录已过期，请重新登录', PERMISSION: '当前 OA 账号没有知识库与智慧办案所需权限', NETWORK: '无法连接 OA 云端知识库，请检查网络', TIMEOUT: '云端知识库查询超时，请稍后重试', INVALID: '知识库或文档不可用，或查询范围无效、过大，请重新列出资料并缩小范围', UNAVAILABLE: '云端知识库暂时不可用，请联系管理员检查服务' };
        throw new Error(Object.hasOwn(errors, message.error) ? errors[message.error] : '知识库查询失败，请检查 OA 登录、权限或网络后重试');
      }
      if (message.value?.userId !== item.identity) throw new Error('知识库返回身份不匹配');
      this.finish(message.id, { value: boundedReply(message.value.result), binding: { userId: item.identity, origin: this.origin } });
    } catch (error) { this.finish(message.id, { error: error.message }); }
  }
  detach(owner) { for (const [id, item] of this.pending) if (item.owner === owner) this.finish(id, { error: '本地助手连接已关闭' }); }
}
