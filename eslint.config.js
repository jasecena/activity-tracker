// ESLint 9 flat config.
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  ...expoConfig,
  prettierConfig,
  {
    ignores: ['node_modules/**', 'coverage/**', '.expo/**', 'dist/**', 'ios/**', 'android/**'],
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // eslint-config-expo only registers the @typescript-eslint plugin for TS
    // files, so rules from it have to live in a TS-scoped block too.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Surfaces genuinely dead code rather than letting it accumulate.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The segmentation engine must stay platform-free so it can be tested
    // without a simulator or a phone that is physically moving. Importing React
    // or React Native here would break that, so it is an error rather than a
    // convention.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/core must stay pure TypeScript — keep React out of the engine.' },
            {
              name: 'react-native',
              message: 'src/core must stay pure TypeScript — keep React Native out of the engine.',
            },
          ],
          patterns: [
            {
              group: ['expo', 'expo-*', '@expo/*', 'react-native/*', '@/features/*', '@/components/*', '@/services/*'],
              message: 'src/core must stay pure TypeScript with no platform or UI dependencies.',
            },
          ],
        },
      ],
    },
  },
  {
    // Build-time scripts run under Node, not the app. Globals are listed rather
    // than pulled from the `globals` package: a lint config is not worth a
    // dependency, and the list is exactly as long as the scripts need.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { Buffer: 'readonly', console: 'readonly', fetch: 'readonly', process: 'readonly' },
    },
    rules: {
      // stdout is the output of a command-line tool, not a stray debug print.
      'no-console': 'off',
    },
  },
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      // Tests may reach across the core/UI boundary that production code may not.
      'no-restricted-imports': 'off',
      // False positive on `import fc from 'fast-check'` — the default export is
      // a namespace whose members are also exported by name, so every `fc.x`
      // gets flagged. The namespace form is fast-check's documented idiom.
      'import/no-named-as-default-member': 'off',
    },
  },
];
