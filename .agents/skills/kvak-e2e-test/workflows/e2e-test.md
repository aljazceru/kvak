# Full end-to-end test

End-to-end regression for Kvak: static gates → device build/install →
functional UI sweep → inference → RAG. Run this before a release. Each step
names the failure mode it guards against.

Paths assume `cd kvak/mobile`. Scripts are in the skill's `scripts/`.
Set `SCRIPTS` to that dir (or call them by absolute path).

<prerequisites>
- A physical arm64 Android device on USB debugging (emulators won't run the
  native libs). Confirm: `adb devices -l` and `adb shell getprop ro.product.cpu.abi`
  == `arm64-v8a`.
- An `llama.cpp` checkout for the optional native rebuild (`LLAMA_DIR`).
- Models available locally to sideload (skip multi-hundred-MB downloads):
  at least one LLM GGUF + the Nomic embed GGUF for RAG.
</prerequisites>

<step name="1. Static gates (catch broken code before touching a device)">
```bash
npx tsc --noEmit                 # must be clean
npx eslint . | grep -E '^✖'      # 0 errors (warnings are stylistic)
npx jest                         # all green
npm run bundle:android           # full import graph compiles to a prod bundle
```
Do not proceed to the device if any of these fail. The bundle build is the
strongest static check — it compiles every screen/service/native module.
</step>

<step name="2. Device: build & install a fresh APK">
```bash
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
(cd android && ./gradlew assembleDebug)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb logcat -c
adb shell am force-stop com.kvak
adb shell monkey -p com.kvak -c android.intent.category.LAUNCHER 1
```
Crash check after launch:
```bash
adb logcat -d | grep -iE 'FATAL|AndroidRuntime.*com.kvak' || echo none
```
</step>

<step name="3. Sideload models (skip downloads)">
Confirm exact filenames in `src/services/constants.ts` first.
```bash
scripts/sideload-model.sh /path/to/tinyllama-1.1b-chat-v1.0.Q4_0.gguf
scripts/sideload-model.sh /path/to/nomic-embed-text-v1.5.Q4_K_M.gguf
adb shell am force-stop com.kvak && adb shell monkey -p com.kvak -c android.intent.category.LAUNCHER 1
```
</step>

<step name="4. UI driving primer">
All subsequent steps use `scripts/adb-ui`. Refocus the app before each screen
transition to avoid focus theft (see references/adb-quirks.md):
```bash
UI=scripts/adb-ui
$UI dump                 # read what's on screen
$UI tap 'Settings'       # tap by label (re-dumps for fresh coords)
$UI tap 'Model Library'
```
For emoji buttons (gear ⚙️, send ↑), tap by coords from `$UI dump`.
</step>

<step name="5. Load models (exercises native loadModel + loadEmbedModel)">
```bash
$UI tap 'Model Library' && $UI tap 'Load'
# expect logcat: "Model loaded successfully"
adb logcat -d | grep -E 'Model loaded successfully|Embed model loaded successfully'

# load the embed model: Settings → scroll down → Load Embed
$UI tap 'Settings' ; adb shell input swipe 540 1800 540 700 300 ; $UI tap 'Load Embed'
```
**If you see `No implementation found` / `UnsatisfiedLinkError`** → the bridge
`.so` is stale. Stop and run references/native-rebuild.md, then reinstall and
resume here.
</step>

<step name="6. Chat + inference (exercises doSend, streaming, auto-title)">
```bash
$UI tap '＋'                    # new conversation
$UI tap 'Message' ; $UI send 'What%sis%sthe%scapital%sof%sFrance'
# keyboard shifted the send button — re-tap by re-dumping:
$UI tap '↑' || adb shell input tap $($UI find '↑')   # fallback: coords from dump
sleep 12
$UI dump | grep -i paris          # assistant reply present
```
Verify no JS errors: `adb logcat -d | grep ReactNativeJS | grep -iE 'error|exception'`
</step>

<step name="7. Functional screen sweep (no crashes)">
Visit each screen and confirm it renders + no `FATAL` in logcat:
Conversation list, Settings (device info, active model), Model Library,
Document Library, Lock screen (PIN `1234` unlocks → returns to list),
Settings → Unload (native `free` → "No model loaded").
After unload, reload the LLM so RAG can run.
</step>

<step name="8. RAG (the part with two silent failure modes)">
Follow references/rag-verification.md in full. Minimum:
1. Settings → Document Library → `+ Paste Text` → ingest a short, spaced
   secret (≤36 chars): `The%svault%scode%sis%sZebra4488`. Confirm "1 chunks".
2. New conv, gear → enable **RAG ON**, ask "what is the vault code" → expect
   `Zebra4488`.
3. New conv, **RAG OFF**, same question → must NOT contain `Zebra4488`.
4. `adb logcat -d | grep -q 'mock for test' && echo MOCK || echo real` → must
   be `real`.
Failing the control or showing MOCK → read rag-verification.md.
</step>

<step name="9. Stability sweep">
```bash
adb logcat -d | grep -iE 'FATAL EXCEPTION|ANR in com.kvak|SIGSEGV' || echo CLEAN
```
</step>

<success_criteria>
- All static gates green; prod bundle builds.
- App launches, loads LLM + embed natively (no UnsatisfiedLinkError).
- Inference produces a coherent reply; no JS errors.
- Every screen renders without a crash.
- RAG: ON answers with the secret, OFF does not, embeddings real (no mock).
- Zero FATAL/ANR across the session.
</success_criteria>
