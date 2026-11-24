import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'public/intelligence']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/components/DraggableModal.tsx', 'src/components/DraggableDrawer.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'antd', importNames: ['Modal', 'Drawer'], message: '统一使用 @/components/DraggableModal 或 DraggableDrawer，确保弹窗标题栏可拖动。' }],
        patterns: [{ group: ['antd/es/modal*', 'antd/lib/modal*', 'antd/es/drawer*', 'antd/lib/drawer*'], message: '请使用统一的可拖动弹窗组件。' }],
      }],
    },
  },
])
