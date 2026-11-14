import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { modelUrl } from './model-endpoint.mjs';
import { fail } from './server-workspace.mjs';

/** One deployment/organization configuration. Never promote an individual's former key. */
export class SharedModelSettings {
  constructor(root, key) {
    this.key = key; this.db = new DatabaseSync(join(root, 'model-settings.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS model_settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)');
  }
  connection() {
    const row = this.db.prepare('SELECT value FROM model_settings WHERE id=1').get();
    if (!row) return { baseURL: process.env.CHENGYE_MODEL_BASE_URL || 'https://api.deepseek.com', model: process.env.CHENGYE_MODEL_NAME || 'deepseek-chat', apiKey: process.env.CHENGYE_MODEL_API_KEY || '', source: 'deployment' };
    const value = JSON.parse(row.value);
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.key.iv, 'base64'));
    decipher.setAAD(Buffer.from('chengye-shared-model-v1')); decipher.setAuthTag(Buffer.from(value.key.tag, 'base64'));
    return { baseURL: value.baseURL, model: value.model, apiKey: Buffer.concat([decipher.update(Buffer.from(value.key.data, 'base64')), decipher.final()]).toString(), source: 'administrator' };
  }
  visible(canManage) {
    const value = this.connection();
    return { configured: !!value.apiKey, canManage, ...(canManage ? { baseURL: value.baseURL, model: value.model, source: value.source } : {}) };
  }
  candidate(args) {
    const baseURL = modelUrl(args.baseURL);
    if (typeof args.model !== 'string' || !args.model.trim() || args.model.length > 200 || /[\x00-\x1f]/.test(args.model)) throw fail('请输入有效模型名称');
    if (args.apiKey !== undefined && typeof args.apiKey !== 'string') throw fail('请输入有效API Key');
    const previous = this.connection();
    if (!args.apiKey?.trim() && previous.apiKey && baseURL !== modelUrl(previous.baseURL)) throw fail('更换模型地址时请重新输入API Key');
    const apiKey = args.apiKey?.trim() || previous.apiKey;
    if (!apiKey || apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(apiKey)) throw fail('请输入有效API Key');
    return { baseURL, model: args.model.trim(), apiKey };
  }
  save(value, userId) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('chengye-shared-model-v1'));
    const data = Buffer.concat([cipher.update(value.apiKey), cipher.final()]);
    const stored = { baseURL: value.baseURL, model: value.model, key: { iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') } };
    this.db.prepare('INSERT INTO model_settings VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
      .run(JSON.stringify(stored), userId, new Date().toISOString());
    return this.visible(true);
  }
  clear() { this.db.prepare('DELETE FROM model_settings').run(); return this.visible(true); }
  close() { this.db.close(); }
}
