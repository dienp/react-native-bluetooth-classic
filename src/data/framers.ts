import { invalidArgument } from '../validation';
import { encodeText, type TextEncoding } from './codecs';

/**
 * Splits an inbound byte stream into frames. Framers run in JavaScript, so a
 * framer produces identical frames on Android and iOS regardless of how the
 * OS chunks the bytes.
 */
export interface Framer {
  /** Consumes a chunk and returns every frame it completes, in order. */
  push(chunk: Uint8Array): Uint8Array[];
  /**
   * Called when the remote side closes the stream. Returns any trailing
   * partial frame that should still be delivered.
   */
  flush(): Uint8Array[];
  /** Drops all buffered bytes. */
  reset(): void;
  /** Bytes buffered for the frame being assembled; used for `maxFrameBytes`. */
  readonly bufferedBytes?: number;
  /**
   * `true` when frames are arbitrary slices of the stream (like `raw()`), so
   * text must be decoded across frame boundaries.
   */
  readonly streaming?: boolean;
}

/** A growable byte buffer that avoids re-copying on every push. */
class ByteBuffer {
  private data = new Uint8Array(64);
  private start = 0;
  private end = 0;

  get length(): number {
    return this.end - this.start;
  }

  append(chunk: Uint8Array): void {
    if (this.end + chunk.length > this.data.length) {
      const length = this.length;
      const capacity = Math.max(this.data.length, 64);
      let next = capacity;
      while (next < length + chunk.length) next *= 2;
      const grown =
        next === this.data.length ? this.data : new Uint8Array(next);
      grown.set(this.data.subarray(this.start, this.end), 0);
      this.data = grown;
      this.start = 0;
      this.end = length;
    }
    this.data.set(chunk, this.end);
    this.end += chunk.length;
  }

  /** Byte at offset `index` from the start of the buffered data. */
  at(index: number): number {
    return this.data[this.start + index]!;
  }

  /** Removes and returns the first `count` bytes. */
  take(count: number): Uint8Array {
    const frame = this.data.slice(this.start, this.start + count);
    this.start += count;
    if (this.start === this.end) {
      this.start = 0;
      this.end = 0;
    }
    return frame;
  }

  /** Drops the first `count` bytes. */
  skip(count: number): void {
    this.take(count);
  }

  clear(): void {
    this.start = 0;
    this.end = 0;
  }
}

export interface DelimiterOptions {
  /** Keep the delimiter at the end of each frame. Defaults to `false`. */
  includeDelimiter?: boolean;
  /** How a string delimiter is converted to bytes. Defaults to `'utf8'`. */
  encoding?: TextEncoding;
}

/**
 * Splits frames on a delimiter of any length, given as a string or bytes.
 * Delimiters split across chunks are recognized.
 */
export function delimiter(
  value: string | Uint8Array,
  options: DelimiterOptions = {}
): Framer {
  const pattern =
    typeof value === 'string'
      ? encodeText(value, options.encoding ?? 'utf8')
      : Uint8Array.from(value);
  if (pattern.length === 0) {
    throw invalidArgument('delimiter must not be empty');
  }
  const includeDelimiter = options.includeDelimiter ?? false;
  const buffer = new ByteBuffer();
  // Offset from which the next delimiter search starts.
  let searchFrom = 0;

  const matchesAt = (index: number): boolean => {
    for (let j = 0; j < pattern.length; j++) {
      if (buffer.at(index + j) !== pattern[j]) return false;
    }
    return true;
  };

  return {
    push(chunk) {
      buffer.append(chunk);
      const frames: Uint8Array[] = [];
      let index = searchFrom;
      while (index + pattern.length <= buffer.length) {
        if (matchesAt(index)) {
          if (includeDelimiter) {
            frames.push(buffer.take(index + pattern.length));
          } else {
            frames.push(buffer.take(index));
            buffer.skip(pattern.length);
          }
          index = 0;
        } else {
          index++;
        }
      }
      searchFrom = Math.max(0, buffer.length - pattern.length + 1);
      return frames;
    },
    flush() {
      searchFrom = 0;
      return buffer.length > 0 ? [buffer.take(buffer.length)] : [];
    },
    reset() {
      buffer.clear();
      searchFrom = 0;
    },
    get bufferedBytes() {
      return buffer.length;
    },
  };
}

/** Emits frames of exactly `length` bytes. */
export function fixedLength(length: number): Framer {
  if (!Number.isInteger(length) || length < 1) {
    throw invalidArgument('fixedLength(length) needs a positive integer');
  }
  const buffer = new ByteBuffer();
  return {
    push(chunk) {
      buffer.append(chunk);
      const frames: Uint8Array[] = [];
      while (buffer.length >= length) {
        frames.push(buffer.take(length));
      }
      return frames;
    },
    flush() {
      return buffer.length > 0 ? [buffer.take(buffer.length)] : [];
    },
    reset() {
      buffer.clear();
    },
    get bufferedBytes() {
      return buffer.length;
    },
  };
}

/** Emits every chunk as received. Chunk boundaries carry no meaning. */
export function raw(): Framer {
  return {
    push(chunk) {
      return chunk.length > 0 ? [Uint8Array.from(chunk)] : [];
    },
    flush() {
      return [];
    },
    reset() {},
    bufferedBytes: 0,
    streaming: true,
  };
}

export function isFramer(value: unknown): value is Framer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Framer).push === 'function' &&
    typeof (value as Framer).flush === 'function' &&
    typeof (value as Framer).reset === 'function'
  );
}
