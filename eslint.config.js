import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import ts from 'typescript-eslint';

export default [
  {
    ignores: ['node_modules', 'dist', 'build', '.next', '.turbo'],
  },
  js.configs.recommended,
  ...ts.configs.strict,
  ...ts.configs.stylistic,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  prettierConfig,
];
