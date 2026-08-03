// Setup for the `app` (component) test project only. The `core` project runs on
// plain Node with no setup at all — see jest.config.js.
//
// @testing-library/react-native v12.4+ registers its own matchers
// (toBeOnTheScreen, toBeDisabled, ...) on import, so there is nothing to wire up
// by hand.

// AsyncStorage is a native module: off-device it has nothing to bind to and
// throws on import. The package ships an in-memory stand-in for exactly this,
// which behaves like the real store for the length of a test file.
jest.mock('@react-native-async-storage/async-storage', () =>
  // `require`, not `import`: jest.mock factories are hoisted above the imports,
  // so an imported binding would not exist yet when this runs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

export {};
