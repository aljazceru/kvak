/**
 * SSEParser is the pure heart of the MCP SSE transport — it frames
 * `event:`/`data:` lines out of a byte stream. Tested in isolation because the
 * surrounding transport is XHR/fetch driven.
 */
import { SSEParser } from '../src/services/mcp';

describe('SSEParser', () => {
  it('parses one complete event', () => {
    const p = new SSEParser();
    expect(p.parse('event: endpoint\ndata: /messages\n\n')).toEqual([
      { event: 'endpoint', data: '/messages' },
    ]);
  });

  it('parses multiple events in a single chunk', () => {
    const p = new SSEParser();
    const evs = p.parse('data: one\n\nevent: x\ndata: two\n\n');
    expect(evs).toEqual([
      { event: '', data: 'one' },
      { event: 'x', data: 'two' },
    ]);
  });

  it('joins multiple data: lines with a newline', () => {
    const p = new SSEParser();
    expect(p.parse('data: line1\ndata: line2\n\n')[0].data).toBe('line1\nline2');
  });

  it('buffers a partial event until the blank-line terminator arrives', () => {
    const p = new SSEParser();
    expect(p.parse('event: p\ndata: par')).toEqual([]); // not terminated yet
    expect(p.parse('t\n\n')).toEqual([{ event: 'p', data: 'part' }]);
  });

  it('drops event blocks that carry no data', () => {
    const p = new SSEParser();
    expect(p.parse('event: empty\n\n')).toEqual([]);
  });

  it('reset() discards buffered partial data', () => {
    const p = new SSEParser();
    p.parse('event: p\ndata: partial'); // no terminator
    p.reset();
    expect(p.parse('data: more\n\n')).toEqual([{ event: '', data: 'more' }]);
  });
});
