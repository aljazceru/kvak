# ContextVM (MCP over Nostr)

The app can call remote MCP tool servers over [Nostr](https://github.com/nostr-protocol/nips),
with messages end-to-end encrypted via [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md)
and transported as gift-wrap events ([NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md)).
This is the [ContextVM](https://github.com/contextvm) protocol.

This doc covers the implementation in this repo, the protocol specifics that
are easy to get wrong, and a known SDK issue. For the runnable test harness,
see [`examples/contextvm/`](../examples/contextvm/).

## Where the code lives

| File | Role |
|------|------|
| `src/services/nostr-mcp.ts` | Relay pool, NIP-44 wrap/unwrap, JSON-RPC over gift-wrap. The whole transport. |
| `src/services/tools.ts` | Tool-call parsing from model output + dispatch (built-in / HTTP MCP / Nostr MCP). |
| `src/screens/SettingsScreen.tsx` | UI to add/connect Nostr MCP servers. |

## Protocol shape (what the gateway expects)

This implementation uses a **single-layer** gift-wrap, matching what
`@contextvm/sdk`'s gateway decrypts:

1. **Inner signed event** — kind `25910`, `.content` is the JSON-RPC message as
   plaintext, signed by the client's Nostr key.
2. **NIP-44 encrypt** the *entire* signed inner event JSON with a one-time
   random keypair, deriving the conversation key against the server's pubkey.
3. **Gift-wrap** (kind `1059`) the ciphertext, signed by the one-time key.

The gateway decrypts exactly one NIP-44 layer, JSON-parses the result as the
inner event, verifies its signature, then reads `.content` as the MCP message.

> ⚠️ Do **not** use nostr-tools' `wrapEvent`/`unwrapEvent` here. Those produce
> and consume the full 3-layer NIP-59 form (rumor → seal → gift-wrap). The
> ContextVM gateway only peels one layer and expects the plaintext to *be* a
> signed event whose content is the payload. Using `wrapEvent` silently
> produces events the gateway will never decrypt. See `publishToServer` /
> `tryUnwrap` in `nostr-mcp.ts`.

## Client identity

A fresh Nostr keypair is generated on each app launch and held in memory only
(`new NostrMCPClient()` in `nostr-mcp.ts`). It is not persisted and not tied to
any stable identity — this is deliberate for the current privacy posture.

## Tool-call syntax

The on-device LLM emits tool calls inline as:

```
[TOOL: tool_name {"arg":"value"}]
```

`processToolCalls` in `tools.ts` extracts these, dispatches to the right backend,
and replaces the marker with a result chip in the chat.

Small on-device models (1.5B–3B) frequently emit **nearly-valid** JSON —
unquoted keys (`{message:hello}`), unquoted values, trailing commas. `parseToolArgs`
attempts strict `JSON.parse` first, then applies a tolerant repair so
legitimate calls still execute instead of being silently dropped.

## Known SDK issue: `since: now` rejects all gift-wraps

NIP-59 deliberately fuzzes a gift-wrap's `created_at` up to **2 days into the
past** for privacy (`randomNow` in nostr-tools' `nip59`). The published
`@contextvm/sdk` gateway subscribes with `since: now`, so on any
standards-compliant relay it rejects *every* gift-wrap — the gateway never
sees a single message.

**Fix:** in your `@contextvm/sdk` checkout, patch
`src/transport/base-nostr-transport.ts` (`createSubscriptionFilters`) to use
`since: now - 2 * 24 * 60 * 60` and rebuild (`npm run build`). This is an
upstream bug; any ContextVM gateway using the published SDK cannot receive
gift-wraps from a standard client until it's fixed.

## Debugging tips

- The relay logs every event with `kind`, sender pubkey prefix, and `#p` tag.
  A successful tool call shows two kind-1059 events: app→gateway (`#p` = gateway
  pubkey) then gateway→app (`#p` = client pubkey).
- App-side Nostr logs are tagged `[nostr-mcp]` and visible via
  `adb logcat -s ReactNativeJS`.
- If the gateway logs `No pending request found for response ID`, that's
  duplicate/late-response noise — it does not break the handshake or tool calls.
