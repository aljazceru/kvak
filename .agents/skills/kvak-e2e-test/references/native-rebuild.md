# Native bridge rebuild — when JNI symbols are stale

Gradle does **not** build C++. The `lib*.so` files in
`android/app/src/main/jniLibs/arm64-v8a/` are linked directly. If the C++
source (`llama_bridge.cpp`) gained functions the committed `.so` lacks, the
app throws `UnsatisfiedLinkError` at runtime.

## Detect a stale bridge

**Static** — compare exported symbols vs Kotlin declarations:
```bash
nm -D android/app/src/main/jniLibs/arm64-v8a/libkvak_llama.so | grep Java_com_kvak
grep -E 'external fun' android/app/src/main/java/com/kvak/LlamaBridge.kt
```
Every `external fun nativeXxx` must have a matching `Java_com_kvak_LlamaBridge_nativeXxx`
symbol. Missing = stale.

**Runtime** — in logcat after calling the feature:
```
adb logcat -d | grep -E "No implementation found|UnsatisfiedLink"
```

## Rebuild (thin bridge only; links prebuilt llama.cpp)

```bash
APP_DIR="$(pwd)" \  # kvak/mobile checkout
  scripts/rebuild-bridge.sh
```
Requirements: `cmake`, an `llama.cpp` checkout (`LLAMA_DIR`, for headers),
and NDK 28.2.13676358. The build links the committed `libllama.so` etc. — it
does **not** rebuild llama.cpp.

Verify the new `.so` then rebuild the APK:
```bash
nm -D android/app/src/main/jniLibs/arm64-v8a/libkvak_llama.so | grep Java_com_kvak
npm run bundle:android
(cd android && ./gradlew assembleDebug)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am force-stop com.kvak && adb shell monkey -p com.kvak -c android.intent.category.LAUNCHER 1
```

## Known historical gap (fixed in this checkout)

The Jun-3 `.so` shipped only 5 symbols and was missing the 3 embed symbols
(`nativeLoadEmbedModel`, `nativeGetEmbeddings`, `nativeFreeEmbedModel`). The
embed feature therefore silently fell back to a non-semantic mock — see
rag-verification.md. A rebuilt `.so` has all 8.
