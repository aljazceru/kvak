/**
 * Kvak — Tool definitions & execution
 * Built-in tools + MCP remote tool routing (HTTP + Nostr).
 */
import type { ToolCall, MCPServerConfig } from '../types';
import { mcpClient } from './mcp';
import { nostrMcpClient } from './nostr-mcp';
import type { NostrMCPServerConfig } from './nostr-mcp';
import { extractToolCalls, parseToolArgs } from './tool-parse';

// ─── Built-in Tools ────────────────────────────────────────────────

export const TOOLS: Record<string, (args: Record<string, any>) => string> = {
  calculator: (a) => {
    try {
      const expr = (a.expression || '').replace(/[^0-9+\-*/.()% ]/g, '');
      if (!expr) return 'Error: empty expression';
      // ponytail: expr is sanitized to digits/operators above; safe to eval via Function.
      // eslint-disable-next-line no-new-func
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

  prompt += `\nWhen you need to use a tool, output *exactly and only* one line in the format [TOOL: tool_name {"param":"value"}] with nothing else before or after it (no "searching the web...", no explanations, no extra text). After a tool result is provided in the next turn, give the final answer naturally.`;
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

  // Extract tool calls with brace-balanced scanning so args containing `}`
  // (nested objects, strings with closing braces) are not truncated — the old
  // regex `(\{[^}]*\})` stopped at the first `}` and corrupted real MCP calls.
  const rawCalls = extractToolCalls(response);
  for (const rc of rawCalls) {
    try {
      // Small on-device models frequently emit nearly-valid JSON with unquoted
      // keys or unquoted string values (e.g. {message:banana} or {a: 5}). Try
      // strict parse first, then fall back to a tolerant repair so legitimate
      // tool calls still execute instead of being silently dropped.
      const args = parseToolArgs(rc.argsRaw);

      let result: string;

      // Check Nostr MCP first (more specific)
      const nostrServer = nostrToolMap.get(rc.name);
      if (nostrServer) {
        try {
          result = await nostrMcpClient.callTool(nostrServer, rc.name, args);
        } catch (e: any) {
          result = `Error (Nostr): ${e.message || String(e)}`;
        }
      } else {
        // Then HTTP MCP
        const mcpServer = mcpToolMap.get(rc.name);
        if (mcpServer) {
          try {
            result = await mcpClient.callTool(mcpServer, rc.name, args);
          } catch (e: any) {
            result = `Error (HTTP MCP): ${e.message || String(e)}`;
          }
        } else {
          // Built-in tool
          const fn = TOOLS[rc.name];
          if (fn) {
            result = fn(args);
          } else {
            continue; // unknown tool, skip (marker still stripped below)
          }
        }
      }

      toolCalls.push({ name: rc.name, args: rc.argsRaw, result });
    } catch { /* ignore malformed tool calls */ }
  }

  // Remove every extracted tool-call span from the visible text (reverse order
  // so earlier indices stay valid), then strip any leftover malformed markers
  // so raw tool-call syntax never leaks into the chat.
  for (let i = rawCalls.length - 1; i >= 0; i--) {
    const rc = rawCalls[i];
    cleaned = cleaned.slice(0, rc.start) + cleaned.slice(rc.end);
  }
  cleaned = cleaned.replace(/\[TOOL:\s*[^\]]*\]/g, '').trim();

  // Strip common "thinking" / tool-planning text that small models emit *before*
  // the [TOOL] marker (e.g. "searching the web for information on agorism",
  // "I will use the search tool to find...", "Let me look that up...").
  // This keeps the final assistant content clean and focused on the actual answer.
  cleaned = cleaned.replace(
    /^\s*(?:(?:[Ii]\s*(?:am|will|need to|should|have to|am going to)?\s*)?(?:search|searching|use|using|call|calling|query|querying|look|looking|check|checking|retriev|retrieving|find|finding|let me).*?(?:[\.\!\?\n]|$))+/i,
    ''
  ).trim();

  // Also strip any echoed RAG context prefixes that the model might repeat into its reply
  // (RAG is injected in system prompt; we don't want Source "xx": ... or "Additional context..." blocks in user output).
  cleaned = cleaned.replace(
    /^(?:Additional context from the user's private documents|Source "[^"]+":\s*.*?\n?|Use (?:the|this) (?:above |additional )?context|Relevant context from your documents)+/i,
    ''
  ).trim();

  // Empty content is valid (e.g. model emitted only tool calls); the UI hides an empty bubble.
  return { cleaned, toolCalls: toolCalls.length ? toolCalls : [] };
}

// parseToolArgs + extractToolCalls live in ./tool-parse (pure, unit-tested).
