import { PRODUCT_TITLE } from './src/product'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react(), { name: 'chengye-product-title', transformIndexHtml: html => html.replace(/<title>.*?<\/title>/, '<title>' + PRODUCT_TITLE + '</title>') }],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:7001',
        changeOrigin: true,
      },
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
