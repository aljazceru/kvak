/**
 * Mango × QVAC — MCP (Model Context Protocol) Client
 *
 * Connects to remote MCP servers, discovers tools, and executes them.
 * Supports both Streamable HTTP and SSE transports with auto-detection.
 *
 * Protocol: JSON-RPC 2.0 over HTTP (MCP spec 2025-03-26)
 */
import type { MCPServerConfig, MCPToolDef } from '../types';

const MCP_PROTOCOL_VERSION = '2025-03-26';
const TIMEOUT_MS = 30000;

// ─── JSON-RPC Types ────────────────────────────────────────────────

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// ─── SSE Parser ────────────────────────────────────────────────────

class SSEParser {
  private buffer = '';

  /** Feed a chunk of text, return complete events. */
  parse(chunk: string): Array<{ event: string; data: string }> {
    this.buffer += chunk;
    const results: Array<{ event: string; data: string }> = [];

    while (true) {
      const idx = this.buffer.indexOf('\n\n');
      if (idx === -1) break;

      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);

      let event = '';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim();
      }
      if (data) results.push({ event, data });
    }

    return results;
  }

  reset() { this.buffer = ''; }
}

// ─── SSE Transport ─────────────────────────────────────────────────

class SSETransport {
  private xhr: XMLHttpRequest | null = null;
  private messageUrl = '';
  private baseUrl = '';
  private headers: Record<string, string> = {};
  private parser = new SSEParser();
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  async connect(url: string, headers: Record<string, string>): Promise<void> {
    this.baseUrl = url;
    this.headers = headers;

    return new Promise((resolve, reject) => {
      this.xhr = new XMLHttpRequest();
      this.xhr.open('GET', url, true);
      this.xhr.setRequestHeader('Accept', 'text/event-stream');
      Object.entries(headers).forEach(([k, v]) => this.xhr!.setRequestHeader(k, v));

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('SSE connection timed out')); }
      }, TIMEOUT_MS);

      this.xhr.onprogress = () => {
        if (!this.xhr) return;
        // Use incremental parsing
        const prevLen = (this as any)._lastLen || 0;
        const chunk = this.xhr.responseText.slice(prevLen);
        (this as any)._lastLen = this.xhr.responseText.length;

        const events = this.parser.parse(chunk);

        for (const ev of events) {
          if (ev.event === 'endpoint' && ev.data) {
            // Resolve message URL (may be relative)
            this.messageUrl = ev.data.startsWith('http')
              ? ev.data
              : this.baseUrl.replace(/\/sse$/, '') + ev.data;
            if (!settled) { settled = true; clearTimeout(timer); resolve(); }
            continue;
          }

          // JSON-RPC response
          if (ev.data) {
            try {
              const json: JSONRPCResponse = JSON.parse(ev.data);
              if (json.id != null && this.pending.has(json.id)) {
                const { resolve: res, reject: rej, timer: t } = this.pending.get(json.id)!;
                this.pending.delete(json.id);
                clearTimeout(t);
                if (json.error) rej(new Error(json.error.message));
                else res(json.result);
              }
            } catch { /* ignore non-JSON SSE data */ }
          }
        }
      };

      this.xhr.onerror = () => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(new Error('SSE connection failed')); }
      };

      this.xhr.send();
    });
  }

  async send(request: JSONRPCRequest): Promise<any> {
    if (!this.messageUrl) throw new Error('SSE not connected');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error('MCP request timed out'));
      }, TIMEOUT_MS);

      this.pending.set(request.id, { resolve, reject, timer });

      fetch(this.messageUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify(request),
      }).catch(err => {
        this.pending.delete(request.id);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async sendNotification(notification: JSONRPCNotification): Promise<void> {
    if (!this.messageUrl) return;
    try {
      await fetch(this.messageUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify(notification),
      });
    } catch { /* notifications are fire-and-forget */ }
  }

  close() {
    this.xhr?.abort();
    this.xhr = null;
    this.parser.reset();
    (this as any)._lastLen = 0;
    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(new Error('Connection closed'));
    }
    this.pending.clear();
  }
}

// ─── HTTP Transport ────────────────────────────────────────────────

class HTTPTransport {
  constructor(
    private url: string,
    private headers: Record<string, string>,
  ) {}

  async send(request: JSONRPCRequest | JSONRPCNotification): Promise<any> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', this.url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'application/json, text/event-stream');
      Object.entries(this.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

      const timer = setTimeout(() => { xhr.abort(); reject(new Error('Request timed out')); }, TIMEOUT_MS);

      xhr.onload = () => {
        clearTimeout(timer);
        if (xhr.status === 204) { resolve(null); return; }
        if (xhr.status >= 400) { reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`)); return; }

        const contentType = xhr.getResponseHeader('content-type') || '';

        if (contentType.includes('text/event-stream')) {
          const parser = new SSEParser();
          const events = parser.parse(xhr.responseText);
          for (const ev of events) {
            if (ev.data) {
              try {
                const json = JSON.parse(ev.data);
                if (json.error) { reject(new Error(json.error.message)); return; }
                resolve(json.result);
                return;
              } catch (e) {
                if (e instanceof Error && e.message.startsWith('MCP')) { reject(e); return; }
              }
            }
          }
          reject(new Error('No valid response in SSE stream'));
          return;
        }

        try {
          const json = JSON.parse(xhr.responseText);
          if (json.error) { reject(new Error(`MCP error: ${json.error.message}`)); return; }
          resolve(json.result);
        } catch {
          reject(new Error(`Failed to parse response: ${xhr.responseText.slice(0, 200)}`));
        }
      };

      xhr.onerror = () => { clearTimeout(timer); reject(new Error(`Network error connecting to ${this.url}`)); };
      xhr.ontimeout = () => { clearTimeout(timer); reject(new Error('Request timed out')); };

      xhr.send(JSON.stringify(request));
    });
  }
}

// ─── MCP Client ────────────────────────────────────────────────────

export interface MCPConnection {
  serverId: string;
  connected: boolean;
  tools: MCPToolDef[];
  serverInfo?: { name: string; version: string };
  error?: string;
}

type Transport = { type: 'http'; http: HTTPTransport } | { type: 'sse'; sse: SSETransport };

class MCPClient {
  private transports = new Map<string, Transport>();
  private connections = new Map<string, MCPConnection>();
  private nextId = 1;

  private getId(): number { return this.nextId++; }

  /** Build auth headers from config. */
  private headers(config: MCPServerConfig): Record<string, string> {
    const h: Record<string, string> = {};
    if (config.apiKey) h['Authorization'] = `Bearer ${config.apiKey}`;
    return h;
  }

  /** Connect to an MCP server: initialize → discover tools. */
  async connect(config: MCPServerConfig): Promise<MCPConnection> {
    const conn: MCPConnection = { serverId: config.id, connected: false, tools: [] };

    try {
      const url = config.url.replace(/\/$/, '');
      const headers = this.headers(config);
      let transport: Transport;

      // Auto-detect transport: SSE endpoint vs direct HTTP
      if (url.endsWith('/sse')) {
        const sse = new SSETransport();
        await sse.connect(url, headers);
        transport = { type: 'sse', sse };

        // Initialize via SSE
        const initResult = await sse.send({
          jsonrpc: '2.0', id: this.getId(), method: 'initialize',
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'mango-qvac', version: '1.0.0' },
          },
        });
        conn.serverInfo = initResult?.serverInfo;

        // Send initialized notification
        await sse.sendNotification({
          jsonrpc: '2.0', method: 'notifications/initialized',
        });

        // List tools
        const toolsResult = await sse.send({
          jsonrpc: '2.0', id: this.getId(), method: 'tools/list', params: {},
        });
        conn.tools = toolsResult?.tools || [];
      } else {
        // Streamable HTTP transport
        const http = new HTTPTransport(url, headers);
        transport = { type: 'http', http };

        const initResult = await http.send({
          jsonrpc: '2.0', id: this.getId(), method: 'initialize',
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'mango-qvac', version: '1.0.0' },
          },
        });
        conn.serverInfo = initResult?.serverInfo;

        // Send initialized notification
        await http.send({
          jsonrpc: '2.0', method: 'notifications/initialized',
        });

        // List tools
        const toolsResult = await http.send({
          jsonrpc: '2.0', id: this.getId(), method: 'tools/list', params: {},
        });
        conn.tools = toolsResult?.tools || [];
      }

      conn.connected = true;
      this.transports.set(config.id, transport);
    } catch (e: any) {
      conn.error = `${e.message || String(e)} (${e.constructor?.name || 'Error'})`;
    }

    this.connections.set(config.id, conn);
    return conn;
  }

  /** Call a tool on a connected MCP server. */
  async callTool(config: MCPServerConfig, toolName: string, args: Record<string, any>): Promise<string> {
    const transport = this.transports.get(config.id);
    if (!transport) throw new Error(`Not connected to server ${config.name}`);

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.getId(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    };

    let result: any;
    if (transport.type === 'sse') {
      result = await transport.sse.send(request);
    } else {
      result = await transport.http.send(request);
    }

    // Extract text from MCP content array
    if (result?.content && Array.isArray(result.content)) {
      return result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }
    if (typeof result === 'string') return result;
    return JSON.stringify(result, null, 2);
  }

  /** Disconnect from a server. */
  disconnect(serverId: string) {
    const transport = this.transports.get(serverId);
    if (transport?.type === 'sse') transport.sse.close();
    this.transports.delete(serverId);
    this.connections.delete(serverId);
  }

  /** Get connection state for a server. */
  getConnection(serverId: string): MCPConnection | undefined {
    return this.connections.get(serverId);
  }

  /** Get all discovered tools from all connected servers. */
  getAllTools(): Array<MCPToolDef & { serverId: string; serverName: string }> {
    const tools: Array<MCPToolDef & { serverId: string; serverName: string }> = [];
    for (const [id, conn] of this.connections) {
      if (conn.connected) {
        for (const tool of conn.tools) {
          tools.push({ ...tool, serverId: id, serverName: conn.serverInfo?.name || id });
        }
      }
    }
    return tools;
  }
}

/** Singleton MCP client. */
export const mcpClient = new MCPClient();
