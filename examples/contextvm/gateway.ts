// ContextVM gateway: exposes the test MCP server (`echo`, `add`) over Nostr via
// a local relay, so the Kvak app can reach it as a Nostr MCP server.
//
// Run this from your @contextvm/sdk checkout (so `@contextvm/sdk`,
// `@modelcontextprotocol/sdk`, and `nostr-tools` resolve). That checkout MUST
// have the `since`-filter patch applied (see docs/contextvm.md → "Known SDK
// issue"). Without it the gateway never receives gift-wraps, because NIP-59
// fuzzes `created_at` up to 2 days into the past but the SDK subscribes with
// `since: now`.
//
//   export GATEWAY_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
//   bun run examples/contextvm/gateway.ts
//
// It prints the gateway's pubkey — paste that into the app's Settings → Nostr
// MCP Servers along with your relay URL (ws://<this-machine-LAN-ip>:8777).
import { NostrMCPGateway } from '@contextvm/sdk/gateway';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PrivateKeySigner } from '@contextvm/sdk/signer';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';

const RELAYS = ['ws://localhost:8777'];

// Generate a fresh key each run unless GATEWAY_KEY is set. For a STABLE pubkey
// (so the app config doesn't change across restarts), export GATEWAY_KEY once
// and reuse it.
const priv = process.env.GATEWAY_KEY || bytesToHex(generateSecretKey());
const pub = getPublicKey(priv);
console.log('[gateway] pubkey:', pub);
console.log('[gateway] configure the app with this pubkey + relay ws://<your-LAN-ip>:8777');

const mcp = new StdioClientTransport({
  command: 'bun',
  args: ['examples/contextvm/mcp-server.ts'],
});
const gateway = new NostrMCPGateway({
  mcpClientTransport: mcp,
  nostrTransportOptions: {
    signer: new PrivateKeySigner(priv),
    relayHandler: RELAYS,
    isPublicServer: true,
    publishRelayList: false,
    serverInfo: { name: 'Kvak Test', website: 'http://localhost' },
  },
});
await gateway.start();
console.log('[gateway] running on', RELAYS.join(', '));
process.on('SIGINT', async () => { await gateway.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await gateway.stop(); process.exit(0); });
