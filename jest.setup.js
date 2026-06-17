/**
 * Jest setup — runs after the test framework is installed (setupFilesAfterEnv),
 * so `jest.mock` is available. Covers two module-scope side effects that break
 * importing/rendering the app graph under jest:
 *
 *  - NativeEventEmitter: state.tsx constructs one at module scope with no arg;
 *    the real RN class throws "requires a non-null argument" when the native
 *    module is absent (it always is in jest).
 *  - AsyncStorage: the persistence layer (storage.ts) is used by AppProvider
 *    effects on mount; without a mock the TurboModule call rejects.
 */
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter', () => {
  // react-native/index.js exposes this as `.default`, so mirror the ESM shape.
  class NativeEventEmitter {
    addListener() {
      return { remove: jest.fn() };
    }
    removeAllListeners() {}
    emit() {}
    removeSubscription() {}
  }
  return { __esModule: true, default: NativeEventEmitter };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  getAllKeys: jest.fn(() => Promise.resolve([])),
  multiGet: jest.fn(() => Promise.resolve([])),
  multiSet: jest.fn(() => Promise.resolve()),
  multiRemove: jest.fn(() => Promise.resolve()),
}));
