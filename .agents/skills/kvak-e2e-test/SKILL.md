---
name: kvak-e2e-test
description: End-to-end testing for the Kvak Android app (React Native + llama.cpp + on-device RAG) over adb on a real arm64 device. Use for "test the app", "run e2e / regression before release", "test RAG", "embed is broken / UnsatisfiedLinkError", or any device-level verification of chat, model loading, or the JNI bridge.
---

<objective>
Run and verify Kvak end-to-end on a physical arm64 Android device: static
gates, fresh-APK install, model loading (LLM + embed), chat inference, every
screen, and RAG. Encode the device-driving tricks and the two silent failure
modes (mock-embed fallback, KV-cache leak) so a full pass is fast and reliable.
</objective>

<essential_principles>
- **Drive the UI without screenshots.** `scripts/adb-ui` dumps the current
  screen as `x\ty\t<label>` and taps/finishes by label. It re-dumps on every
  call, so it's immune to keyboard-induced layout shifts. This is the
  workhorse — use it instead of hand-rolling `uiautomator` parsing every time.
- **Test on real hardware.** Only `arm64-v8a` native libs are shipped; x86
  emulators and 32-bit devices won't run inference. The README's hard
  requirement.
- **Gradle does not build C++.** `jniLibs/*.so` are linked directly. If a C++
  function is missing at runtime, the app throws `UnsatisfiedLinkError` — the
  `.so` is stale, rebuild the thin bridge (`references/native-rebuild.md`).
- **Two RAG failure modes are silent.** (1) missing embed symbols → non-semantic
  mock fallback; (2) uncleared KV cache → conversation B sees conversation A's
  prompt. The **RAG on/off control test** is the only thing that catches both
  (`references/rag-verification.md`).
- **adb input is fragile.** ~36-char ceiling, can't pass spaces (use `%s`),
  other apps steal focus on long inputs. See `references/adb-quirks.md` before
  typing anything non-trivial.
- **Lazy defaults are baked in.** `PKG=com.kvak`, activity
  `com.kvak/.MainActivity`, filesDir `/data/data/com.kvak/files`,
  NDK `28.2.13676358`. Override via env where a script reads it.
</essential_principles>

<routing>
Route by intent. All paths start from the skill directory.

**Full release regression** ("test the app", "run e2e", "is it release-ready"):
→ `workflows/e2e-test.md` (follow in order). It pulls in the references as needed.

**RAG-specific** ("test RAG", "does retrieval work"):
→ `references/rag-verification.md` + `references/adb-quirks.md`. Do the on/off
control; don't trust a single RAG-ON answer.

**Native/JNI broken** ("embed doesn't load", "UnsatisfiedLinkError",
"nativeLoadEmbedModel not found"):
→ `references/native-rebuild.md`, then `scripts/rebuild-bridge.sh`.

**Just driving the device UI** (ad-hoc taps/screens):
→ `scripts/adb-ui dump|tap|send` + `references/adb-quirks.md`.

**Static-only check** (no device; typecheck/lint/tests/bundle):
→ Step 1 of `workflows/e2e-test.md`.
</routing>

<quick_start>
```bash
cd kvak/mobile
UI=.agents/skills/kvak-e2e-test/scripts/adb-ui

# static gates first
npx tsc --noEmit && npx jest && npm run bundle:android

# device: install fresh, then drive
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am force-stop com.kvak
adb shell monkey -p com.kvak -c android.intent.category.LAUNCHER 1
$UI dump            # see what's on screen
$UI tap 'Settings'  # tap by label
```
For a full pass, follow `workflows/e2e-test.md`.
</quick_start>

<assets>
- `scripts/adb-ui` — UI dump/tap/send over adb (the workhorse).
- `scripts/sideload-model.sh` — push GGUF into the app filesDir (skip downloads).
- `scripts/rebuild-bridge.sh` — rebuild the thin JNI `.so` against prebuilt llama.cpp.
- `workflows/e2e-test.md` — ordered full-regression procedure.
- `references/adb-quirks.md` — adb input limits, focus theft, emoji, layout shift.
- `references/rag-verification.md` — the on/off control test + both silent failures.
- `references/native-rebuild.md` — detecting and fixing a stale JNI bridge.
</assets>

<success_criteria>
- Static gates green; production bundle compiles.
- App launches and loads LLM + embed natively (no UnsatisfiedLinkError).
- Chat inference replies coherently; no JS errors.
- Every screen renders without a crash.
- RAG: ON returns the ingested secret, OFF does not, embeddings are real (no mock).
- Zero FATAL/ANR/SIGSEGV across the session.
</success_criteria>
