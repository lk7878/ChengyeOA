import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 19)) throw new Error('智能适配器需要 Node 22.19+；与 OA 一起运行请选择 Node 22.20 或更高的 22.x');
async function run(command, args, cwd) {
  await new Promise((resolvePromise, reject) => {
    const shellCommand = command === 'pnpm' || command === 'npm';
    const executable = process.platform === 'win32' && shellCommand ? process.env.COMSPEC || 'cmd.exe' : command;
    const parameters = process.platform === 'win32' && shellCommand ? ['/d', '/s', '/c', `${command} ${args.join(' ')}`] : args;
    const child = spawn(executable, parameters, { cwd, windowsHide: true, stdio: 'inherit', env: { ...process.env, CI: 'true', LEFTHOOK: '0' } });
    child.once('error', reject); child.once('close', code => code === 0 ? resolvePromise() : reject(new Error(`${command} failed (${code})`)));
  });
}
if (process.argv.includes('--install')) {
  await run('npm', ['ci', '--ignore-scripts'], root);
  await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], resolve(root, '../../third_party/deepseek-harness'));
}
await run(process.execPath, ['scripts/verify-source.mjs'], root);
if (!process.argv.includes('--skip-vendor')) await run('pnpm', ['run', 'build'], resolve(root, '../../third_party/deepseek-harness'));
await run(process.execPath, ['scripts/build-knowledge-host.mjs'], root);
await run(process.execPath, ['scripts/build-knowledge-view.mjs'], root);
