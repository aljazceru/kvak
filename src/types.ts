/**
 * Mango × QVAC — Type definitions
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  isError?: boolean;
}

export interface ToolCall {
  name: string;
  args: string;
  result: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  toolsEnabled: boolean;
  createdAt: number;
  updatedAt: number;
  systemPrompt?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  quant: string;
  sizeMB: number;
  description: string;
  url: string;
  filename: string;
  template: string;
}

export interface WhisperModelInfo {
  id: string;
  name: string;
  sizeMB: number;
  description: string;
  url: string;
  filename: string;
}

export interface DeviceInfo {
  totalRamMB: number;
  freeStorageGB: number;
  maxModelMB: number;
  device: string;
  cores: number;
}

export interface DownloadProgress {
  pct: number;
  downloaded: number;
  total: number;
}

export type Screen = 'conversations' | 'chat' | 'settings' | 'model_picker';

// ─── MCP (HTTP/SSE) ────────────────────────────────────────────────

export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  enabled: boolean;
}

export interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface MCPTool extends MCPToolDef {
  serverId: string;
  serverName: string;
}

// Nostr MCP server config lives in services/nostr-mcp.ts (NostrMCPServerConfig).
// MCPServerConfig above is the HTTP variant.
