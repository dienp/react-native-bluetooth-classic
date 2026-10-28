import fc from 'fast-check';

import {
  ErrorCode,
  createTextDecoder,
  decodeText,
  encodeText,
  fromBase64,
  fromHex,
  toBase64,
  toHex,
} from '../index';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('hex helpers', () => {
  it('converts both ways', () => {
    expect(fromHex('1b40')).toEqual(bytes(0x1b, 0x40));
    expect(fromHex('1B:40 ff')).toEqual(bytes(0x1b, 0x40, 0xff));
    expect(toHex(bytes(0x1b, 0x40, 0xff))).toBe('1b40ff');
  });

  it.each(['1', 'zz', '1g'])('rejects %j', (text) => {
    expect(() => fromHex(text)).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT })
    );
  });
});

describe('base64 helpers', () => {
  it.each([
    [bytes(), ''],
    [bytes(0x66), 'Zg=='],
    [bytes(0x66, 0x6f), 'Zm8='],
    [bytes(0x66, 0x6f, 0x6f), 'Zm9v'],
    [bytes(0xfb, 0xff), '+/8='],
  ])('encodes %j as %j', (input, output) => {
    expect(toBase64(input)).toBe(output);
    expect(fromBase64(output)).toEqual(input);
  });

  it('accepts URL-safe input without padding', () => {
    expect(fromBase64('-_8')).toEqual(bytes(0xfb, 0xff));
  });

  it('rejects invalid input', () => {
    expect(() => fromBase64('a$bc')).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT })
    );
  });

  it('round-trips arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (input) => {
        expect(fromBase64(toBase64(input))).toEqual(input);
      })
    );
  });
});

describe('text encoding', () => {
  it('encodes utf8, including astral characters', () => {
    expect(encodeText('é€😀')).toEqual(
      bytes(0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80)
    );
  });

  it('rejects characters ascii cannot represent', () => {
    expect(() => encodeText('café', 'ascii')).toThrow(
      expect.objectContaining({
        code: ErrorCode.INVALID_ARGUMENT,
        message: expect.stringContaining('ascii'),
      })
    );
  });

  it('rejects characters latin1 cannot represent', () => {
    expect(encodeText('café', 'latin1')).toEqual(bytes(0x63, 0x61, 0x66, 0xe9));
    expect(() => encodeText('€', 'latin1')).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT })
    );
  });

  it('encodes hex and base64 strings', () => {
    expect(encodeText('1b40', 'hex')).toEqual(bytes(0x1b, 0x40));
    expect(encodeText('Zm9v', 'base64')).toEqual(bytes(0x66, 0x6f, 0x6f));
  });

  it('round-trips arbitrary strings through utf8', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (text) => {
        // Lone surrogates encode as U+FFFD; valid pairs round-trip.
        const wellFormed = text.replace(
          /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
          '\ufffd'
        );
        expect(decodeText(encodeText(text))).toBe(wellFormed);
      })
    );
  });
});

describe('streaming text decoding', () => {
  it('decodes a utf8 character split across chunks', () => {
    const decoder = createTextDecoder('utf8');
    const euro = encodeText('€'); // three bytes
    expect(decoder.decode(euro.subarray(0, 2))).toBe('');
    expect(decoder.decode(euro.subarray(2))).toBe('€');
  });

  it('turns 0xFF into U+FFFD and keeps decoding', () => {
    const decoder = createTextDecoder('utf8');
    expect(decoder.decode(bytes(0x41, 0xff, 0x42))).toBe('A�B');
    expect(decoder.decode(encodeText('ok'))).toBe('ok');
  });

  it('replaces invalid sequences without swallowing the next character', () => {
    expect(decodeText(bytes(0xe2, 0x82, 0x41))).toBe('�A');
    expect(decodeText(bytes(0xc0, 0x80))).toBe('��');
    expect(decodeText(bytes(0xed, 0xa0, 0x80))).toBe('���');
  });

  it('flushes an incomplete trailing sequence as U+FFFD', () => {
    const decoder = createTextDecoder('utf8');
    expect(decoder.decode(bytes(0xe2, 0x82))).toBe('');
    expect(decoder.end()).toBe('�');
  });

  it('decodes ascii with U+FFFD above 0x7F', () => {
    expect(decodeText(bytes(0x41, 0x80, 0xff), 'ascii')).toBe('A��');
  });

  it('maps latin1 bytes one to one', () => {
    expect(decodeText(bytes(0x63, 0xe9, 0xff), 'latin1')).toBe('céÿ');
  });

  it('decodes the same text however the bytes are chunked', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 100 }),
        fc.array(fc.nat({ max: 400 }), { maxLength: 10 }),
        (text, cuts) => {
          const encoded = encodeText(text);
          const points = [
            ...new Set(cuts.map((c) => c % (encoded.length + 1))),
          ].sort((a, b) => a - b);
          const decoder = createTextDecoder('utf8');
          let output = '';
          let previous = 0;
          for (const point of [...points, encoded.length]) {
            output += decoder.decode(encoded.subarray(previous, point));
            previous = point;
          }
          output += decoder.end();
          expect(output).toBe(text);
        }
      )
    );
  });
});
