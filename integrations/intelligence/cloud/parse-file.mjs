import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanEnvironment } from './runtime.mjs';

let active = 0; const waiting = [];
export async function parseFile(path, name, allowOcr, signal) {
  if (active >= 2) await new Promise(resolve => waiting.push(resolve));
  active++;
  try {
    signal?.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const child = fork(fileURLToPath(new URL('./parse-worker.mjs', import.meta.url)), [], { execArgv: ['--max-old-space-size=512', '--import', new URL('./preload.mjs', import.meta.url).href],
        env: cleanEnvironment('', 'parser'), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      const stop = () => child.kill('SIGKILL'); const timer = setTimeout(stop, 180000); signal?.addEventListener('abort', stop, { once: true });
      let result;
      child.once('message', value => { result = value; });
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); result?.text ? resolve(result.text) : reject(new Error(result?.error || '解析中断或超时，原件已保存，可重试')); });
      child.send({ path, name, allowOcr });
    });
  } finally { active--; waiting.shift()?.(); }
}
