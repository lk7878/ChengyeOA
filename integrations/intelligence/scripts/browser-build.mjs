import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { cp, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const vendor = resolve(root, '../../third_party/deepseek-harness');
const knowledge = resolve(vendor, 'packages/product/product-knowledge');
const requireNative = createRequire(resolve(knowledge, 'package.json'));

export async function browserBuild(entry, outdir, name, extra = {}) {
  const result = await build({ entryPoints: { [name]: resolve(root, entry) }, outdir, bundle: true,
    format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      'node:crypto': resolve(root, 'browser/node-compat.ts'), 'node:zlib': resolve(root, 'browser/node-compat.ts'),
      'node:fs': resolve(root, 'browser/node-compat.ts'), 'node:path': resolve(root, 'node_modules/path-browserify/index.js'),
      'node:sqlite': resolve(root, 'browser/sqlite.ts'),
      '@sqlite.org/sqlite-wasm': resolve(root, 'node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs'),
      'pdf-parse': resolve(root, 'browser/pdf.ts'), 'pdfjs-dist': resolve(root, 'node_modules/pdfjs-dist/build/pdf.mjs'),
      'mammoth': resolve(root, 'browser/mammoth.ts'),
      'exceljs': requireNative.resolve('exceljs/dist/exceljs.min.js'),
      '@deepseek-ai/cordis': resolve(vendor, 'vendor/cordis/src/index.ts'),
      '@deepseek-ai/dsh-session': resolve(vendor, 'packages/core/session/src/types.ts'),
      'react': resolve(root, 'node_modules/react'), 'react-dom': resolve(root, 'node_modules/react-dom'),
      ...(extra.alias ?? {}),
    }, ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'alias')),
  });
  await mkdir(resolve(outdir, 'sqlite'), { recursive: true });
  await cp(resolve(root, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'), resolve(outdir, 'sqlite/sqlite3.wasm'));
  await cp(resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), resolve(outdir, 'pdf.worker.min.mjs'));
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) await cp(resolve(root, 'node_modules/pdfjs-dist', folder), resolve(outdir, 'pdf', folder), { recursive: true });
  return result;
}
