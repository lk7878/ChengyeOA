import { BROWSER_TITLE } from './src/product'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFile, readdir } from 'node:fs/promises'
import { searchForWorkspaceRoot, transformWithOxc } from 'vite'

const workflowModules = new Map(['schema', 'relation-display'].map(name => [
  `\0oa-workflow-${name}`,
  path.resolve(__dirname, `../server/app/domain/workflow/${name}.ts`),
]))

export default defineConfig({
  plugins: [react(), {
    name: 'oa-pdf-reader-assets', apply: 'build',
    async generateBundle() {
      for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
        const directory = path.resolve(__dirname, 'node_modules/pdfjs-dist', folder)
        for (const name of await readdir(directory)) {
          this.emitFile({ type: 'asset', fileName: `pdf-assets/${folder}/${name}`, source: await readFile(path.join(directory, name)) })
        }
      }
    },
  }, {
    // Publish shared workflow modules without server filesystem URLs in the browser.
    name: 'oa-workflow-contract', enforce: 'pre',
    resolveId(source) {
      for (const name of ['schema', 'relation-display']) {
        if (source === `../../../../../server/app/domain/workflow/${name}`) return `\0oa-workflow-${name}`
      }
    },
    async load(id) {
      const modulePath = workflowModules.get(id)
      if (!modulePath) return
      this.addWatchFile(modulePath)
      return (await transformWithOxc(await readFile(modulePath, 'utf8'), modulePath)).code
    },
  }, { name: 'chengye-product-title', transformIndexHtml: html => html.replace(/<title>.*?<\/title>/, '<title>' + BROWSER_TITLE + '</title>') }],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), path.resolve(__dirname, '../server/app/domain/workflow')] },
    host: '0.0.0.0',
    allowedHosts: true,
    port: 3000,
    proxy: {
      '/api/health': {
        target: process.env.OA_API_PROXY || 'http://127.0.0.1:7001',
        changeOrigin: true,
      },
      '/api/v1': {
        target: process.env.OA_API_PROXY || 'http://127.0.0.1:7001',
        changeOrigin: true,
      },
      '/api': { target: 'http://127.0.0.1:5180', changeOrigin: false, timeout: 0, proxyTimeout: 0 },
      '/harness': { target: 'http://127.0.0.1:5180', ws: true, changeOrigin: false, timeout: 0, proxyTimeout: 0 },
      '/knowledge-native': { target: 'http://127.0.0.1:5180', ws: true, changeOrigin: false, timeout: 0, proxyTimeout: 0 },
      '/wb': { target: 'http://127.0.0.1:5180', changeOrigin: false },
    },
  },
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
    // Frontend flake governance 2026-08-02: 6 parallel jsdom+antd forks exhausted 15s testTimeout.
    pool: 'forks',        // Vitest 4 default; pinned explicitly for intent
    maxWorkers: 3,        // was 6 — halves CPU contention (root cause of load flakes)
    testTimeout: 30000,   // was 15000 — headroom for heavy renders under reduced contention
    retry: 1,             // backstop: re-run a failed test once; deterministic failures still fail
  },
})
