import './globals';
import { DatabaseSync, openLocalDatabase, closeLocalDatabase } from './sqlite';
import { hostCall, receiveHostMessage } from './host-bridge';
import { decodeKnowledgeFile, extractKnowledgeDocument } from '../../../third_party/deepseek-harness/packages/product/product-knowledge/src/document-import';

let db: DatabaseSync | undefined;
const caseId = (id: string) => { if (!/^case-[a-f0-9-]{36}$/.test(id)) throw new Error('无效案件工作区'); return id; };
const fileName = (name: string) => { if (typeof name !== 'string' || !name.trim() || name.length > 180 || /[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new Error('无效文件名'); return name; };
function transaction<T>(operation: () => T): T {
  db!.exec('BEGIN IMMEDIATE'); try { const result = operation(); db!.exec('COMMIT'); return result; } catch (error) { db!.exec('ROLLBACK'); throw error; }
}
function load(id: string) {
  const row = db!.prepare('SELECT * FROM sessions WHERE id=?').get(caseId(id)) as any;
  return row ? { meta: JSON.parse(row.header), events: JSON.parse(row.events), revision: row.revision } : null;
}
function persistence(method: string, args: any) {
  if (method === 'load') return load(args.id);
  if (method === 'revision') return load(args.id)?.revision ?? null;
  if (method === 'list' || method === 'snapshots') {
    const rows = db!.prepare('SELECT header, revision FROM sessions ORDER BY updated DESC').all() as any[];
    return rows.map(row => method === 'list' ? JSON.parse(row.header) : { header: JSON.parse(row.header), revision: row.revision });
  }
  if (!['materialize', 'append', 'repair'].includes(method)) throw new Error('不支持的会话存储操作');
  const id = caseId(args.meta?.id);
  return transaction(() => {
    const previous = load(id);
    const events = previous?.events ?? [];
    for (const event of args.events ?? []) {
      if (event.seq < events.length && JSON.stringify(events[event.seq]) === JSON.stringify(event)) continue;
      if (event.seq !== events.length) throw new Error('会话顺序不一致，停止执行以保护记录');
      events.push(event);
    }
    const encoded = JSON.stringify(events); if (encoded.length > 24_000_000) throw new Error('当前会话已达到存储上限，请备份并新建会话');
    if (previous && JSON.stringify(previous.meta) !== JSON.stringify(args.meta)) throw new Error('会话身份不一致');
    db!.prepare('INSERT INTO sessions(id,header,events,revision,updated) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET events=excluded.events, revision=excluded.revision, updated=excluded.updated')
      .run(id, JSON.stringify(args.meta), encoded, crypto.randomUUID(), Date.now());
    return { saved: true };
  });
}

async function execute(method: string, args: any = {}) {
  if (method === 'initialize') {
    await openLocalDatabase(args.partition, 'workspace'); db = new DatabaseSync('/workspace.db');
    db.exec('CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, header TEXT NOT NULL, events TEXT NOT NULL, revision TEXT NOT NULL, updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS files(session_id TEXT NOT NULL, name TEXT NOT NULL, raw BLOB NOT NULL, text TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(session_id,name))');
    return { storage: '律师电脑 · 浏览器本地 Harness 工作区' };
  }
  if (!db) throw new Error('本地工作区未打开');
  if (method === 'close') { db.close(); db = undefined; closeLocalDatabase(); return null; }
  if (method === 'persistence') return persistence(args.method, args.args);
  if (method === 'sessions') return persistence('list', {});
  if (method === 'files') return db.prepare('SELECT name, length(raw) AS size, updated FROM files WHERE session_id=? ORDER BY updated DESC').all(caseId(args.sessionId));
  if (method === 'readFile' || method === 'downloadFile') {
    const row = db.prepare('SELECT raw, text FROM files WHERE session_id=? AND name=?').get(caseId(args.sessionId), fileName(args.fileName)) as any;
    if (!row) throw new Error('文件不存在');
    if (method === 'downloadFile') return { base64: Buffer.from(row.raw).toString('base64') };
    const lines = row.text.split('\n'); const start = args.startLine ?? 1; const end = Math.min(args.endLine ?? start + 199, start + 199, lines.length);
    if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end < start) throw new Error('文件行号无效');
    return { fileName: args.fileName, startLine: start, endLine: end, totalLines: lines.length, text: lines.slice(start - 1, end).join('\n').slice(0, 60000) };
  }
  if (method === 'writeDocument' || method === 'importFile') {
    const id = caseId(args.sessionId); const name = fileName(args.fileName); let text: string; let raw: Uint8Array;
    if (!load(id)) throw new Error('请先创建或恢复办案会话');
    if (method === 'writeDocument') {
      if (!/\.(md|txt)$/i.test(name) || typeof args.content !== 'string' || args.content.length > 100000) throw new Error('文书格式或长度无效');
      text = args.content; raw = new TextEncoder().encode(text);
    } else {
      if (db.prepare('SELECT name FROM files WHERE session_id=? AND name=?').get(id, name)) throw new Error('已有同名材料，请重命名后导入，避免覆盖原件');
      if (typeof args.base64 !== 'string' || args.base64.length > 28_000_000) throw new Error('文件超过 20 MB 限制');
      raw = Buffer.from(args.base64, 'base64');
      const ocr = args.allowOcr ? { recognize: (image: Uint8Array, pageNumber: number) => hostCall('ocr', { imageBase64: Buffer.from(image).toString('base64'), pageNumber }), close() {} } : undefined;
      if (/\.(png|jpe?g|webp)$/i.test(name)) {
        if (!ocr) throw new Error('图片识别需要您勾选允许云端 OCR');
        text = (await ocr.recognize(raw, 1)).text;
      } else text = (await extractKnowledgeDocument(decodeKnowledgeFile(name, args.base64), { ocr })).markdown;
    }
    db.prepare('INSERT INTO files VALUES (?,?,?,?,?) ON CONFLICT(session_id,name) DO UPDATE SET raw=excluded.raw,text=excluded.text,updated=excluded.updated')
      .run(id, name, raw, text, Date.now());
    return { fileName: name, saved: true, size: raw.length };
  }
  if (method === 'backup') {
    const sessions = db.prepare('SELECT * FROM sessions').all();
    const files = (db.prepare('SELECT * FROM files').all() as any[]).map(row => ({ ...row, raw: Buffer.from(row.raw).toString('base64') }));
    return { format: 'chengye-workspace-v1', sessions, files };
  }
  if (method === 'restore') {
    const value = args.backup;
    if (value?.format !== 'chengye-workspace-v1' || !Array.isArray(value.sessions) || !Array.isArray(value.files) || value.sessions.length > 10000 || value.files.length > 10000) throw new Error('备份格式无效');
    return transaction(() => {
      for (const row of value.sessions) {
        if (typeof row.header !== 'string' || row.header.length > 100000 || typeof row.events !== 'string' || row.events.length > 24_000_000) throw new Error('备份会话超出大小限制');
        const id = caseId(row.id); const header = JSON.parse(row.header); const events = JSON.parse(row.events);
        if (header.id !== id || !Array.isArray(events) || events.some((event: any, index: number) => event.seq !== index) || load(id)) throw new Error('备份会话无效或与已有会话重复，未覆盖任何资料');
        db!.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(id, row.header, row.events, crypto.randomUUID(), Date.now());
      }
      for (const row of value.files) {
        const id = caseId(row.session_id); const name = fileName(row.name);
        if (!load(id) || typeof row.raw !== 'string' || row.raw.length > 28_000_000 || typeof row.text !== 'string' || row.text.length > 2_000_000) throw new Error('备份文件无效');
        db!.prepare('INSERT INTO files VALUES (?,?,?,?,?)').run(id, name, Buffer.from(row.raw, 'base64'), row.text, Date.now());
      }
      return { restored: true };
    });
  }
  throw new Error('不支持的工作区操作');
}
let serial = Promise.resolve();
self.onmessage = ({ data }) => {
  if (receiveHostMessage(data)) return;
  if (data.kind !== 'request') return;
  serial = serial.then(async () => {
    try { self.postMessage({ kind: 'result', id: data.id, result: await execute(data.method, data.args), done: true }); }
    catch (error) { self.postMessage({ kind: 'result', id: data.id, error: { message: error instanceof Error ? error.message : String(error) }, done: true }); }
  });
};
