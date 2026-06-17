/**
 * Pure tool-call parsing — no native/MCP/Nostr deps, safe to unit-test under jest.
 *
 * Extracted from tools.ts because the rest of that module pulls in nostr-tools
 * (ESM @noble), which breaks jest. The risky logic — brace-balanced extraction
 * and tolerant JSON repair — lives here where it can be regression-tested.
 */

export interface RawToolCall {
  name: string;
  /** The raw argument substring, e.g. `{"location":"Paris"}`. */
  argsRaw: string;
  /** Start index of the `[` in the source string. */
  start: number;
  /** Index just past the closing `]`. */
  end: number;
}

/**
 * Extract `[TOOL: name {...}]` calls from a model response using brace-balanced
 * scanning, so argument JSON containing `}` (nested objects, or strings holding
 * a closing brace) is NOT truncated.
 *
 * The previous regex `(\{[^}]*\})` stopped at the first `}` and corrupted real
 * remote (MCP) tool calls, then leaked mangled `[TOOL:` syntax into the chat.
 * Braces inside JSON string literals are ignored, matching how a real parser
 * reads the body.
 */
export function extractToolCalls(response: string): RawToolCall[] {
  const calls: RawToolCall[] = [];
  const marker = '[TOOL:';
  let searchFrom = 0;

  while (searchFrom < response.length) {
    const start = response.indexOf(marker, searchFrom);
    if (start === -1) break;

    let p = start + marker.length;
    // skip whitespace between marker and name
    while (p < response.length && /\s/.test(response[p])) p++;
    const nameStart = p;
    while (p < response.length && /\w/.test(response[p])) p++;
    const name = response.slice(nameStart, p);
    if (!name) { searchFrom = start + marker.length; continue; }

    // skip whitespace between name and `{`
    while (p < response.length && /\s/.test(response[p])) p++;
    if (response[p] !== '{') { searchFrom = start + marker.length; continue; }

    // brace-balanced scan, respecting string literals
    let depth = 0;
    let inStr: '' | '"' | "'" = '';
    let escape = false;
    const argsStart = p;
    let argsEnd = -1;
    for (; p < response.length; p++) {
      const ch = response[p];
      if (inStr) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === inStr) inStr = '';
      } else if (ch === '"' || ch === "'") {
        inStr = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) { argsEnd = p; p++; break; }
        if (depth < 0) break; // malformed: more closes than opens
      }
    }
    if (argsEnd === -1) { searchFrom = start + marker.length; continue; } // unbalanced

    const argsRaw = response.slice(argsStart, argsEnd + 1);

    // skip whitespace, then expect the closing `]`
    while (p < response.length && /\s/.test(response[p])) p++;
    if (response[p] !== ']') { searchFrom = start + marker.length; continue; }
    p++; // consume `]`

    calls.push({ name, argsRaw, start, end: p });
    searchFrom = p;
  }
  return calls;
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
export function parseToolArgs(raw: string): Record<string, any> {
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
