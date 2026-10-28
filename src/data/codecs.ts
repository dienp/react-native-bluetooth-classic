/* eslint-disable no-bitwise -- byte-level encoding */
import { invalidArgument } from '../validation';
import { fromBase64, toBase64 } from './base64';
import { fromHex, toHex } from './hex';

/** Encodings accepted when writing strings. */
export type Encoding = 'utf8' | 'ascii' | 'latin1' | 'hex' | 'base64';

/** Encodings readers can decode frames with. */
export type TextEncoding = 'utf8' | 'ascii' | 'latin1';

export const ENCODINGS: readonly Encoding[] = [
  'utf8',
  'ascii',
  'latin1',
  'hex',
  'base64',
];

export const TEXT_ENCODINGS: readonly TextEncoding[] = [
  'utf8',
  'ascii',
  'latin1',
];

const REPLACEMENT = 0xfffd;

/**
 * Converts a string to bytes. `ascii` and `latin1` reject characters they
 * cannot represent instead of silently replacing them.
 */
export function encodeText(
  text: string,
  encoding: Encoding = 'utf8'
): Uint8Array {
  switch (encoding) {
    case 'utf8':
      return encodeUtf8(text);
    case 'ascii':
      return encodeSingleByte(text, 0x7f, 'ascii');
    case 'latin1':
      return encodeSingleByte(text, 0xff, 'latin1');
    case 'hex':
      return fromHex(text);
    case 'base64':
      return fromBase64(text);
  }
}

/** Converts bytes to a string in one go. */
export function decodeText(
  bytes: Uint8Array,
  encoding: Encoding = 'utf8'
): string {
  switch (encoding) {
    case 'hex':
      return toHex(bytes);
    case 'base64':
      return toBase64(bytes);
    default: {
      const decoder = createTextDecoder(encoding);
      return decoder.decode(bytes) + decoder.end();
    }
  }
}

export interface StreamingTextDecoder {
  /** Decodes a chunk, holding back an incomplete trailing UTF-8 sequence. */
  decode(chunk: Uint8Array): string;
  /** Flushes held-back bytes (as U+FFFD) and resets the decoder. */
  end(): string;
}

/**
 * A streaming decoder: multi-byte UTF-8 characters split across chunks decode
 * correctly, invalid bytes become U+FFFD, and nothing ever stalls.
 */
export function createTextDecoder(
  encoding: TextEncoding
): StreamingTextDecoder {
  switch (encoding) {
    case 'utf8':
      return new Utf8Decoder();
    case 'ascii':
      return singleByteDecoder(0x7f);
    case 'latin1':
      return singleByteDecoder(0xff);
  }
}

function singleByteDecoder(max: number): StreamingTextDecoder {
  return {
    decode(chunk) {
      let output = '';
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i]!;
        output += String.fromCharCode(byte <= max ? byte : REPLACEMENT);
      }
      return output;
    },
    end() {
      return '';
    },
  };
}

class Utf8Decoder implements StreamingTextDecoder {
  private pending: number[] = [];

  decode(chunk: Uint8Array): string {
    const bytes = this.pending.length > 0 ? [...this.pending, ...chunk] : chunk;
    this.pending = [];
    const codePoints: number[] = [];
    let i = 0;
    while (i < bytes.length) {
      const first = bytes[i]!;
      if (first < 0x80) {
        codePoints.push(first);
        i += 1;
        continue;
      }
      const needed =
        first >= 0xc2 && first <= 0xdf
          ? 1
          : first >= 0xe0 && first <= 0xef
            ? 2
            : first >= 0xf0 && first <= 0xf4
              ? 3
              : -1;
      if (needed < 0) {
        codePoints.push(REPLACEMENT);
        i += 1;
        continue;
      }
      let codePoint =
        first & (needed === 1 ? 0x1f : needed === 2 ? 0x0f : 0x07);
      let consumed = 1;
      let valid = true;
      for (; consumed <= needed; consumed++) {
        if (i + consumed >= bytes.length) {
          // Incomplete sequence at the end of the chunk: wait for more bytes.
          this.pending = Array.from(bytes.slice(i)) as number[];
          return fromCodePoints(codePoints);
        }
        const next = bytes[i + consumed]!;
        if (!isContinuation(next, first, consumed)) {
          valid = false;
          break;
        }
        codePoint = (codePoint << 6) | (next & 0x3f);
      }
      if (!valid) {
        codePoints.push(REPLACEMENT);
        i += consumed;
        continue;
      }
      codePoints.push(codePoint);
      i += needed + 1;
    }
    return fromCodePoints(codePoints);
  }

  end(): string {
    const hadPending = this.pending.length > 0;
    this.pending = [];
    return hadPending ? String.fromCharCode(REPLACEMENT) : '';
  }
}

/** Rejects overlong encodings, surrogates and values above U+10FFFF. */
function isContinuation(
  byte: number,
  first: number,
  position: number
): boolean {
  if (position === 1) {
    if (first === 0xe0) return byte >= 0xa0 && byte <= 0xbf;
    if (first === 0xed) return byte >= 0x80 && byte <= 0x9f;
    if (first === 0xf0) return byte >= 0x90 && byte <= 0xbf;
    if (first === 0xf4) return byte >= 0x80 && byte <= 0x8f;
  }
  return byte >= 0x80 && byte <= 0xbf;
}

function fromCodePoints(codePoints: number[]): string {
  let output = '';
  const CHUNK = 4096;
  for (let i = 0; i < codePoints.length; i += CHUNK) {
    output += String.fromCodePoint(...codePoints.slice(i, i + CHUNK));
  }
  return output;
}

function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      code = REPLACEMENT; // Lone surrogate.
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63)
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63)
      );
    }
  }
  return Uint8Array.from(bytes);
}

function encodeSingleByte(text: string, max: number, name: string): Uint8Array {
  const output = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > max) {
      throw invalidArgument(
        `Cannot encode ${JSON.stringify(text[i])} at index ${i} as ${name}`
      );
    }
    output[i] = code;
  }
  return output;
}
