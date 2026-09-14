import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { access, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dataDirectory, hostEnvironment, readConfig, validateOaUrl } from '../desktop/config.mjs';
import { buildDesktopBrand } from './build-desktop-brand.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, '../../third_party/deepseek-harness');
const out = join(root, 'dist/desktop');
const command = process.argv[2];
const home = dataDirectory();
const cli = join(vendor, 'apps/cli/lib/bin.js');

async function run(executable, args, options = {}) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`命令退出码 ${code}`)));
  });
}

if (command === 'build') {
  await buildDesktopBrand();
  await mkdir(out, { recursive: true });
  await build({ entryPoints: [join(root, 'desktop/main.mjs')], outfile: join(out, 'main.mjs'), bundle: true,
    platform: 'node', target: 'node22', format: 'esm', external: ['electron'] });
  await copyFile(join(root, 'desktop/preload.cjs'), join(out, 'preload.cjs'));
  // Keep the preset and its relative skill resources together in the build.
  await cp(join(root, 'desktop-plugin/presets'), join(out, 'presets'), { recursive: true });
  const patch = await readFile(join(root, 'desktop/product.patch.yml'), 'utf8');
  await writeFile(join(out, 'product.patch.yml'), patch
    .replace('__LAWYER_PRESET_ROOT__', JSON.stringify(join(out, 'presets').replaceAll('\\', '/')))
    .replace('__LAWYER_REGISTRY__', JSON.stringify(pathToFileURL(join(root, 'desktop/lawyer-presets.mjs')).href)));
  await copyFile(join(root, 'desktop-plugin/assets/baiyou-logo.jpg'), join(out, 'baiyou-logo.jpg'));
  await writeFile(join(out, 'package.json'), JSON.stringify({ name: 'chengye-desktop', productName: '律师智慧管理系统', version: '1.3.0-dev.2', private: true, type: 'module', main: 'main.mjs' }, null, 2));
  console.log('桌面构建完成：' + out);
} else if (command === 'setup') {
  const flag = process.argv.indexOf('--oa-url');
  const oaUrl = validateOaUrl(flag >= 0 ? process.argv[flag + 1] : 'http://localhost:3000/');
  await access(cli);
  await access(join(vendor, 'apps/web/dist/index.html'));
  await mkdir(home, { recursive: true });
  const env = hostEnvironment(home);
  const manifest = join(env.DSH_HOME, 'profiles/product/package.json');
  let existing;
  try { existing = JSON.parse(await readFile(manifest, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const expected = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-product-bundle'];
  const bundles = existing?.dsh?.profile?.bundles;
  if (existing && (!Array.isArray(bundles) || bundles.length > expected.length || bundles.some((bundle, index) => bundle !== expected[index]))) {
    throw new Error('已有 product 配置与正式 Profile 不一致，保留原配置，请使用新的 CHENGYE_DESKTOP_HOME');
  }
  // Re-link on setup after moving the checkout; preserve the user's profile patch and settings.
  for (const bundle of ['packages/bundle/web-app', 'packages/product/product-bundle']) {
    await run(process.execPath, [cli, 'plugin', '--profile', 'product', 'add', 'link:' + join(vendor, bundle).replaceAll('\\', '/')], { cwd: home, env });
  }
  await run(process.execPath, [cli, 'plugin', '--profile', 'product', 'add', 'link:' + join(root, 'desktop-plugin').replaceAll('\\', '/')], { cwd: home, env });
  await writeFile(join(home, 'desktop.json'), JSON.stringify({ schema: 1, oaUrl, nodePath: process.execPath, vendorPath: vendor }, null, 2), { mode: 0o600 });
  console.log('桌面开发配置已准备：' + home);
} else if (command === 'start') {
  await readConfig(home);
  await access(join(out, 'main.mjs'));
  const require = createRequire(join(vendor, 'apps/product-desktop/package.json'));
  const electron = require('electron');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  // Electron is the interactive application; hiding this process can hide its first window on Windows.
  await run(electron, [out], { cwd: root, env, windowsHide: false });
} else {
  throw new Error('用法：node scripts/desktop.mjs build | setup [--oa-url https://OA地址/] | start');
}
