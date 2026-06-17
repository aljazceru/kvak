# ContextVM test harness

A minimal, self-contained setup for testing the app's MCP-over-Nostr
integration end-to-end, without depending on flaky public Nostr relays.

Three pieces:

| File | Role |
|------|------|
| `relay.mjs` | Minimal Nostr relay (NIP-01 EVENT/REQ/CLOSE) on port 8777. ~80 lines, no deps beyond `ws`. |
| `gateway.ts` | Launches a ContextVM gateway that bridges the relay to a local MCP server. |
| `mcp-server.ts` | A trivial MCP server exposing two tools: `echo(message)` and `add(a, b)`. |

## Why a local relay?

Public Nostr relays (damus, primal, nos) unreliably deliver gift-wrap (kind
1059) events to subscriptions — rate-limiting, NIP-42 auth, dropped events.
That makes the transport impossible to test deterministically. A local relay
removes that variable so you can isolate app ↔ gateway behavior.

## Prerequisites

- **Node 22+** for the relay (`npm install ws` in this dir).
- **[Bun](https://bun.sh)** to run the gateway + MCP server (TypeScript, no build step).
- A checkout of **[@contextvm/sdk](https://github.com/contextvm/sdk)** with the
  `since`-filter patch applied — see [`docs/contextvm.md`](../../docs/contextvm.md)
  → "Known SDK issue". The gateway runs from that checkout so its imports resolve.

## Run it

```sh
# 1. relay (terminal 1) — from this directory
npm install
node relay.mjs

# 2. gateway (terminal 2) — from your @contextvm/sdk checkout
export GATEWAY_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex')")
bun run /path/to/kvak/mobile/examples/contextvm/gateway.ts
#   → prints the gateway pubkey. Keep GATEWAY_KEY stable to reuse the same pubkey.

# 3. in the app: Settings → Nostr MCP Servers
#      name:    Kvak Test
#      pubkey:  <the gateway pubkey printed above>
#      relays:  ws://<this-machine-LAN-ip>:8777
#    → Add & Connect. You should see "2 tools: echo, add".

# 4. load a model (Qwen 2.5 3B recommended), then in a chat:
#      "Reply with only: [TOOL: echo {message:hello}]"
#    → expect a tool chip: echo → echo: hello
```

## Verification

Watch the relay log — each tool call produces exactly **two** kind-1059
events: one app→gateway (`#p` = gateway pubkey) for the request, one
gateway→app for the response.
