# Mango QVAC

On-device AI chat for Android. Run small LLMs entirely on your phone with
[llama.cpp](https://github.com/ggml-org/llama.cpp), dictate with on-device
[Whisper](https://github.com/ggerganov/whisper.cpp) speech recognition, and let
the model call external tools over [MCP](https://modelcontextprotocol.io) —
including over [Nostr](https://github.com/nostr-protocol/nips) with
end-to-end encryption ([ContextVM](https://github.com/contextvm)).

No prompts or completions leave your device unless you explicitly connect an
MCP server.

> **Status:** early / hackathon. arm64 Android only, pre-1.0, no iOS build.

## Features

- **Local LLM inference** — download GGUF models (TinyLlama, Qwen 2.5, Llama 3.2,
  Gemma 2, Phi-2) and run them on-device with token streaming.
- **On-device speech recognition** — Whisper models for voice input.
- **System TTS** — tap a message to hear it spoken.
- **MCP tool calling** — the model can call tools:
  - Built-in: `calculator`, `weather`, `search`, `datetime`.
  - Remote over HTTP/SSE: any MCP server.
  - Remote over Nostr ([ContextVM](docs/contextvm.md)): MCP servers reached via
    Nostr relays, messages end-to-end encrypted with NIP-44.
- **Conversations** — create, rename, fork, export (Markdown), per-conversation
  system prompts and tool toggle.
- **Keyboard-safe layout** — works correctly under Android 15/16 edge-to-edge.
- **Themes** — dark / light, persisted.

## Screens

The app has four screens: a conversation list, a chat view, a model library
(download / load / delete models), and settings (device info, voice models,
MCP servers, theme).

## Build from source

### Requirements

- **Node.js 22+**
- **JDK 17+** (OpenJDK 21 works)
- **Android SDK** with `compileSdk` / `targetSdk` 36, **NDK 28.2.13676358**
- A **physical arm64-v8a Android device** running API 24+ (Android 7.0+)

> ⚠️ **No emulator support.** Only `arm64-v8a` native libraries are bundled
> (`android/app/src/main/jniLibs/arm64-v8a/`). x86 / x86_64 emulators and
> 32-bit devices will not run the app. This is by design — on-device LLM
> inference is too slow to be useful on emulators.

The prebuilt llama.cpp + whisper.cpp shared libraries (~140 MB) are committed,
so **you do not need to build llama.cpp yourself**. You only rebuild them if
you change the C++ JNI bridge or upgrade the runtime — see
[`android/app/src/main/cpp/CMakeLists.txt`](android/app/src/main/cpp/CMakeLists.txt).

### Steps

```sh
git clone https://github.com/mango-qvac/mango-qvac.git
cd mango-qvac
npm install

# 1. Bundle the JS
npm run bundle:android

# 2. Build the debug APK
cd android && ./gradlew assembleDebug

# 3. Install on a connected device (USB debugging on)
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or in one step: `npm run build:android` (bundle + gradle).

For day-to-day development with Fast Refresh, run Metro (`npm start`) and
`npm run android` — but note the app still needs a device with the native libs
loaded, so the first install must be the manual APK install above.

### First run

1. Open the app → **Settings → Model Library**.
2. Download a small model (e.g. **Qwen 2.5 1.5B**, ~1 GB) and tap **Load**.
3. Start a chat and send a message. Token streaming begins once the model loads.

### Connecting a ContextVM (Nostr MCP) server

See [`examples/contextvm/`](examples/contextvm/) for a local relay + gateway +
test MCP server you can run to verify the Nostr tool-calling end-to-end, and
[`docs/contextvm.md`](docs/contextvm.md) for the protocol details and known SDK
issues.

## Architecture

```
React Native (JS/TS UI) ──► Kotlin native modules (JNI) ──► llama.cpp / whisper.cpp (arm64 .so)
        │
        ├── MCP tool routing: built-in | HTTP/SSE | Nostr (ContextVM, NIP-44 E2EE)
        └── AsyncStorage persistence
```

| Path | Role |
|------|------|
| `src/screens/` | Four app screens (conversations, chat, model picker, settings). |
| `src/state.tsx` | Single React Context + reducer; all app state. |
| `src/services/nostr-mcp.ts` | MCP-over-Nostr transport (relay pool, NIP-44, JSON-RPC). |
| `src/services/mcp.ts` | MCP-over-HTTP/SSE client. |
| `src/services/tools.ts` | Tool-call parsing + dispatch. |
| `src/services/native.ts` | Typed wrappers over the JNI native modules. |
| `android/app/src/main/jni/` | C++ bridges (`llama_bridge.cpp`, `whisper_bridge.cpp`). |
| `android/app/src/main/java/com/mangoqvac/` | Kotlin native modules + RN packages. |

## Privacy & threat model

- Models run **fully on-device**. Inference never touches the network.
- MCP servers are **opt-in** — the app only talks to servers you add in Settings.
- Nostr MCP traffic is **end-to-end encrypted** via NIP-44.
- The app's Nostr client identity is **ephemeral** — a fresh keypair per launch,
  not persisted.

See [`SECURITY.md`](SECURITY.md) for the full policy and vulnerability
reporting.

## Contributing

PRs welcome — read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. Keep diffs
focused, typecheck clean, and test on a real device.

## License

[MIT](LICENSE) © Mango QVAC contributors.
