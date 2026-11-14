import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, writeSync, readFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const CHUNK_BYTES = 4 * 1024 * 1024;
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function caseId(id) { if (typeof id !== 'string' || !/^case-[a-f0-9-]{36}$/.test(id)) throw fail('无效的会话标识'); return id; }
export function fileName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 180 || /[\\/\x00-\x1f]/.test(name) || /[. ]$/.test(name) || !/\.(md|txt|pdf|docx|xlsx|html|png|jpe?g|webp)$/i.test(name)) throw fail('文件名或格式不支持');
  return name;
}
export function credentialKey(root) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, 'credentials.key');
  try { const fd = openSync(path, 'wx', 0o600); try { writeSync(fd, randomBytes(32)); } finally { closeSync(fd); } } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const key = readFileSync(path); if (key.length !== 32) throw fail('模型凭据密钥不可用，请联系管理员', 503); return key;
}

/** Account directory is selected exclusively by authenticated OA user ID. Never by a browser path. */
export class ServerWorkspace {
  constructor(root, key) {
    mkdirSync(root, { recursive: true, mode: 0o700 }); this.root = root; this.key = key;
    this.db = new DatabaseSync(join(root, 'workspace.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, header TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]', revision TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'idle', updated INTEGER NOT NULL, model TEXT, preset TEXT);
      CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), name TEXT NOT NULL, size INTEGER NOT NULL,
        text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, error TEXT, generated INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, UNIQUE(session_id,name));
      CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), name TEXT NOT NULL, size INTEGER NOT NULL, received INTEGER NOT NULL DEFAULT 0, ocr INTEGER NOT NULL, completed TEXT, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks(upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE, offset INTEGER NOT NULL, raw BLOB NOT NULL, PRIMARY KEY(upload_id,offset));
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, result TEXT NOT NULL);`);
    this.db.prepare("UPDATE sessions SET status='interrupted' WHERE status NOT IN ('idle','interrupted')").run();
    this.db.prepare("UPDATE files SET status='queued' WHERE status='parsing'").run();
    this.db.prepare('DELETE FROM uploads WHERE completed IS NULL AND updated<?').run(Date.now() - 24 * 3600000);
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  session(id, includeDeleted = false) {
    const value = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(caseId(id));
    if (!value || (value.deleted && !includeDeleted)) throw fail('会话不存在或已删除', 404); return value;
  }
  requireEditable(id) { const row = this.session(id); if (row.archived) throw fail('请先取消归档再继续操作', 409); return row; }
  list(filter = 'active') {
    if (!['active', 'archived', 'deleted'].includes(filter)) throw fail('会话筛选无效');
    return this.db.prepare('SELECT id,header,title,archived,deleted,status,updated,model,preset FROM sessions WHERE deleted=? AND (?=1 OR archived=?) ORDER BY updated DESC')
      .all(filter === 'deleted' ? 1 : 0, filter === 'deleted' ? 1 : 0, filter === 'archived' ? 1 : 0)
      .map(row => ({ ...JSON.parse(row.header), ...row, header: undefined }));
  }
  change(id, action, title) {
    this.session(id, action === 'restore');
    if (action === 'rename') {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) throw fail('会话名称须为1–100个字符');
      this.db.prepare('UPDATE sessions SET title=?,updated=? WHERE id=?').run(title.trim(), Date.now(), id);
    } else {
      const statements = { archive: 'archived=1', unarchive: 'archived=0', delete: 'deleted=1', restore: 'deleted=0' };
      if (!statements[action]) throw fail('不支持的会话操作');
      this.db.prepare(`UPDATE sessions SET ${statements[action]},updated=? WHERE id=?`).run(Date.now(), id);
    }
    return { saved: true };
  }
  load(id) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id=? AND deleted=0').get(caseId(id));
    return row ? { meta: JSON.parse(row.header), events: JSON.parse(row.events), revision: row.revision } : null;
  }
  persistence(method, args = {}) {
    if (method === 'load') return this.load(args.id);
    if (method === 'revision') return this.load(args.id)?.revision ?? null;
    if (method === 'list' || method === 'snapshots') return this.list().map(row => {
      const value = this.load(row.id); return method === 'list' ? value.meta : { header: value.meta, revision: value.revision };
    });
    if (!['materialize', 'append', 'repair'].includes(method)) throw fail('不支持的持久化操作');
    const id = caseId(args.meta?.id);
    return this.transaction(() => {
      const previous = this.load(id); const events = previous?.events ?? [];
      if (previous && JSON.stringify(previous.meta) !== JSON.stringify(args.meta)) throw fail('会话身份不一致', 409);
      for (const event of args.events ?? []) {
        if (event.seq < events.length && JSON.stringify(events[event.seq]) === JSON.stringify(event)) continue;
        if (event.seq !== events.length) throw fail('会话顺序冲突，请重新打开会话', 409);
        events.push(event);
      }
      const encoded = JSON.stringify(events); if (encoded.length > 48_000_000) throw fail('会话过长，请新建会话', 413);
      const first = events.find(event => event.type === 'user/message' && event.data.source?.kind === 'user');
      const title = first?.data.content?.find(block => block.type === 'text')?.text?.slice(0, 40) || '新会话';
      this.db.prepare(`INSERT INTO sessions(id,header,events,revision,title,updated) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET events=excluded.events,revision=excluded.revision,updated=excluded.updated,
        title=CASE WHEN sessions.title='新会话' THEN excluded.title ELSE sessions.title END`)
        .run(id, JSON.stringify(args.meta), encoded, randomUUID(), title, Date.now());
      return { saved: true };
    });
  }
  files(id) { this.session(id); return this.db.prepare('SELECT id,name,size,status,error,generated,updated FROM files WHERE session_id=? ORDER BY updated DESC').all(id); }
  file(id, name) { this.session(id); const row = this.db.prepare('SELECT * FROM files WHERE session_id=? AND name=?').get(id, fileName(name)); if (!row) throw fail('文件不存在', 404); return row; }
  read(id, name, start = 1, end) {
    const row = this.file(id, name); if (row.status !== 'ready') throw fail(row.error || '材料尚未完成解析', 409);
    const lines = row.text.split('\n'); end = Math.min(end ?? start + 199, start + 199, lines.length);
    if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end < start) throw fail('无效行号');
    return { fileName: name, startLine: start, endLine: end, totalLines: lines.length, text: lines.slice(start - 1, end).join('\n').slice(0, 60000) };
  }
  path(id) { if (!/^[a-f0-9-]{36}$/.test(id)) throw fail('无效文件标识'); return join(this.root, id + '.bin'); }
  reserve(size) {
    const used = this.db.prepare('SELECT COALESCE(SUM(size),0) AS size FROM files').get().size;
    const pending = this.db.prepare('SELECT COALESCE(SUM(size),0) AS size FROM uploads WHERE completed IS NULL').get().size;
    if (used + pending + size > 2 * 1024 ** 3) throw fail('个人智慧办案空间已达到2GB容量，请联系管理员处理', 413);
  }
  beginUpload(args) {
    this.db.prepare('DELETE FROM uploads WHERE completed IS NULL AND updated<?').run(Date.now() - 24 * 3600000);
    this.requireEditable(args.sessionId); const name = fileName(args.fileName);
    if (!Number.isSafeInteger(args.size) || args.size <= 0 || args.size > MAX_FILE_BYTES) throw fail('单个文件须大于0且不超过200MB', 413);
    if (!/^[a-f0-9-]{36}$/.test(args.uploadId)) throw fail('无效上传标识');
    const existing = this.db.prepare('SELECT * FROM uploads WHERE id=?').get(args.uploadId);
    if (existing) { if (existing.session_id !== args.sessionId || existing.name !== name || existing.size !== args.size) throw fail('上传标识冲突', 409); return { id: existing.id, received: existing.received }; }
    if (this.db.prepare('SELECT id FROM files WHERE session_id=? AND name=?').get(args.sessionId, name)) throw fail('已有同名材料，请重命名后上传', 409);
    this.reserve(args.size);
    this.db.prepare('INSERT INTO uploads(id,session_id,name,size,ocr,updated) VALUES(?,?,?,?,?,?)').run(args.uploadId, args.sessionId, name, args.size, args.allowOcr ? 1 : 0, Date.now());
    return { id: args.uploadId, received: 0 };
  }
  upload(id) { const row = this.db.prepare('SELECT * FROM uploads WHERE id=?').get(id); if (!row) throw fail('上传不存在或已过期', 404); this.requireEditable(row.session_id); return row; }
  chunk(args) {
    const row = this.upload(args.uploadId);
    if (typeof args.base64 !== 'string' || args.base64.length > Math.ceil(CHUNK_BYTES / 3) * 4) throw fail('分片超过4MB', 413);
    const bytes = Buffer.from(args.base64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== args.base64 || !Number.isSafeInteger(args.offset) || args.offset < 0 || args.offset + bytes.length > row.size) throw fail('分片无效');
    const old = this.db.prepare('SELECT raw FROM chunks WHERE upload_id=? AND offset=?').get(row.id, args.offset);
    if (old && Buffer.from(old.raw).equals(bytes)) return { received: row.received };
    if (row.completed || args.offset !== row.received) throw fail('分片位置冲突，请重新上传', 409);
    this.transaction(() => {
      this.db.prepare('INSERT INTO chunks VALUES(?,?,?)').run(row.id, args.offset, bytes);
      this.db.prepare('UPDATE uploads SET received=received+?,updated=? WHERE id=?').run(bytes.length, Date.now(), row.id);
    }); return { received: row.received + bytes.length };
  }
  finishUpload(id) {
    const row = this.upload(id); if (row.completed) return this.file(row.session_id, row.name);
    if (row.received !== row.size) throw fail('文件尚未上传完整', 409);
    const fileId = randomUUID(); const fd = openSync(this.path(fileId), 'wx', 0o600);
    try { for (const chunk of this.db.prepare('SELECT raw FROM chunks WHERE upload_id=? ORDER BY offset').iterate(id)) writeSync(fd, chunk.raw); } finally { closeSync(fd); }
    try { this.transaction(() => {
      this.db.prepare("INSERT INTO files(id,session_id,name,size,status,updated) VALUES(?,?,?,?,'queued',?)").run(fileId, row.session_id, row.name, row.size, Date.now());
      this.db.prepare('UPDATE uploads SET completed=? WHERE id=?').run(fileId, id);
      this.db.prepare('DELETE FROM chunks WHERE upload_id=?').run(id);
    }); } catch (e) { unlinkSync(this.path(fileId)); throw fail('文件保存冲突，请检查是否已有同名材料', 409); }
    return { ...this.file(row.session_id, row.name), ocr: !!row.ocr };
  }
  writeDocument(id, name, content) {
    this.requireEditable(id); fileName(name);
    if (!/\.(md|txt)$/i.test(name) || typeof content !== 'string' || content.length > 100000) throw fail('文书格式或长度无效');
    if (this.db.prepare('SELECT id FROM files WHERE session_id=? AND name=?').get(id, name)) throw fail('已有同名文件，请另存新名称以保留原件', 409);
    const raw = Buffer.from(content); this.reserve(raw.length); const fileId = randomUUID();
    const fd = openSync(this.path(fileId), 'wx', 0o600); try { writeSync(fd, raw); } finally { closeSync(fd); }
    this.db.prepare("INSERT INTO files(id,session_id,name,size,text,status,generated,updated) VALUES(?,?,?,?,?,'ready',1,?)").run(fileId, id, name, raw.length, content, Date.now());
    return { saved: true, fileName: name };
  }
  settings(secret = false) {
    const row = this.db.prepare('SELECT value FROM settings WHERE id=1').get(); if (!row) return { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', configured: false };
    const value = JSON.parse(row.value); const { key: encrypted, ...visible } = value;
    if (!secret) return { ...visible, configured: !!encrypted };
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAAD(Buffer.from(basename(this.root))); decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    return { ...visible, apiKey: Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'base64')), decipher.final()]).toString() };
  }
  saveSettings({ baseURL, model, apiKey }) {
    if (typeof model !== 'string' || !model.trim() || model.length > 200 || /[\x00-\x1f]/.test(model)) throw fail('请输入有效模型名称');
    const previous = this.settings();
    if (!apiKey && previous.configured && baseURL !== previous.baseURL) throw fail('更换模型地址时请重新输入API Key');
    const value = apiKey || (previous.configured ? this.settings(true).apiKey : '');
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\r\n]/.test(value)) throw fail('请输入有效API Key');
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(Buffer.from(basename(this.root)));
    const data = Buffer.concat([cipher.update(value.trim()), cipher.final()]);
    const settings = { baseURL, model: model.trim(), key: { iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') } };
    this.db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(settings)); return this.settings();
  }
  close() { this.db.close(); }
}
