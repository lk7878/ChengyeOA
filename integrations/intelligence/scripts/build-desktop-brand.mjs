import { build as esbuild } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, '../../third_party/deepseek-harness');
const packageName = '@chengyeoa/harness-desktop-tools';

export async function buildDesktopBrand() {
  await esbuild({ entryPoints: [join(root, 'desktop-plugin/client.jsx')], outfile: join(root, 'desktop-plugin/dist/client.js'),
    bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', external: ['react'], loader: { '.jpg': 'dataurl' },
    banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
    footer: { js: 'return module.exports; } });' } });

  // Native locale namespaces are single-owner. Apply the small welcome-copy
  // overlay during the native build, leaving the imported source tree intact.
  const nativeRequire = createRequire(join(vendor, 'package.json'));
  const { build } = await import(pathToFileURL(nativeRequire.resolve('tsdown')).href);
  const { clientBundle } = await import(pathToFileURL(join(vendor, 'packages/client/tsdown.client.ts')).href);
  const config = clientBundle('@deepseek-ai/dsh-client-ui-conversation', [])({ env: {} })
    .find(item => item.name === '@deepseek-ai/dsh-client-ui-conversation/client');
  let changed = false;
  config.plugins.unshift({ name: 'baiyou-welcome-copy',
    async load(id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/client/skeleton/EmptyHero.tsx')) return null;
      const { readFile } = await import('node:fs/promises');
      let source = await readFile(id, 'utf8');
      for (const [from, to] of [
        ["{t('hero.headline')}", '{"让法律服务更智能"}'],
        ["<span className={css.previewBadge}>{t('hero.preview')}</span>", ''],
      ]) {
        if (source.split(from).length !== 2) throw new Error('原生欢迎页已变化，请审核品牌构建适配');
        source = source.replace(from, to);
      }
      changed = true;
      return source;
    },
  });
  const cwd = process.cwd();
  try {
    process.chdir(join(vendor, 'packages/client/ui-conversation'));
    await build({ ...config, config: false });
    if (!changed) throw new Error('品牌欢迎语构建未应用');
    process.chdir(join(vendor, 'packages/client/ui-layout'));
    const layout = clientBundle('@deepseek-ai/dsh-client-ui-layout', [])({ env: {} })
      .find(item => item.name === '@deepseek-ai/dsh-client-ui-layout/client');
    layout.define['process.env.DSH_CLIENT_TITLE'] = JSON.stringify('百佑办案助手');
    await build({ ...layout, config: false });
  } finally { process.chdir(cwd); }
}
