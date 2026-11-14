import { access, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const packageName = '@chengyeoa/harness-desktop-tools';
const execute = promisify(execFile);

/** Upgrade existing profiles as well as new installs. The plugin path belongs to the desktop build. */
export async function ensureDesktopPlugin({ nodePath, vendorPath, home, pluginPath, env }, run = execute) {
  const profile = join(home, 'harness/profiles/product');
  const source = await realpath(pluginPath);
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (metadata.name !== packageName) throw new Error('桌面知识库组件无效，请重新构建客户端');
  await access(join(source, 'index.mjs'));
  const installed = async () => {
    try {
      const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
      return Boolean(manifest.dependencies?.[packageName]) &&
        await realpath(join(profile, 'node_modules', packageName)) === source;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  if (await installed()) return { repaired: false };
  try {
    await run(nodePath, [join(vendorPath, 'apps/cli/lib/bin.js'), 'plugin', '--profile', 'product', 'add', 'link:' + source.replaceAll('\\', '/')],
      { cwd: home, env, windowsHide: true, maxBuffer: 128 * 1024 });
    if (!await installed()) throw new Error('Plugin link was not installed');
  } catch {
    throw new Error('本地知识库组件准备失败，请重新运行 desktop:setup 后重试');
  }
  return { repaired: true };
}
