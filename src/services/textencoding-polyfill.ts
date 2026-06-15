/**
 * TextEncoder / TextDecoder polyfill (UTF-8 only).
 *
 * React Native's Hermes engine (as of RN 0.85) does not provide a global
 * TextDecoder, and only TextEncoder on some builds. nostr-tools — used by the
 * ContextVM (Nostr MCP) integration for NIP-44 encryption — instantiates
 * `new TextDecoder('utf-8')` / `new TextEncoder()` at the top of every module,
 * which throws `ReferenceError: Property 'TextDecoder' doesn't exist` and
 * breaks the entire Nostr MCP code path.
 *
 * This pure-JS UTF-8 implementation is imported FIRST in index.js, before any
 * nostr-tools module loads, so those top-level instantiations succeed.
 *
 * Only UTF-8 is implemented (no other labels), which is all that's required by
 * nostr-tools / @noble. If a native implementation already exists it is kept.
 */

type DecodeOptions = { stream?: boolean };

function utf8Encode(input: string): Uint8Array {
  // JS strings are UTF-16; encode each code point to UTF-8.
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    // Handle surrogate pairs (code points U+10000 and above)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        // Combine surrogate pair into a single code point
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function utf8Decode(input: ArrayBuffer | ArrayBufferView, options?: DecodeOptions): string {
  // options.stream is accepted for API compatibility but treated as stateless
  // (nostr-tools never streams). A trailing partial sequence is dropped.
  void options;
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  let result = '';
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    let byte1 = bytes[i++];
    let code: number;
    let extra: number;

    if (byte1 < 0x80) {
      code = byte1;
      extra = 0;
    } else if ((byte1 & 0xe0) === 0xc0) {
      code = byte1 & 0x1f;
      extra = 1;
    } else if ((byte1 & 0xf0) === 0xe0) {
      code = byte1 & 0x0f;
      extra = 2;
    } else if ((byte1 & 0xf8) === 0xf0) {
      code = byte1 & 0x07;
      extra = 3;
    } else {
      // Invalid leading byte — skip it (lenient, like native TextDecoder)
      continue;
    }

    // Not enough continuation bytes left — trailing partial; stop.
    if (i + extra > len) break;

    let valid = true;
    for (let e = 0; e < extra; e++) {
      const b = bytes[i++];
      if ((b & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (b & 0x3f);
    }
    if (!valid) continue;

    if (code >= 0x10000) {
      // Encode as a UTF-16 surrogate pair
      code -= 0x10000;
      result += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      result += String.fromCharCode(code);
    }
  }
  return result;
}

// Install globals only if missing, so a future native implementation wins.
const g = globalThis as any;
if (typeof g.TextEncoder === 'undefined') {
  g.TextEncoder = class TextEncoder {
    readonly encoding = 'utf-8';
    encode(input = ''): Uint8Array {
      return utf8Encode(input);
    }
  };
}
if (typeof g.TextDecoder === 'undefined') {
  g.TextDecoder = class TextDecoder {
    readonly encoding = 'utf-8';
    constructor(label?: string) {
      // Only UTF-8 / utf8 / utf-8 supported. Reject clearly if another label is requested.
      const norm = (label || 'utf-8').toLowerCase().replace(/_/g, '-');
      if (norm !== 'utf-8' && norm !== 'utf8' && norm !== 'utf8') {
        throw new Error(`TextDecoder polyfill only supports utf-8, got: ${label}`);
      }
    }
    decode(input?: ArrayBuffer | ArrayBufferView, options?: DecodeOptions): string {
      return input == null ? '' : utf8Decode(input, options);
    }
  };
}

export {};
