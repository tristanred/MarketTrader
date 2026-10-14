import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*'],
  },
  {
    files: [
      'packages/*/src/**/*.ts',
      'packages/*/src/**/*.tsx',
      'packages/*/tests/**/*.ts',
      'packages/*/tests/**/*.tsx',
      'tools/*/src/**/*.ts',
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: true,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs['recommended'].rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/env.js', '**/env'],
          importNames: ['liveBootConfig'],
          allowTypeImports: true,
          message:
            'Live options are read through an injected ConfigReader (config.get). Only config/runtime-config.ts may import liveBootConfig.',
        }],
      }],
    },
  },
  {
    files: ['packages/server/src/config/runtime-config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
