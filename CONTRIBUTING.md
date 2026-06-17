# Contributing to Kvak

Thanks for your interest in contributing! This is a small project — keep PRs focused.

## Setup

See the [README](./README.md#build-from-source) for build prerequisites. Short version:

```sh
npm install
npm run bundle:android
cd android && ./gradlew assembleDebug
```

You need a **physical arm64 Android device** (API 24+) — the prebuilt native
libraries (`jniLibs/arm64-v8a/`) are arm64-only, so x86 emulators won't run it.

## Before opening a PR

1. **Typecheck:** `npx tsc --noEmit` — must pass clean.
2. **Build:** `npm run bundle:android && (cd android && ./gradlew assembleDebug)` — must succeed.
3. **Test on device** if your change touches native code, the model pipeline, MCP, or the keyboard/UI layout. The simulator is not sufficient.
4. Keep diffs small and focused. One concern per PR.

## Code style

- TypeScript strict mode. No `any` in new code unless there's a `// ponytail:` reason.
- Prefer the standard library and existing dependencies over adding new ones.
- No speculative abstractions / "flexibility for later".
- Comments should explain *why*, not *what*.

## Commit messages

Conventional style, imperative mood:

```
Fix keyboard overlapping compose bar on Android 16

targetSdk 36 enforces edge-to-edge, so adjustResize no longer resizes the
activity. Track keyboard height and apply it as root bottom padding.
```

## Reporting bugs

Open an issue with: device model, Android version, app version, steps to
reproduce, and logcat output (`adb logcat -s ReactNativeJS`). Screenshots help.

## License

By contributing you agree your contributions are licensed under the project's
[MIT license](./LICENSE).
