#!/usr/bin/env bash
# Rebuild ONLY the thin JNI bridge (libkvak_llama.so) against the prebuilt
# llama.cpp .so files committed in jniLibs/. Use when C++ symbols are stale
# (e.g. embed/whisper JNI fns missing → UnsatisfiedLinkError). Does NOT
# rebuild llama.cpp itself.
#
# Env:
#   APP_DIR    kvak/mobile checkout            (required)
#   LLAMA_DIR  llama.cpp source checkout (for headers)  default ../llama.cpp
#   ANDROID_HOME                                  default $ANDROID_HOME / $ANDROID_SDK_ROOT
set -euo pipefail
APP_DIR="${APP_DIR:?set APP_DIR to the kvak/mobile checkout}"
LLAMA_DIR="${LLAMA_DIR:-$(cd "$APP_DIR/../../.." && pwd)/llama.cpp}"
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/android-sdk}}"
NDK="$ANDROID_HOME/ndk/28.2.13676358"
TOOLCHAIN="$NDK/build/cmake/android.toolchain.cmake"

[ -f "$LLAMA_DIR/include/llama.h" ] || { echo "LLAMA_DIR=$LLAMA_DIR has no include/llama.h" >&2; exit 1; }
[ -f "$TOOLCHAIN" ]                || { echo "NDK toolchain not found: $TOOLCHAIN" >&2; exit 1; }
command -v cmake >/dev/null         || { echo "cmake not installed" >&2; exit 1; }

BUILD=/tmp/kvak-llama-build
rm -rf "$BUILD"; mkdir -p "$BUILD"; cd "$BUILD"
cmake "$APP_DIR/android/app/src/main/cpp/CMakeLists.txt" \
  -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 \
  -DLLAMA_DIR="$LLAMA_DIR" -G "Unix Makefiles"
cmake --build . -j"$(nproc)"

echo "→ JNI symbols exported:" >&2
nm -D libkvak_llama.so | grep "Java_com_kvak" || echo "(none?!)" >&2
cp libkvak_llama.so "$APP_DIR/android/app/src/main/jniLibs/arm64-v8a/libkvak_llama.so"
echo "→ replaced jniLibs/arm64-v8a/libkvak_llama.so" >&2
echo "→ next: npm run bundle:android && (cd android && ./gradlew assembleDebug) && adb install -r app/build/outputs/apk/debug/app-debug.apk" >&2
