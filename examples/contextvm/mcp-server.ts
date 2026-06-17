// Test MCP server for the ContextVM e2e: exposes `echo` and `add` tools over stdio.
// Run via the gateway (see gateway.ts). Requires @modelcontextprotocol/sdk + zod.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'kvak-test-server', version: '1.0.0' });

server.registerTool(
  'echo',
  { description: 'Echo back the provided message', inputSchema: { message: z.string() } },
  async ({ message }) => ({ content: [{ type: 'text', text: `echo: ${message}` }] }),
);

server.registerTool(
  'add',
  { description: 'Add two numbers', inputSchema: { a: z.number(), b: z.number() } },
  async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
);

await server.connect(new StdioServerTransport());
console.error('[test-mcp-server] ready: echo, add');
