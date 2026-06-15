/**
 * Mango × QVAC — Tool definitions & execution
 * Built-in tools + MCP remote tool routing (HTTP + Nostr).
 */
import type { ToolCall, MCPServerConfig, UnifiedMCPServerConfig } from '../types';
import { mcpClient } from './mcp';
import { nostrMcpClient } from './nostr-mcp';
import type { NostrMCPServerConfig } from './nostr-mcp';

// ─── Built-in Tools ────────────────────────────────────────────────

export const TOOLS: Record<string, (args: Record<string, any>) => string> = {
  calculator: (a) => {
    try {
      const expr = (a.expression || '').replace(/[^0-9+\-*/.()% ]/g, '');
      if (!expr) return 'Error: empty expression';
      const r = Function('"use strict";return (' + expr + ')')();
      return `Result: ${r}`;
    } catch { return 'Error in calculation'; }
  },
  weather: (a) => {
    const conditions = ['Sunny 22°C', 'Rainy 15°C', 'Cloudy 18°C', 'Partly cloudy 20°C'];
    return `Weather in ${a.location || 'Unknown'}: ${conditions[Math.floor(Math.random() * conditions.length)]}`;
  },
  search: (a) => {
    const q = a.query || 'unknown';
    return `Search results for "${q}":\n1. Wikipedia - ${q}\n2. Latest news about ${q}\n3. ${q} - Reference Guide`;
  },
  datetime: () => new Date().toLocaleString(),
};

// ─── Tool Prompt Generation ────────────────────────────────────────

/** Build the tool-use instruction for the system prompt, including MCP tools. */
export function buildToolPrompt(
  mcpTools: Array<{ name: string; description?: string; inputSchema?: any }>,
): string {
  let prompt = `You can use tools by writing: [TOOL: tool_name {"param":"value"}]\n\nBuilt-in tools:\n`;
  prompt += `- calculator(expression) — Evaluate a math expression\n`;
  prompt += `- weather(location) — Get weather for a location\n`;
  prompt += `- search(query) — Search the web\n`;
  prompt += `- datetime() — Current date and time\n`;

  if (mcpTools.length > 0) {
    prompt += `\nRemote MCP tools:\n`;
    for (const tool of mcpTools) {
      const props = tool.inputSchema?.properties;
      const params = props
        ? Object.entries(props)
            .map(([k, v]: [string, any]) => `${k}: ${v.type || 'string'}`)
            .join(', ')
        : '';
      const req = tool.inputSchema?.required?.length
        ? ` (required: ${tool.inputSchema.required.join(', ')})`
        : '';
      prompt += `- ${tool.name}(${params})${req} — ${tool.description || 'Remote tool'}\n`;
    }
  }

  prompt += `\nUse tools when helpful. After getting a tool result, continue naturally.`;
  return prompt;
}

// ─── Tool Call Processing ──────────────────────────────────────────

/**
 * Extract and execute tool calls from a model response.
 * Handles built-in tools (sync), HTTP MCP tools, and Nostr MCP tools.
 */
export async function processToolCalls(
  response: string,
  toolsEnabled: boolean,
  mcpServers: MCPServerConfig[] = [],
  nostrServers: NostrMCPServerConfig[] = [],
): Promise<{ cleaned: string; toolCalls: ToolCall[] }> {
  const toolCalls: ToolCall[] = [];
  let cleaned = response;

  if (!toolsEnabled) return { cleaned, toolCalls };

  // Build HTTP MCP tool lookup
  const mcpToolMap = new Map<string, MCPServerConfig>();
  for (const server of mcpServers) {
    if (!server.enabled) continue;
    const conn = mcpClient.getConnection(server.id);
    if (conn?.connected) {
      for (const tool of conn.tools) {
        mcpToolMap.set(tool.name, server);
      }
    }
  }

  // Build Nostr MCP tool lookup
  const nostrToolMap = new Map<string, NostrMCPServerConfig>();
  for (const server of nostrServers) {
    if (!server.enabled) continue;
    const conn = nostrMcpClient.getConnection(server.id);
    if (conn?.connected) {
      for (const tool of conn.tools) {
        nostrToolMap.set(tool.name, server);
      }
    }
  }

  const regex = /\[TOOL:\s*(\w+)\s*(\{[^}]*\})\]/g;
  let m;
  while ((m = regex.exec(response)) !== null) {
    try {
      const toolName = m[1];
      // Small on-device models frequently emit nearly-valid JSON with unquoted
      // keys or unquoted string values (e.g. {message:banana} or {a: 5}). Try
      // strict parse first, then fall back to a tolerant repair so legitimate
      // tool calls still execute instead of being silently dropped.
      const args = parseToolArgs(m[2]);

      let result: string;

      // Check Nostr MCP first (more specific)
      const nostrServer = nostrToolMap.get(toolName);
      if (nostrServer) {
        try {
          result = await nostrMcpClient.callTool(nostrServer, toolName, args);
        } catch (e: any) {
          result = `Error (Nostr): ${e.message || String(e)}`;
        }
      } else {
        // Then HTTP MCP
        const mcpServer = mcpToolMap.get(toolName);
        if (mcpServer) {
          try {
            result = await mcpClient.callTool(mcpServer, toolName, args);
          } catch (e: any) {
            result = `Error (HTTP MCP): ${e.message || String(e)}`;
          }
        } else {
          // Built-in tool
          const fn = TOOLS[toolName];
          if (fn) {
            result = fn(args);
          } else {
            continue; // unknown tool, skip
          }
        }
      }

      toolCalls.push({ name: toolName, args: m[2], result });
      cleaned = cleaned.replace(m[0], '');
    } catch { /* ignore malformed tool calls */ }
  }

  // Empty content is valid (e.g. model emitted only tool calls); the UI hides an empty bubble.
  return { cleaned: cleaned.trim(), toolCalls: toolCalls.length ? toolCalls : [] };
}

/**
 * Parse a tool-call argument string into an object.
 *
 * Tries strict JSON first. If that fails, applies a tolerant repair for the
 * common ways small on-device models mangle JSON, then retries:
 *   - unquoted keys:        {message: "x"}    → {"message": "x"}
 *   - unquoted string vals: {"k": banana}     → {"k": "banana"}
 *   - trailing commas:      {"a":1,}          → {"a":1}
 * Returns {} if the string still cannot be parsed.
 */
function parseToolArgs(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through to tolerant repair */
  }
  try {
    let repaired = raw;
    // Quote unquoted keys: `identifier:` → `"identifier":`
    repaired = repaired.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
    // Quote unquoted string values (letters/words not already quoted, not numbers/bools/null)
    repaired = repaired.replace(/(:\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*[,}])/g, (match, pre, val, post) => {
      if (val === 'true' || val === 'false' || val === 'null') return match;
      return `${pre}"${val}"${post}`;
    });
    // Strip trailing commas before } or ]
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(repaired);
  } catch {
    return {};
  }
}
