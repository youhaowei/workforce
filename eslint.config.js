import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist', 'build', 'node_modules', 'out', 'src/components/ui', 'src/electron']
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        // Browser globals
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLFormElement: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        ResizeObserver: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        confirm: 'readonly',
        alert: 'readonly',
        // Web APIs
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Headers: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        ReadableStream: 'readonly',
        performance: 'readonly',
        // Node globals
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        NodeJS: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        Buffer: 'readonly',
        // Test globals (Vitest)
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': typescript,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...js.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Disable no-undef for TypeScript — tsc handles this natively and
      // understands DOM globals (HTMLParagraphElement, etc.) that ESLint doesn't.
      'no-undef': 'off',
      // Use TypeScript version for unused vars (handles _ prefix)
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      // TypeScript method overloads appear as duplicates to ESLint
      'no-dupe-class-members': 'off',
      // Allow generators without yield (useful for async iterators)
      'require-yield': 'off',
      // Allow case declarations with proper scoping
      'no-case-declarations': 'off',
      // Logging rules
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      'no-debugger': 'error',
      // Code style
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'no-nested-ternary': 'warn',
      // Performance rules (relax slightly for complex services)
      'max-depth': ['warn', 4],
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'complexity': ['warn', 15],
      // React-specific (rules-of-hooks and exhaustive-deps are above)
    }
  },
  // Relax max-lines for test files and type definition barrels
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/**/types.ts'],
    rules: {
      'max-lines': 'off',
    }
  },
  // TanStack Router files export both Route and component
  {
    files: ['src/ui/routes/**/*.tsx', 'src/ui/context/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    }
  }
];
