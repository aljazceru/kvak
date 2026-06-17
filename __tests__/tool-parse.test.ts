/**
 * Regression tests for tool-call parsing.
 *
 * These import tool-parse.ts directly (not tools.ts) because tools.ts pulls in
 * nostr-tools (ESM @noble), which the default RN jest preset does not transform.
 * The risky logic — brace-balanced extraction + tolerant JSON repair — lives in
 * the pure module, so testing it in isolation is both sufficient and reliable.
 */
import { extractToolCalls, parseToolArgs } from '../src/services/tool-parse';

describe('extractToolCalls — brace-balanced extraction', () => {
  it('extracts a simple tool call', () => {
    const calls = extractToolCalls('Use this: [TOOL: weather {"location":"Paris"}] done');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('weather');
    expect(calls[0].argsRaw).toBe('{"location":"Paris"}');
  });

  // The headline regression: the old regex `(\{[^}]*\})` truncated here.
  it('does NOT truncate on a `}` inside a string value', () => {
    const calls = extractToolCalls('[TOOL: search {"query":"foo}bar"}]');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('search');
    expect(calls[0].argsRaw).toBe('{"query":"foo}bar"}');
  });

  it('handles arbitrarily nested objects in args', () => {
    const calls = extractToolCalls('[TOOL: remote {"opts":{"a":1,"b":{"c":2}}}]');
    expect(calls).toHaveLength(1);
    expect(calls[0].argsRaw).toBe('{"opts":{"a":1,"b":{"c":2}}}');
  });

  it('extracts multiple tool calls in one response', () => {
    const calls = extractToolCalls(
      '[TOOL: datetime {}] then [TOOL: calculator {"expression":"2+2"}]',
    );
    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe('datetime');
    expect(calls[0].argsRaw).toBe('{}');
    expect(calls[1].name).toBe('calculator');
    expect(calls[1].argsRaw).toBe('{"expression":"2+2"}');
  });

  it('tolerates whitespace between marker, name, and braces', () => {
    const calls = extractToolCalls('[TOOL:   weather\t {"location":"NYC"}]');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('weather');
  });

  it('ignores a marker whose braces never close (unbalanced)', () => {
    const calls = extractToolCalls('text [TOOL: foo {"a":1 without close');
    expect(calls).toHaveLength(0);
  });

  it('ignores a marker that is never terminated by ]', () => {
    const calls = extractToolCalls('[TOOL: foo {"a":1} but no bracket');
    expect(calls).toHaveLength(0);
  });

  it('reports correct start/end indices for span removal', () => {
    const src = 'ab [TOOL: datetime {}] cd';
    const calls = extractToolCalls(src);
    expect(calls).toHaveLength(1);
    // The reported span must cover exactly the marker text — reconstructing
    // must remove `[TOOL: datetime {}]` verbatim (surrounding spaces stay).
    expect(src.slice(calls[0].start, calls[0].end)).toBe('[TOOL: datetime {}]');
    expect(src.slice(0, calls[0].start) + src.slice(calls[0].end)).toBe('ab  cd');
  });
});

describe('parseToolArgs — tolerant JSON repair', () => {
  it('parses strict JSON', () => {
    expect(parseToolArgs('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
  });

  it('quotes unquoted keys', () => {
    expect(parseToolArgs('{message: "hi"}')).toEqual({ message: 'hi' });
  });

  it('quotes unquoted string values', () => {
    expect(parseToolArgs('{"k": banana}')).toEqual({ k: 'banana' });
  });

  it('leaves true/false/null unquoted', () => {
    expect(parseToolArgs('{"a": true, "b": false, "c": null}')).toEqual({
      a: true, b: false, c: null,
    });
  });

  it('strips trailing commas', () => {
    expect(parseToolArgs('{"a":1,}')).toEqual({ a: 1 });
  });

  it('returns {} on garbage', () => {
    expect(parseToolArgs('not even close')).toEqual({});
  });

  it('preserves a value containing a brace (paired with the extractor)', () => {
    const calls = extractToolCalls('[TOOL: search {"query":"a}b"}]');
    expect(parseToolArgs(calls[0].argsRaw)).toEqual({ query: 'a}b' });
  });
});
