import fc from 'fast-check';

import {
  ErrorCode,
  decodeText,
  delimiter,
  encodeText,
  fixedLength,
  raw,
  type Framer,
} from '../index';

function feed(framer: Framer, ...chunks: Array<string | Uint8Array>): string[] {
  return chunks
    .flatMap((chunk) =>
      framer.push(typeof chunk === 'string' ? encodeText(chunk) : chunk)
    )
    .map((frame) => decodeText(frame));
}

describe('delimiter', () => {
  it('splits on a delimiter spanning two chunks', () => {
    expect(feed(delimiter('\r\n'), 'OK\r', '\nREADY\r\n')).toEqual([
      'OK',
      'READY',
    ]);
  });

  it('produces several frames from one chunk and keeps the remainder', () => {
    const framer = delimiter('\n');
    expect(feed(framer, 'a\nb\nc')).toEqual(['a', 'b']);
    expect(framer.bufferedBytes).toBe(1);
    expect(feed(framer, '\n')).toEqual(['c']);
  });

  it('can keep the delimiter', () => {
    expect(
      feed(delimiter('\r\n', { includeDelimiter: true }), 'OK\r\n')
    ).toEqual(['OK\r\n']);
  });

  it('accepts byte delimiters and empty frames', () => {
    const framer = delimiter(Uint8Array.from([0x00, 0xff]));
    const frames = framer.push(Uint8Array.from([1, 0x00, 0xff, 0x00, 0xff, 2]));
    expect(frames.map((f) => Array.from(f))).toEqual([[1], []]);
  });

  it('handles delimiters with repeated bytes', () => {
    expect(feed(delimiter('aab'), 'xaaab', 'yaa', 'b')).toEqual(['xa', 'y']);
  });

  it('flushes the trailing partial frame', () => {
    const framer = delimiter('\n');
    feed(framer, 'partial');
    expect(framer.flush().map((f) => decodeText(f))).toEqual(['partial']);
    expect(framer.flush()).toEqual([]);
  });

  it('rejects an empty delimiter', () => {
    expect(() => delimiter('')).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT })
    );
  });
});

describe('fixedLength', () => {
  it('emits frames of exactly n bytes', () => {
    const framer = fixedLength(3);
    expect(feed(framer, 'ab', 'cdefg')).toEqual(['abc', 'def']);
    expect(framer.bufferedBytes).toBe(1);
  });

  it.each([0, -1, 1.5])('rejects length %p', (length) => {
    expect(() => fixedLength(length)).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT })
    );
  });
});

describe('raw', () => {
  it('emits each chunk as a copy', () => {
    const chunk = encodeText('abc');
    const [frame] = raw().push(chunk);
    expect(frame).toEqual(chunk);
    expect(frame).not.toBe(chunk);
  });
});

describe('re-chunking never changes the frames', () => {
  const arbitraryInput = fc.uint8Array({ maxLength: 300 }).map((data) =>
    // Make delimiters frequent: map bytes onto a tiny alphabet.
    data.map((b) => [0x0d, 0x0a, 0x41, 0x42][b % 4]!)
  );
  const arbitraryCuts = fc.array(fc.nat({ max: 400 }), { maxLength: 20 });

  function chunked(input: Uint8Array, cuts: number[]): Uint8Array[] {
    const points = [...new Set(cuts.map((c) => c % (input.length + 1)))].sort(
      (a, b) => a - b
    );
    const chunks: Uint8Array[] = [];
    let previous = 0;
    for (const point of [...points, input.length]) {
      chunks.push(input.slice(previous, point));
      previous = point;
    }
    return chunks;
  }

  function frames(make: () => Framer, chunks: Uint8Array[]): number[][] {
    const framer = make();
    const output = chunks.flatMap((chunk) => framer.push(chunk));
    return [...output, ...framer.flush()].map((frame) => Array.from(frame));
  }

  it.each([
    ['delimiter("\\r\\n")', () => delimiter('\r\n')],
    [
      'delimiter("\\n", includeDelimiter)',
      () => delimiter('\n', { includeDelimiter: true }),
    ],
    ['delimiter("ABA")', () => delimiter('ABA')],
    ['fixedLength(7)', () => fixedLength(7)],
  ])('%s', (_name, make) => {
    fc.assert(
      fc.property(
        arbitraryInput,
        arbitraryCuts,
        arbitraryCuts,
        (input, a, b) => {
          expect(frames(make, chunked(input, a))).toEqual(
            frames(make, chunked(input, b))
          );
        }
      )
    );
  });
});
