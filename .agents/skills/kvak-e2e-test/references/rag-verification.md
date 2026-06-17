# RAG verification — and the two silent failure modes

RAG pipeline: paste doc → `chunkText` → **Nomic embed (native)** → store vectors
→ cosine-similarity retrieve → inject matched context into the system prompt.

## The control test (mandatory)

You cannot trust a single RAG-ON answer. TinyLlama happily hallucinates, and
context can leak across conversations. The only reliable check is the
**on/off control**:

1. Ingest a fact the model cannot know, e.g. `The vault code is Zebra4488`
   (short, spaced — see adb-quirks on the 36-char ceiling).
2. **New conversation, RAG ON**: ask "what is the vault code" → expect
   `Zebra4488`.
3. **New conversation, RAG OFF**: same question → must NOT mention `Zebra4488`
   (generic hallucination only).

If the RAG-OFF control still answers with the secret value, you have a
**KV-cache leak**, not working RAG (see below).

## Silent failure mode 1: mock-embed fallback (not semantic)

If the native embed JNI symbols are missing, `getEmbeddings()` in `state.tsx`
silently catches the error and falls back to a **non-semantic hash vector**.
RAG then "works" (returns *some* doc) but retrieval is by hash, not meaning.

**Detection:**
```
adb logcat -d | grep "mock for test"      # fires on fallback
```
If present → the bridge `.so` is stale. Rebuild it
(see native-rebuild.md) and check `nm -D libkvak_llama.so | grep nativeGetEmbeddings`.

## Silent failure mode 2: KV-cache leak across conversations

`nativeCompletion` / `nativeStreamCompletion` in `llama_bridge.cpp` call
`llama_decode` repeatedly. If the KV cache is never cleared, **conversation
B sees conversation A's prompt** — including A's injected RAG context. The
RAG-OFF control then "passes" with the secret value, falsely suggesting the
model knew it.

**Detection:** the control test above. RAG-OFF answering with the doc value
= leak.

**Fix:** at the start of both completion functions:
```c
llama_memory_clear(llama_get_memory(g_ctx), true);
```
(Older llama.cpp: `llama_kv_cache_clear(ctx)`. Check the installed header —
this checkout uses the `llama_memory_*` API.)

## Verify real embeddings are used

After a RAG send:
```
adb logcat -d | grep -q "mock for test" && echo MOCK || echo "real Nomic"
```
`real Nomic` (no mock line) = the native embed path ran.

## RAG answer quality ≠ pipeline correctness

TinyLlama 1.1B (the quick-to-sideload model) often can't *parse* or follow
injected context, and mangles run-on input. A weak model giving a wrong
answer does **not** mean RAG is broken — the control test is the source of
truth. For meaningful quality checks, sideload Qwen 2.5 3B or Llama 3.2.
