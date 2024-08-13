module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json'],
  },
  extends: [
    'airbnb',
    'airbnb-typescript',
  ],
  ignores: ['src/types/global.d.ts']
};
