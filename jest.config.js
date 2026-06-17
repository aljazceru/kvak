module.exports = {
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Several deps ship as ESM ("type":"module") and the default RN preset only
  // transforms react-native / @react-native(-community). Transform the whole
  // react-native + @react-native* cluster (async-storage, safe-area-context,
  // get-random-values, …) and the nostr-tools ESM cluster (@noble/*, @scure/*)
  // so any test can reach the full app import graph (App render, tools, state).
  // Prefix match (no trailing "/") covers scoped variants like
  // @react-native-async-storage and @react-native/babel-preset alike.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|nostr-tools|@noble|@scure))',
  ],
};
