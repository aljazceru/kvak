/**
 * Kvak — Nostr MCP Client (ContextVM-compatible)
 *
 * Lightweight MCP-over-Nostr client that connects to remote MCP tool servers
 * via Nostr relays using NIP-44 encryption and gift-wrap (NIP-59).
 *
 * This is a React Native–compatible implementation of the ContextVM protocol:
 * - JSON-RPC 2.0 over Nostr gift-wrap events (kind 1059)
 * - NIP-44 E2EE for all messages
 * - Standard MCP lifecycle: initialize → tools/list → tools/call
 *
 * Uses nostr-tools for crypto (pure JS, works in RN) and RN's built-in WebSocket
 * for relay connections.
 */

import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  verifyEvent,
  nip44,
  type NostrEvent,
  type EventTemplate,
} from 'nostr-tools';
import { decode as nip19Decode } from 'nostr-tools/nip19';
import { hexToBytes } from 'nostr-tools/utils';

// ─── Constants ─────────────────────────────────────────────────

const CTXVM_MESSAGES_KIND = 25910;
const GIFT_WRAP_KIND = 1059;
/** ContextVM server announcement kind (addressable, per @contextvm/sdk). */
const SERVER_ANNOUNCEMENT_KIND = 11316;
const MCP_PROTOCOL_VERSION = '2025-03-26';
const TIMEOUT_MS = 20_000; // Generous for slow relays; failed servers fail fast rather than hanging the UI.

/** Default relays to query for server discovery (mirrors the SDK's bootstrap list). */
const DISCOVERY_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

// ─── JSON-RPC Types ────────────────────────────────────────────

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── Public Types ──────────────────────────────────────────────

export interface NostrMCPServerConfig {
  id: string;
  name: string;
  /** Server's Nostr public key (hex or npub) */
  serverPubkey: string;
  /** Nostr relay URLs to connect through */
  relayUrls: string[];
  enabled: boolean;
}

export interface NostrMCPToolDef {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface NostrMCPConnection {
  serverId: string;
  connected: boolean;
  tools: NostrMCPToolDef[];
  serverInfo?: { name: string; version: string };
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────

/** Convert npub or hex to hex pubkey */
function toHexPubkey(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('npub') || trimmed.startsWith('nprofile')) {
    try {
      const decoded = nip19Decode(trimmed);
      if (decoded.type === 'npub') return decoded.data;
      if (decoded.type === 'nprofile') return decoded.data.pubkey;
    } catch {
      throw new Error(`Invalid npub/nprofile: ${trimmed.slice(0, 30)}...`);
    }
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;
  throw new Error(`Invalid pubkey (expected 64-char hex or npub): ${trimmed.slice(0, 20)}...`);
}

// ─── Relay Pool ────────────────────────────────────────────────

class RelayPool {
  private sockets = new Map<string, WebSocket>();
  private subHandlers = new Map<string, Array<(event: NostrEvent) => void>>();

  async connect(url: string): Promise<void> {
    const normalised = url.replace(/\/$/, '');
    if (this.sockets.has(normalised)) {
      const existing = this.sockets.get(normalised)!;
      if (existing.readyState === WebSocket.OPEN) return;
      // Stale socket, clean up
      try { existing.close(); } catch { /* ignore */ }
      this.sockets.delete(normalised);
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(normalised);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Relay connection timeout: ${normalised}`));
      }, 10_000);

      ws.onopen = () => {
        clearTimeout(timer);
        this.sockets.set(normalised, ws);
        console.log(`[nostr-mcp] Connected to relay: ${normalised}`);
        resolve();
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string);
          // Log OK / NOTICE / EOSE so we can see relay accept/reject decisions
          if (Array.isArray(data) && (data[0] === 'OK' || data[0] === 'NOTICE')) {
            console.log(`[nostr-mcp] relay msg: ${JSON.stringify(data).slice(0, 200)}`);
          }
          // ["EVENT", subId, event]
          if (Array.isArray(data) && data[0] === 'EVENT' && data[2]) {
            const nostrEvent = data[2] as NostrEvent;
            const subId = data[1] as string;
            const handlers = this.subHandlers.get(subId) || [];
            for (const h of handlers) {
              try { h(nostrEvent); } catch { /* swallow handler errors */ }
            }
          }
        } catch {
          // Ignore OK, EOSE, NOTICE etc.
        }
      };

      ws.onerror = () => {
        clearTimeout(timer);
        this.sockets.delete(normalised);
        reject(new Error(`Relay connection failed: ${normalised}`));
      };

      ws.onclose = (e) => {
        // Normal closes (1000) are expected; surface abnormal ones for debugging.
        if (e.code !== 1000) {
          console.warn(`[nostr-mcp] relay ${normalised} closed unexpectedly: code=${e.code} reason=${e.reason}`);
        }
        this.sockets.delete(normalised);
      };
    });
  }

  async connectAll(urls: string[]): Promise<void> {
    const results = await Promise.allSettled(urls.map(u => this.connect(u)));
    const connected = results.filter(r => r.status === 'fulfilled').length;
    if (connected === 0) {
      throw new Error(`Failed to connect to any relay: ${urls.join(', ')}`);
    }
    console.log(`[nostr-mcp] Connected to ${connected}/${urls.length} relays`);
  }

  broadcast(payload: unknown): void {
    const msg = JSON.stringify(payload);
    for (const [url, ws] of this.sockets) {
      // @ts-ignore - readyState exists on WebSocket
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch (e: any) { console.warn(`[nostr-mcp] send to ${url} failed: ${e?.message || e}`); }
      }
    }
  }

  subscribe(
    subId: string,
    filters: Record<string, unknown>[],
    onEvent: (event: NostrEvent) => void,
  ): void {
    if (!this.subHandlers.has(subId)) {
      this.subHandlers.set(subId, []);
    }
    this.subHandlers.get(subId)!.push(onEvent);
    // Send REQ to all connected relays
    this.broadcast(['REQ', subId, ...filters]);
  }

  unsubscribe(subId: string): void {
    this.subHandlers.delete(subId);
    this.broadcast(['CLOSE', subId]);
  }

  disconnect(): void {
    for (const [, ws] of this.sockets) {
      try { ws.close(); } catch { /* ignore */ }
    }
    this.sockets.clear();
    this.subHandlers.clear();
  }
}

// ─── Nostr MCP Client ──────────────────────────────────────────

class NostrMCPClient {
  private relayPool = new RelayPool();
  private connections = new Map<string, NostrMCPConnection>();
  private nextId = 1;
  private clientSecretKey: Uint8Array;
  private clientPubkey: string;

  // Per-server pending request tracking
  private pendingRequests = new Map<string, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private serverHexKeys = new Map<string, string>();

  private globalSubId: string | null = null;
  private connectedServerIds: string[] = [];

  constructor(privateKeyHex?: string) {
    this.clientSecretKey = privateKeyHex
      ? hexToBytes(privateKeyHex)
      : generateSecretKey();
    this.clientPubkey = getPublicKey(this.clientSecretKey);
    console.log(`[nostr-mcp] Client identity: ${this.clientPubkey.slice(0, 16)}...`);
  }

  private getId(): number {
    return this.nextId++;
  }

  /**
   * Wrap a JSON-RPC message and publish to relays.
   *
   * ContextVM / @contextvm/sdk uses a SINGLE-layer gift-wrap (not the full
   * 3-layer NIP-59 rumor→seal→wrap that nostr-tools' wrapEvent produces).
   * Format the gateway expects:
   *   1. inner signed event (kind 25910) whose content IS the JSON-RPC message
   *   2. NIP-44 encrypt(JSON.stringify(innerEvent)) with a one-time random key
   *   3. wrap that ciphertext in a kind 1059 gift-wrap signed by the random key
   * The gateway decrypts exactly one NIP-44 layer and JSON.parses the result
   * as the inner event, then reads inner.content as the MCP message.
   */
  private async publishToServer(
    serverHex: string,
    message: JSONRPCRequest | JSONRPCNotification,
  ): Promise<void> {
    // 1. Build & sign the inner event that carries the MCP payload as plaintext.
    const innerEvent = finalizeEvent(
      {
        kind: CTXVM_MESSAGES_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', serverHex]],
        content: JSON.stringify(message),
      } as EventTemplate,
      this.clientSecretKey,
    );

    // 2. One-time gift-wrap key. NIP-44 encrypt the whole signed inner event.
    const giftWrapKey = generateSecretKey();
    const conversationKey = nip44.v2.utils.getConversationKey(giftWrapKey, serverHex);
    const encryptedContent = nip44.v2.encrypt(
      JSON.stringify(innerEvent),
      conversationKey,
    );

    // 3. Build & sign the kind 1059 gift-wrap.
    const giftWrap = finalizeEvent(
      {
        kind: GIFT_WRAP_KIND,
        content: encryptedContent,
        tags: [['p', serverHex]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: getPublicKey(giftWrapKey),
      } as EventTemplate,
      giftWrapKey,
    );

    this.relayPool.broadcast(['EVENT', giftWrap]);
  }

  /**
   * Try to unwrap an incoming gift-wrap event (single-layer, matching the
   * @contextvm/sdk format). Returns the inner signed event whose `.content`
   * is the JSON-RPC message, or null if unwrapping fails.
   */
  private tryUnwrap(event: NostrEvent): NostrEvent | null {
    try {
      // NIP-44 decrypt the gift-wrap content using our private key + the
      // gift-wrap's (random) pubkey.
      const conversationKey = nip44.v2.utils.getConversationKey(
        this.clientSecretKey,
        event.pubkey,
      );
      const decryptedJson = nip44.v2.decrypt(event.content, conversationKey);
      const innerEvent = JSON.parse(decryptedJson) as NostrEvent;
      // Verify the inner event's signature (the sender signed it with their key).
      if (!verifyEvent(innerEvent)) return null;
      return innerEvent;
    } catch {
      return null;
    }
  }

  /** Connect to a Nostr MCP server: initialize → discover tools. */
  async connect(config: NostrMCPServerConfig): Promise<NostrMCPConnection> {
    const conn: NostrMCPConnection = {
      serverId: config.id,
      connected: false,
      tools: [],
    };

    try {
      const serverHex = toHexPubkey(config.serverPubkey);
      this.serverHexKeys.set(config.id, serverHex);

      // Connect to relays
      await this.relayPool.connectAll(config.relayUrls);

      // Ensure we have a single global subscription for all gift-wrap events to us
      if (!this.globalSubId) {
        this.globalSubId = `sub_global_${Date.now()}`;
        this.relayPool.subscribe(
          this.globalSubId,
          [{ kinds: [GIFT_WRAP_KIND], '#p': [this.clientPubkey], limit: 200 }],
          (event) => this.handleIncomingEvent(event),
        );
      }

      this.connectedServerIds.push(config.id);

      // Brief pause for relay subscription to propagate
      await new Promise<void>(r => setTimeout(r, 800));

      // ─── MCP Initialize ───────────────────────────────────
      const initResult = await this.sendRequest(config.id, serverHex, {
        jsonrpc: '2.0',
        id: this.getId(),
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'kvak', version: '1.0.0' },
        },
      });
      conn.serverInfo = (initResult as any)?.serverInfo;

      // Send initialized notification (fire-and-forget)
      await this.publishToServer(serverHex, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });

      // ─── MCP tools/list ───────────────────────────────────
      const toolsResult = await this.sendRequest(config.id, serverHex, {
        jsonrpc: '2.0',
        id: this.getId(),
        method: 'tools/list',
        params: {},
      });
      conn.tools = (toolsResult as any)?.tools || [];

      conn.connected = true;
      console.log(`[nostr-mcp] Connected to ${config.name}: ${conn.tools.length} tools discovered`);
    } catch (e: any) {
      conn.error = `${e.message || String(e)}`;
      console.warn(`[nostr-mcp] Connection failed for ${config.name}:`, conn.error);
    }

    this.connections.set(config.id, conn);
    return conn;
  }

  /** Send a JSON-RPC request and wait for the correlated response. */
  private async sendRequest(
    serverId: string,
    serverHex: string,
    request: JSONRPCRequest,
  ): Promise<unknown> {
    // Set up pending response before publishing (race condition prevention)
    const responsePromise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(`${serverId}:${request.id}`);
        reject(new Error(`Request timed out (${TIMEOUT_MS / 1000}s): ${request.method}`));
      }, TIMEOUT_MS);

      this.pendingRequests.set(`${serverId}:${request.id}`, { resolve, reject, timer });
    });

    // Publish the request
    await this.publishToServer(serverHex, request);

    return responsePromise;
  }

  /** Handle incoming events from the relay subscription. */
  private handleIncomingEvent(event: NostrEvent): void {
    // Only process gift-wrap events
    if (event.kind !== GIFT_WRAP_KIND) return;

    const rumor = this.tryUnwrap(event);
    if (!rumor) return;

    // Verify it's a CTXVM message kind
    if (rumor.kind !== CTXVM_MESSAGES_KIND) return;

    const content = rumor.content;
    if (!content) return;

    let message: JSONRPCResponse;
    try {
      message = JSON.parse(content);
    } catch {
      return; // Not valid JSON-RPC
    }

    // Correlate response to pending request — search all servers
    if (message.id != null) {
      for (const serverId of this.connectedServerIds) {
        const key = `${serverId}:${message.id}`;
        const pending = this.pendingRequests.get(key);
        if (pending) {
          this.pendingRequests.delete(key);
          clearTimeout(pending.timer);
          if (message.error) {
            pending.reject(new Error(`MCP error: ${message.error.message}`));
          } else {
            pending.resolve(message.result);
          }
          return; // Found and resolved
        }
      }
    }
  }

  /** Call a tool on a connected Nostr MCP server. */
  async callTool(
    config: NostrMCPServerConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const serverHex = this.serverHexKeys.get(config.id) || toHexPubkey(config.serverPubkey);

    const result = await this.sendRequest(config.id, serverHex, {
      jsonrpc: '2.0',
      id: this.getId(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });

    // Extract text from MCP content array
    const res = result as any;
    if (res?.content && Array.isArray(res.content)) {
      return res.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }
    if (typeof res === 'string') return res;
    return JSON.stringify(res, null, 2);
  }

  /** Disconnect from a specific server. */
  disconnect(serverId: string): void {
    this.serverHexKeys.delete(serverId);
    this.connections.delete(serverId);
    this.connectedServerIds = this.connectedServerIds.filter(id => id !== serverId);

    // Clear any pending requests for this server
    for (const [key, pending] of this.pendingRequests) {
      if (key.startsWith(`${serverId}:`)) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Disconnected'));
        this.pendingRequests.delete(key);
      }
    }

    // If no more servers, tear down global subscription
    if (this.connectedServerIds.length === 0 && this.globalSubId) {
      this.relayPool.unsubscribe(this.globalSubId);
      this.globalSubId = null;
    }
  }

  /** Get connection state for a server. */
  getConnection(serverId: string): NostrMCPConnection | undefined {
    return this.connections.get(serverId);
  }

  /** Get all discovered tools from all connected Nostr servers. */
  getAllTools(): Array<NostrMCPToolDef & { serverId: string; serverName: string }> {
    const tools: Array<NostrMCPToolDef & { serverId: string; serverName: string }> = [];
    for (const [id, conn] of this.connections) {
      if (conn.connected) {
        for (const tool of conn.tools) {
          tools.push({
            ...tool,
            serverId: id,
            serverName: conn.serverInfo?.name || id,
          });
        }
      }
    }
    return tools;
  }
}

/** Singleton Nostr MCP client. Generates a random Nostr identity on first use. */
export const nostrMcpClient = new NostrMCPClient();

// ─── Server Discovery ─────────────────────────────────────────

/** A ContextVM server discovered from a kind 11316 announcement. */
export interface DiscoveredServer {
  /** Server Nostr pubkey (hex). Add this as a server's pubkey to connect. */
  pubkey: string;
  name: string;
  about?: string;
  website?: string;
  /** A relay the announcement was seen on — a reasonable relay to connect through. */
  relayUrl: string;
  createdAt: number;
}

/**
 * Discover ContextVM servers by querying kind 11316 announcement events.
 *
 * Runs a one-shot REQ against the given relays (defaults to the SDK's bootstrap
 * relays), collects announcements for `timeoutMs`, dedups by pubkey keeping
 * the newest, and returns the list. Does NOT touch the running nostrMcpClient
 * or its relay pool.
 */
export async function discoverServers(
  relayUrls: string[] = DISCOVERY_RELAYS,
  timeoutMs = 8000,
): Promise<DiscoveredServer[]> {
  const byPubkey = new Map<string, DiscoveredServer>();
  const sockets: WebSocket[] = [];
  const subId = `discover_${Date.now()}`;

  for (const url of relayUrls) {
    try {
      const ws = new WebSocket(url);
      sockets.push(ws);
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(['REQ', subId, { kinds: [SERVER_ANNOUNCEMENT_KIND], limit: 200 }]));
        } catch { /* ignore */ }
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string);
          if (!Array.isArray(data) || data[0] !== 'EVENT' || data[2]?.kind !== SERVER_ANNOUNCEMENT_KIND) return;
          const e = data[2];
          const tagVal = (k: string) => e.tags?.find((t: string[]) => t[0] === k)?.[1];
          const existing = byPubkey.get(e.pubkey);
          // Addressable event: keep the newest per pubkey.
          if (existing && existing.createdAt >= e.created_at) return;
          byPubkey.set(e.pubkey, {
            pubkey: e.pubkey,
            name: tagVal('name') || e.pubkey.slice(0, 12) + '…',
            about: tagVal('about'),
            website: tagVal('website'),
            relayUrl: url,
            createdAt: e.created_at,
          });
        } catch { /* ignore malformed */ }
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch {
      // bad relay URL — skip
    }
  }

  // Wait for results to accumulate, then close everything.
  await new Promise<void>(r => setTimeout(r, timeoutMs));
  for (const ws of sockets) { try { ws.close(); } catch {} }

  return Array.from(byPubkey.values()).sort((a, b) => b.createdAt - a.createdAt);
}
