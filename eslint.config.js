// 程式風格檢查（npm run lint，含在 make check）：TypeScript 前後端共用，前端另外檢查 React Hooks 的規則。
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['node_modules/', 'backend/dist/', 'frontend/dist/', 'coverage/', 'cache/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // Staging 的腳本（Render 與 GitHub Actions 用 node 直接執行，不經過 TypeScript）
    files: ['backend/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    rules: {
      // 用底線開頭的參數或變數，代表「刻意不用」，例如 Express 錯誤處理的 _next。
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]);
