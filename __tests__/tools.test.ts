/**
 * Tool execution + prompt building. Built-in handlers are pure; MCP/Nostr are
 * only consulted when a tool name matches a connected server, so built-in paths
 * are exercised without mocking transports.
 */
import { TOOLS, buildToolPrompt, processToolCalls } from '../src/services/tools';

describe('TOOLS.calculator — sanitized eval', () => {
  const calc = TOOLS.calculator;
  it('evaluates plain arithmetic', () => {
    expect(calc({ expression: '2+2' })).toBe('Result: 4');
    expect(calc({ expression: '(1+2)*3' })).toBe('Result: 9');
    expect(calc({ expression: '10/4' })).toBe('Result: 2.5');
    expect(calc({ expression: '7%3' })).toBe('Result: 1');
  });
  it('strips non-arithmetic chars so injected identifiers cannot execute', () => {
    // 'alert(1)' would run code if eval'd raw; here the call is destroyed and
    // only the harmless '1' inside the parens is evaluated.
    expect(calc({ expression: 'alert(1)' })).toBe('Result: 1');
  });
  it('returns an error for empty / non-numeric input', () => {
    // letters are stripped; only truly-empty input hits the "empty" branch,
    // anything that survives sanitization but won't parse hits "in calculation".
    expect(calc({ expression: 'hello world' })).toBe('Error in calculation');
    expect(calc({ expression: '' })).toBe('Error: empty expression');
  });
  it('returns an error for syntactically invalid expressions', () => {
    expect(calc({ expression: '2+' })).toBe('Error in calculation');
  });
  it('is robust to a missing argument', () => {
    expect(calc({})).toBe('Error: empty expression');
  });
});

describe('TOOLS.weather / search / datetime', () => {
  it('weather mentions the location', () => {
    expect(TOOLS.weather({ location: 'Tokyo' })).toMatch(/^Weather in Tokyo:/);
  });
  it('search echoes the query deterministically', () => {
    const out = TOOLS.search({ query: 'agorism' });
    expect(out).toContain('"agorism"');
    // same input → same output (no randomness)
    expect(TOOLS.search({ query: 'agorism' })).toBe(out);
  });
  it('datetime returns a parseable timestamp', () => {
    const out = TOOLS.datetime({});
    expect(new Date(out).toString()).not.toBe('Invalid Date');
  });
});

describe('buildToolPrompt', () => {
  it('lists the built-in tools and the exact-use instruction', () => {
    const p = buildToolPrompt([]);
    expect(p).toContain('calculator(expression)');
    expect(p).toContain('weather(location)');
    expect(p).toContain('search(query)');
    expect(p).toContain('datetime()');
    expect(p).toContain('output *exactly and only*');
  });
  it('documents remote MCP tools with params + required fields', () => {
    const p = buildToolPrompt([
      {
        name: 'get_weather',
        description: 'Fetch weather',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string' }, units: { type: 'string' } },
          required: ['city'],
        },
      },
    ]);
    expect(p).toContain('Remote MCP tools:');
    expect(p).toContain('get_weather(city: string, units: string) (required: city) — Fetch weather');
  });
});

describe('processToolCalls', () => {
  it('is a no-op when tools are disabled', async () => {
    const out = await processToolCalls('[TOOL: calculator {"expression":"2+2"}]', false);
    expect(out.toolCalls).toEqual([]);
    expect(out.cleaned).toBe('[TOOL: calculator {"expression":"2+2"}]');
  });

  it('runs a built-in tool and strips the marker from visible text', async () => {
    const out = await processToolCalls('[TOOL: calculator {"expression":"6*7"}]', true);
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].name).toBe('calculator');
    expect(out.toolCalls[0].result).toBe('Result: 42');
    expect(out.cleaned).toBe(''); // marker removed, nothing else in the turn
  });

  it('removes pre-marker "planning" chatter so it never reaches the chat bubble', async () => {
    const out = await processToolCalls(
      'Let me search for that.\n[TOOL: search {"query":"cats"}]',
      true,
    );
    expect(out.toolCalls[0].name).toBe('search');
    expect(out.cleaned).not.toContain('[TOOL');
    expect(out.cleaned).not.toContain('Let me search');
  });

  it('leaves a normal assistant reply untouched', async () => {
    const out = await processToolCalls('The capital of France is Paris.', true);
    expect(out.toolCalls).toEqual([]);
    expect(out.cleaned).toBe('The capital of France is Paris.');
  });
});
