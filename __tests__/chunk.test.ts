/**
 * Regression for the RAG chunker. The old advance `i = max(end - overlap, i + 1)`
 * collapsed to i+1 when a chunk was shorter than `overlap`, emitting one chunk
 * per character for any document under 100 chars.
 */
import { chunkText } from '../src/state';

// chunkText was hoisted to module scope so it can be exercised directly.

describe('chunkText behaviour', () => {
  it('short text (< overlap) yields exactly ONE chunk, not one per char', () => {
    const short = 'The access code is Kvak2042.'; // 28 chars, < 100 overlap
    expect(chunkText(short)).toHaveLength(1);
    expect(chunkText(short)[0]).toBe('The access code is Kvak2042.');
  });

  it('returns the whole text as a single chunk when under maxChars', () => {
    const t = 'a'.repeat(500);
    expect(chunkText(t)).toHaveLength(1);
  });

  it('long text produces multiple overlapping chunks', () => {
    const t = 'a'.repeat(2000); // maxChars 800, overlap 100
    const chunks = chunkText(t);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800);
  });

  it('empty/whitespace falls back to [text]', () => {
    expect(chunkText('   ')).toEqual(['   ']);
  });
});
