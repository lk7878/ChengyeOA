import { build } from 'esbuild';
import { createRequire, isBuiltin } from 'node:module';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'dist/knowledge-host.mjs');
await build({ entryPoints: [resolve(root, '../../third_party/deepseek-harness/packages/product/product-knowledge/src/index.ts')],
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22',
  plugins: [{ name: 'native-dependencies-and-ocr', setup(build) {
    build.onResolve({ filter: /^\.\/paddleocr-worker\.ts$/ }, () => ({ path: '../cloud/ocr-provider.mjs', external: true }));
    build.onResolve({ filter: /^[^./]/ }, args => {
      if (!args.importer) return;
      if (isBuiltin(args.path)) return { path: args.path, external: true };
      const file = createRequire(args.importer).resolve(args.path);
      return { path: relative(dirname(outfile), file).replaceAll('\\', '/'), external: true };
    });
  } }],
});
console.log('Built native cloud KnowledgeController with stdio OCR adapter');
