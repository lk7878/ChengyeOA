import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { gzipSync as gzip, Gunzip } from 'fflate';

export { Buffer };
export const randomUUID = () => globalThis.crypto.randomUUID();
export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Unsupported knowledge digest: ${algorithm}`);
  const hash = sha256.create();
  const api = {
    update(value: string | Uint8Array) { hash.update(typeof value === 'string' ? new TextEncoder().encode(value) : value); return api; },
    digest(encoding?: string) { const result = Buffer.from(hash.digest()); return encoding === 'hex' ? result.toString('hex') : result; },
  };
  return api;
}
export function gzipSync(value: string | Uint8Array) {
  return Buffer.from(gzip(typeof value === 'string' ? new TextEncoder().encode(value) : value));
}
export function gunzipSync(value: Uint8Array, options: { maxOutputLength?: number } = {}) {
  const limit = options.maxOutputLength ?? 256 * 1024 * 1024;
  const parts: Uint8Array[] = []; let length = 0;
  const decoder = new Gunzip(chunk => {
    length += chunk.byteLength;
    if (length > limit) throw new Error('备份解压后的大小超出限制');
    parts.push(chunk);
  });
  for (let i = 0; i < value.length; i += 4096) decoder.push(value.subarray(i, i + 4096), i + 4096 >= value.length);
  return Buffer.concat(parts, length);
}

// The Store reserves its single database path with fs. Actual file ownership and
// durability belong to sqlite.ts/OPFS; no user directory is emulated or uploaded.
const reserved = new Set<string>();
export function mkdirSync() {}
export function openSync(path: string, mode: string) {
  if (mode !== 'wx') throw new Error('Unsupported knowledge file operation');
  if (reserved.has(path)) throw Object.assign(new Error('Database already opened'), { code: 'EEXIST' });
  reserved.add(path); return 1;
}
export function closeSync() {}
export function dshHomePath(...segments: string[]) { return '/' + segments.join('/'); }
export function fileURLToPath(url: URL) { return url.pathname; }
