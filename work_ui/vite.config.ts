import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WORK_UI_PORT || 5180),
    strictPort: true,
    proxy: {
      '/knowledge-native': {target:process.env.CASE_API_PROXY||'http://127.0.0.1:5181',changeOrigin:false},
      '/harness': {target: process.env.CASE_API_PROXY || 'http://127.0.0.1:5181', ws:true, changeOrigin:false},
      '/api': {
        target: process.env.CASE_API_PROXY || 'http://127.0.0.1:5181',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
