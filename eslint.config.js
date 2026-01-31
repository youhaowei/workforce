import js from '@eslint/js';
import solid from 'eslint-plugin-solid/configs/recommended';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist', 'build', 'node_modules', '.tauri']
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
        console: 'readonly',
        process: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': typescript,
      solid
    },
    rules: {
      ...js.configs.recommended.rules,
      ...solid.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-types': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'no-nested-ternary': 'warn',
      'max-depth': ['warn', 3],
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
      'complexity': ['warn', 10],
      'solid/no-destructure': 'off',
      'solid/reactivity': 'warn'
    }
  }
];
