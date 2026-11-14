import { resolve, relative } from 'node:path';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { browserBuild, root, vendor } from './browser-build.mjs';
const outdir = resolve(root, '../../LayerManage/law-firm-system/apps/web/public/intelligence');
const publicRoot = resolve(root, '../../LayerManage/law-firm-system/apps/web/public');
if (relative(publicRoot, outdir) !== 'intelligence') throw new Error('Refusing to clean outside generated intelligence assets');
await rm(outdir, { recursive: true, force: true });
const view = await browserBuild('knowledge-view/index.tsx', outdir, 'knowledge-view', {
  alias: { '@deepseek-ai/dsh-client-ui-primitives': resolve(vendor, 'packages/client/ui-primitives/src/markdown/MarkdownText.tsx') },
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
});
const nativeRequire = createRequire(resolve(vendor, 'packages/client/ui-conversation/package.json'));
const caseView = await browserBuild('case-view/index.tsx', outdir, 'case-view', {
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.DSH_CLIENT_TITLE': '"律师智慧管理系统 V1.2.1"',
    'process.env.DSH_CLIENT_VERSION': 'undefined', 'process.env.DSH_CLIENT_COMMIT_HASH': 'undefined', 'process.env.DSH_CLIENT_GIT_DIRTY': '"false"' },
  alias: { '@deepseek-ai/dsh-client-ui-primitives': resolve(vendor, 'packages/client/ui-primitives/src/index.ts'),
    lexical: nativeRequire.resolve('lexical'), '@lexical/plain-text': nativeRequire.resolve('@lexical/plain-text'), '@lexical/history': nativeRequire.resolve('@lexical/history') },
  plugins: [{ name: 'native-shadow-theme', setup(build) {
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: resolve(root, 'case-view/portal.ts') }));
    build.onLoad({ filter: /ui-theme[\\/]src[\\/]styles[\\/].*\.css$/ }, async args => ({
      contents: (await readFile(args.path, 'utf8')).replace(/:root|\bbody\b/g, ':host'), loader: 'css', resolveDir: resolve(args.path, '..'),
    }));
  } }],
});
const inputs = [...Object.keys(view.metafile.inputs), ...Object.keys(caseView.metafile.inputs)];
if (Object.keys(view.metafile.inputs).some(path => /client-web|ui-workspace|ui-agent-preset|ui-conversation/.test(path))) throw new Error('Standalone knowledge build pulled in the Harness case shell');
for (const component of ['AppFrame.tsx', 'SidebarRoot.tsx', 'ConversationRoot.tsx', 'InputBar.tsx', 'AssistantMarkdown.tsx']) {
  if (!Object.keys(caseView.metafile.inputs).some(path => path.endsWith(component))) throw new Error('Case build missing native UI: ' + component);
}
await writeFile(resolve(outdir, 'build-manifest.json'), JSON.stringify({ inputs, react: '18.3.1', knowledge: 'cloud-native-sqlite', caseWorkspace: 'server-account-sqlite', legacyWorker: 'removed' }, null, 2));
console.log('Built knowledge and server case views; obsolete smart-case worker removed');
