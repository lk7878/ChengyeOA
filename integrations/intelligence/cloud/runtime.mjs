import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, access, open, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, '../../third_party/deepseek-harness');
const cli = join(vendor, 'apps/cli/lib/bin.js');
const profileName = 'chengye-cloud';

export function cleanEnvironment(home, purpose) {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'NODE_EXTRA_CA_CERTS']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'DISABLED', DSH_PERMISSION_MODE: 'workspace-write',
    CHENGYE_RUNTIME_PURPOSE: purpose, CHENGYE_MODEL_ORIGINS: process.env.CHENGYE_MODEL_ORIGINS || '',
    CHENGYE_OCR_PYTHON: process.env.CHENGYE_OCR_PYTHON || '', CHENGYE_OCR_MODEL_CACHE: process.env.CHENGYE_OCR_MODEL_CACHE || '',
    CHENGYE_OCR_DEVICE: process.env.CHENGYE_OCR_DEVICE || 'cpu', PYTHONDONTWRITEBYTECODE: '1', NO_COLOR: '1' };
}

async function runCli(args, workspace, env) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = ''; const collect = value => { tail = (tail + value.toString()).slice(-2000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill(), 180000);
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); if (code === 0) resolvePromise(); else reject(Object.assign(new Error('Harness 初始化失败'), { diagnostic: tail })); });
  });
}

async function prepare(directory, purpose) {
  const home = join(directory, 'home'); const workspace = join(directory, 'workspace');
  await mkdir(home, { recursive: true, mode: 0o700 }); await mkdir(workspace, { recursive: true, mode: 0o700 });
  const env = cleanEnvironment(home, purpose); const profile = join(home, 'profiles', profileName);
  const marker = join(profile, 'chengye-version.json');
  let installed = false; try { installed = JSON.parse(await readFile(marker, 'utf8')).root === root; } catch {}
  if (!installed) {
    for (const path of [join(vendor, 'packages/bundle/sdk-app'), join(root, 'cloud-plugin')]) await runCli(['plugin', '--profile', profileName, 'add', 'link:' + path.replaceAll('\\', '/')], workspace, env);
    await writeFile(marker, JSON.stringify({ version: '1.2.0', root }), { mode: 0o600 });
  }
  const base = await readFile(join(vendor, 'packages/bundle/base/cordis.patch.yml'), 'utf8');
  const disable = [...base.matchAll(/^    - id: (tool-[\w-]+)$/gm)].map(match => ({ id: match[1], disabled: true }));
  const patch = [...disable, { id: 'sdk-jsonrpc-server', disabled: true },
    { id: 'agent-instructions', disabled: true }, { id: 'skill-filesystem', disabled: true }, { id: 'session-title-llm', disabled: true },
    { id: 'credentials', disabled: true }, { id: 'llm-pi-ai', disabled: true }, { id: 'llm-deepseek', disabled: true },
    { insert: [{ id: 'agent-presets', name: '@deepseek-ai/dsh-agent-presets', config: { default: 'chengye-legal', roots: [{ path: join(root, 'presets'), trust: 'system' }], includeShippedRoot: false, includeUserRoot: false } }] }];
  if (purpose !== 'wiki') for (const id of ['session-persistence-jsonl', 'session-query-sqlite', 'session-projection-cache', 'session-log-deepseek', 'spill-local', 'spill-policy', 'attachment-local']) patch.push({ id, disabled: true });
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(patch, null, 2), { mode: 0o600 });
  return { home, workspace, env };
}

async function acquire(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'owner.lock');
  const identity = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      await file.writeFile(identity); await file.close();
      return async () => { if (await readFile(path, 'utf8').catch(() => '') === identity) await unlink(path).catch(() => {}); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const raw = await readFile(path, 'utf8').catch(() => '');
      let pid; try { const owner = JSON.parse(raw); pid = typeof owner === 'number' ? owner : owner.pid; } catch {}
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('智能服务目录锁无效，请联系管理员检查');
      let live = true; try { process.kill(pid, 0); } catch (error) { live = error.code !== 'ESRCH'; }
      if (!Number.isInteger(pid) || pid <= 0 || live) throw Object.assign(new Error('智能数据目录已被占用，请使用单个 OA Worker'), { status: 503 });
      await unlink(path).catch(() => {});
    }
  }
  throw new Error('无法获取智能服务目录锁');
}

export class CloudProcess {
  constructor(directory, purpose, onEvent = () => {}) {
    this.directory = directory; this.purpose = purpose; this.onEvent = onEvent; this.pending = new Map(); this.closed = false;
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = this.launch().catch(async error => { await this.unlock?.(); this.closed = true; throw error; }); return this.starting;
  }
  async launch() {
    await access(cli); this.unlock = await acquire(this.directory); const paths = await prepare(this.directory, this.purpose);
    if (this.closed) throw new Error('智能服务已关闭');
    await new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, ['--import', pathToFileURL(join(root, 'cloud/preload.mjs')).href, cli, '--profile', profileName], { cwd: paths.workspace, env: paths.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
      this.child = child; this.exit = new Promise(resolveExit => child.once('close', resolveExit));
      let ready = false; let tail = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('智能服务启动超时')); }, 60000);
      child.stdout.resume(); child.stderr.on('data', bytes => { tail = (tail + bytes.toString()).slice(-4000); });
      child.once('error', reject);
      child.on('message', value => {
        if (value.kind === 'ready') { clearTimeout(timer); ready = true; resolvePromise(); return; }
        if (value.kind !== 'result') { this.onEvent(value); return; }
        const pending = this.pending.get(value.id); if (!pending) return;
        if ('frame' in value) pending.onFrame?.(value.frame);
        if (value.done) {
          this.pending.delete(value.id); pending.cleanup();
          if (value.error) pending.reject(Object.assign(new Error(value.error.message), { code: value.error.code, status: 422 })); else pending.resolve(value.result);
        }
      });
      child.once('close', () => {
        clearTimeout(timer); this.closed = true;
        void this.unlock?.();
        for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(new Error('智能服务已退出')); } this.pending.clear();
        if (!ready) reject(Object.assign(new Error('智能服务启动失败'), { diagnostic: tail }));
      });
    });
    return this;
  }
  async call(method, args, { connection, signal, onFrame, timeoutMs = 600000 } = {}) {
    await this.start(); signal?.throwIfAborted();
    if (this.closed || !this.child?.connected) throw new Error('智能服务不可用');
    return new Promise((resolvePromise, reject) => {
      const id = randomUUID();
      const abort = () => { this.child?.connected && this.child.send({ kind: 'cancel', id }); cleanup(); this.pending.delete(id); reject(new Error('智能操作已取消或超时')); };
      const timer = setTimeout(abort, timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.pending.set(id, { resolve: resolvePromise, reject, onFrame, cleanup }); signal?.addEventListener('abort', abort, { once: true });
      this.child.send({ kind: 'request', id, method, args, connection });
    });
  }
  async close() {
    this.closed = true;
    if (!this.child) { await this.starting?.catch(() => {}); return; }
    this.child.stdin.end();
    const force = setTimeout(() => this.child.kill(), 5000);
    const terminate = setTimeout(() => this.child.kill('SIGKILL'), 10000);
    await this.exit; clearTimeout(force); clearTimeout(terminate); await this.unlock?.();
  }
}

export const accountKey = userId => createHash('sha256').update(userId).digest('hex');
