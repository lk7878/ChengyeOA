import { resolve, relative } from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import { browserBuild, root, vendor } from './browser-build.mjs';
const outdir = resolve(root, '../../LayerManage/law-firm-system/apps/web/public/intelligence');
const publicRoot = resolve(root, '../../LayerManage/law-firm-system/apps/web/public');
if (relative(publicRoot, outdir) !== 'intelligence') throw new Error('Refusing to clean outside generated intelligence assets');
await rm(outdir, { recursive: true, force: true });
const worker = await browserBuild('browser/workspace-worker.ts', outdir, 'workspace-worker');
const pdf = await browserBuild('browser/pdf-main.ts', outdir, 'pdf-main');
const view = await browserBuild('knowledge-view/index.tsx', outdir, 'knowledge-view', {
  alias: { '@deepseek-ai/dsh-client-ui-primitives': resolve(vendor, 'packages/client/ui-primitives/src/markdown/MarkdownText.tsx') },
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
});
const caseView = await browserBuild('case-view/index.tsx', outdir, 'case-view', { loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' } });
const inputs = [...Object.keys(worker.metafile.inputs), ...Object.keys(view.metafile.inputs), ...Object.keys(caseView.metafile.inputs), ...Object.keys(pdf.metafile.inputs)];
if (inputs.some(path => /client-web|ui-workspace|ui-agent-preset/.test(path))) throw new Error('Standalone knowledge build pulled in the full Harness shell');
await writeFile(resolve(outdir, 'build-manifest.json'), JSON.stringify({ inputs, react: '18.3.1', knowledge: 'cloud-native-sqlite', caseWorkspace: 'browser-sqlite-opfs' }, null, 2));
console.log('Built isolated knowledge view and local worker');
