module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['examples/', 'android/'],
  overrides: [
    // Jest globals (describe/it/expect/jest) aren't in the base env; the
    // @react-native config only grants them under test-file globs, so cover
    // the root jest config + setup explicitly.
    {
      files: ['__tests__/**', '**/*.test.*', 'jest.setup.js', 'jest.config.js'],
      env: { jest: true, node: true },
    },
  ],
};
