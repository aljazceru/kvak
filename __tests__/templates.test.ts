import { buildPrompt } from '../src/services/templates';
import type { Message } from '../src/types';

const mk = (role: Message['role'], content: string): Message => ({
  id: Math.random().toString(36).slice(2),
  role,
  content,
});

const convo: Message[] = [
  mk('system', 'SYS'),
  mk('user', 'Hello'),
  mk('assistant', 'Hi there'),
];

describe('buildPrompt — per-template formatting', () => {
  it('llama3: header tokens, eot, ends on assistant header', () => {
    const p = buildPrompt(convo, 'llama3');
    expect(p).toContain('<|start_header_id|>user<|end_header_id|>');
    expect(p).toContain('Hello');
    expect(p).toContain('<|eot_id|>');
    expect(p.endsWith('<|start_header_id|>assistant<|end_header_id|>\n')).toBe(true);
  });

  it('qwen: im_start/im_end, assistant suffix', () => {
    const p = buildPrompt(convo, 'qwen');
    expect(p).toContain('<|im_start|>user\nHello<|im_end|>');
    expect(p.endsWith('<|im_start|>assistant\n')).toBe(true);
  });

  it('phi: Instruct:/Output: turns', () => {
    const p = buildPrompt(convo, 'phi');
    expect(p).toContain('Instruct: Hello\n');
    expect(p).toContain('Output: Hi there\n');
  });

  it('gemma: start_of_turn user/model (system dropped), model suffix', () => {
    const p = buildPrompt(convo, 'gemma');
    expect(p).toContain('<start_of_turn>user\nHello<end_of_turn>');
    expect(p).toContain('<start_of_turn>model\nHi there<end_of_turn>');
    expect(p.endsWith('<start_of_turn>model\n')).toBe(true);
  });

  it('simple: role: content lines, no suffix', () => {
    const p = buildPrompt(convo, 'simple');
    expect(p).toContain('system: SYS\n');
    expect(p).toContain('user: Hello\n');
    // no model-specific control tokens leak into the plain format
    expect(p).not.toContain('<|');
    expect(p).not.toContain('<start_of_turn>');
  });
});

describe('buildPrompt — fallback + ordering', () => {
  it('unknown template falls back to simple', () => {
    const p = buildPrompt(convo, 'totally-unknown');
    expect(p).toContain('user: Hello\n');
    expect(p).toContain('system: SYS\n');
  });

  it('preserves message order', () => {
    const msgs = [mk('user', 'FIRST'), mk('user', 'SECOND')];
    const p = buildPrompt(msgs, 'simple');
    expect(p.indexOf('FIRST')).toBeLessThan(p.indexOf('SECOND'));
  });
});
