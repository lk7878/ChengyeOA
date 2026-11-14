import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { browserBuild, root } from './browser-build.mjs';
const outdir = resolve(root, '../../LayerManage/law-firm-system/apps/web/public/intelligence/probe');
const result = await browserBuild('probes/native-store-worker.ts', outdir, 'native-store-worker');
await writeFile(resolve(outdir, 'metafile.json'), JSON.stringify(result.metafile));
console.log('Built native KnowledgeBaseStore browser verification');
