# Kvak

On-device AI chat for Android. Run small LLMs entirely on your phone with
[llama.cpp](https://github.com/ggml-org/llama.cpp), dictate with on-device
[Whisper](https://github.com/ggerganov/whisper.cpp) speech recognition, and let
the model call external tools over [MCP](https://modelcontextprotocol.io) —
and discover tools over ([ContextVM](https://github.com/contextvm)).

No prompts or completions leave your device unless you explicitly connect an
MCP server.

## Features

- **Local LLM inference** — download GGUF models (TinyLlama, Qwen 2.5, Llama 3.2,
  Gemma 2, Phi-2) and run them on-device with token streaming.
- **On-device speech recognition** — Whisper models for voice input.
- **System TTS** — tap a message to hear it spoken.
- **MCP tool calling** — the model can call tools:
  - Remote over HTTP/SSE: any MCP server.
  - Remote over Nostr ([ContextVM](docs/contextvm.md)): MCP servers reached via
    Nostr relays, messages end-to-end encrypted with NIP-44.
- **Conversations** — create, rename, fork, export (Markdown), per-conversation
  system prompts and tool toggle.

## Privacy & threat model

- Models run **fully on-device**. Inference never touches the network.
- MCP servers are **opt-in** — the app only talks to servers you add in Settings.
- Nostr MCP traffic is **end-to-end encrypted** via NIP-44.
- The app's Nostr client identity is **ephemeral** — a fresh keypair per launch,
  not persisted.


## License

[MIT](LICENSE) 
