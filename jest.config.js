/**
 * Two projects, because the two halves of this codebase have different needs:
 *
 * - `core` runs the segmentation engine on plain Node. No React Native
 *   transform, no jsdom, no mocks — it is a few hundred milliseconds and it is
 *   the suite that actually guards correctness.
 * - `app` runs component tests through the jest-expo preset.
 *
 * Coverage thresholds are deliberately strict on `src/core` and absent
 * elsewhere: the engine is where bugs are expensive and testing is cheap. It is
 * also the only way this app is testable at all on Linux — everything below
 * `core` is a function of a fix stream, and a fix stream is just numbers.
 */
// Set before Jest forks its workers, so they inherit it — assigning it inside a
// setup file is too late, because the runtime has already resolved a timezone
// by then.
//
// It matters because a *day* is a wall-clock concept: which local day a fix
// belongs to, and where the boundary between yesterday and today falls, both
// resolve against the phone's zone. Pinning the suite to UTC makes
// `jest.setSystemTime` mean the same thing on a laptop in Sydney as it does on
// a CI runner in Virginia.
process.env.TZ = 'UTC';

module.exports = {
  projects: [
    {
      displayName: 'core',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/core/**/*.test.ts'],
      // Type-stripping plus ESM->CJS, and nothing else. If the engine ever
      // needs more than this to compile, it has grown a dependency it should
      // not have. `configFile: false` keeps babel.config.js (and therefore all
      // of Expo's transforms) out of this project entirely.
      transform: {
        '^.+\\.ts$': [
          'babel-jest',
          {
            presets: ['@babel/preset-typescript'],
            plugins: ['@babel/plugin-transform-modules-commonjs'],
            babelrc: false,
            configFile: false,
          },
        ],
      },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
    {
      displayName: 'app',
      // Platform-specific preset: this app ships to iOS only, so component
      // tests should resolve .ios.tsx variants and iOS native mocks.
      preset: 'jest-expo/ios',
      testMatch: ['<rootDir>/src/!(core)/**/*.test.{ts,tsx}', '<rootDir>/src/*.test.{ts,tsx}'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      // `@noble/ciphers` is published as pure ESM ("type": "module", no CJS
      // build). Metro handles that natively, so the app itself is unaffected —
      // but Jest runs on CommonJS and refuses it at `import` unless the package
      // is transformed. The rest of this list is jest-expo's own default, which
      // is replaced rather than extended when this key is set.
      transformIgnorePatterns: [
        '/node_modules/(?!(.pnpm|@noble|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation))',
        '/node_modules/react-native-reanimated/plugin/',
        '/node_modules/@react-native/babel-preset/',
      ],
    },
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/**/__tests__/**'],
  // Every core domain is gated, not just the segmenter: `src/core` is the part
  // that has to be correct, and it is the part that is cheap to test.
  coverageThreshold: {
    './src/core/compact/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/geo/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/segments/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/day/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/format/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/places/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/energy/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/export/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/replay/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/media/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/power/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/backup/': { branches: 90, functions: 100, lines: 95, statements: 95 },
    './src/core/plans/': { branches: 90, functions: 100, lines: 95, statements: 95 },
  },
  coverageReporters: ['text-summary', 'lcov'],
};
