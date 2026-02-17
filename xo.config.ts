import {FlatXoConfig} from 'xo';
// @ts-ignore - eslint-plugin-import-newlines is not migrated to flat config and exports no types
import importNewlines from 'eslint-plugin-import-newlines';

export default [
  {
    plugins: {
      'import-newlines': importNewlines,
    },
    rules: {
      'new-cap': 'off',
      'no-async-promise-executor': 'off',
      'import-newlines/enforce': ['error', {items: 0}],
      'unicorn/prefer-logical-operator-over-ternary': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/class-literal-property-style': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
    },
    space: true
  },
  {
    ignores: ['xo.config.ts'],
  }
] satisfies FlatXoConfig;
