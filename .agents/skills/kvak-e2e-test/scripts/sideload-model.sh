#!/usr/bin/env bash
# Push a GGUF/BIN model to the device and place it in the app's filesDir,
# skipping the slow in-app download. Models MUST be named exactly as in
# src/services/constants.ts (MODEL_CATALOG / EMBED_CATALOG / WHISPER_CATALOG)
# or the app won't detect them.
#
#   sideload-model.sh <local-file>
#   PKG=com.kvak sideload-model.sh /tmp/nomic-embed.Q4_K_M.gguf
set -euo pipefail
PKG=${PKG:-com.kvak}
LOCAL="${1:?usage: sideload-model.sh <local-file>}"
NAME="$(basename "$LOCAL")"

[ -f "$LOCAL" ] || { echo "not found: $LOCAL" >&2; exit 1; }
command -v adb >/dev/null || { echo "adb not on PATH" >&2; exit 1; }

echo "→ push $NAME to /data/local/tmp" >&2
adb push "$LOCAL" "/data/local/tmp/$NAME" >/dev/null
echo "→ copy into app filesDir (run-as)" >&2
adb shell "run-as $PKG sh -c 'cp /data/local/tmp/$NAME /data/data/$PKG/files/$NAME && echo OK'" \
  || { echo "run-as copy failed — is the app debuggable & installed?" >&2; exit 1; }
echo "→ verify" >&2
adb shell "run-as $PKG ls -lh /data/data/$PKG/files/$NAME"
