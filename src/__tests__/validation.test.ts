import { ErrorCode } from '../index';
import {
  isAbortSignalLike,
  normalizeAddress,
  utf8ByteLength,
  validateOptions,
  type Schema,
} from '../validation';

const schema: Schema = {
  timeoutMs: { kind: 'integer', min: 1, max: 1000 },
  name: { kind: 'string' },
  mode: { kind: 'enum', values: ['a', 'b'] },
  flag: { kind: 'boolean' },
  signal: { kind: 'signal' },
  android: {
    kind: 'object',
    schema: { uuid: { kind: 'string', pattern: /^x+$/, hint: 'only x' } },
  },
};

function expectInvalid(fn: () => unknown, message: RegExp) {
  expect(fn).toThrow(
    expect.objectContaining({
      code: ErrorCode.INVALID_ARGUMENT,
      message: expect.stringMatching(message),
    })
  );
}

describe('validateOptions', () => {
  it('accepts undefined options and undefined values', () => {
    expect(validateOptions(undefined, schema)).toEqual({});
    expect(validateOptions({ timeoutMs: undefined }, schema)).toEqual({
      timeoutMs: undefined,
    });
  });

  it('accepts valid options', () => {
    const value = {
      timeoutMs: 5,
      name: 'x',
      mode: 'b',
      flag: true,
      signal: new AbortController().signal,
      android: { uuid: 'xxx' },
    };
    expect(validateOptions(value, schema)).toBe(value);
  });

  it('rejects unknown keys, naming them (v1-style options)', () => {
    expectInvalid(
      () => validateOptions({ DELIMITER: '\n' }, schema),
      /Unknown option "options\.DELIMITER"/
    );
    expectInvalid(
      () => validateOptions({ android: { transport: 'x' } }, schema),
      /options\.android\.transport/
    );
  });

  it.each([
    [{ timeoutMs: -1 }, /options\.timeoutMs.*between 1 and 1000/],
    [{ timeoutMs: 1.5 }, /options\.timeoutMs/],
    [{ timeoutMs: '5' }, /options\.timeoutMs/],
    [{ name: '' }, /options\.name.*non-empty string/],
    [{ mode: 'c' }, /options\.mode.*'a', 'b'/],
    [{ flag: 'yes' }, /options\.flag.*boolean/],
    [{ signal: {} }, /options\.signal.*AbortSignal/],
    [{ android: { uuid: 'y' } }, /options\.android\.uuid.*only x/],
    [{ timeoutMs: null }, /options\.timeoutMs/],
  ])('rejects %j', (value, message) => {
    expectInvalid(() => validateOptions(value, schema), message);
  });

  it('rejects non-object options', () => {
    expectInvalid(
      () => validateOptions('x', schema),
      /options must be an object/
    );
    expectInvalid(
      () => validateOptions([], schema),
      /options must be an object/
    );
    expectInvalid(
      () => validateOptions(null, schema),
      /options must be an object/
    );
  });
});

describe('normalizeAddress', () => {
  it('upper-cases valid addresses', () => {
    expect(normalizeAddress('00:11:22:aa:bb:cc')).toBe('00:11:22:AA:BB:CC');
  });

  it.each([
    '00:11:22',
    '00-11-22-AA-BB-CC',
    'zz:11:22:aa:bb:cc',
    '',
    42,
    undefined,
  ])('rejects %j', (value) => {
    expectInvalid(() => normalizeAddress(value), /Invalid address/);
  });
});

describe('utf8ByteLength', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['é', 2],
    ['€', 3],
    ['😀', 4],
    ['\ud83d', 3],
  ])('%j is %i bytes', (text, bytes) => {
    expect(utf8ByteLength(text)).toBe(bytes);
  });
});

describe('isAbortSignalLike', () => {
  it('recognizes AbortSignal', () => {
    expect(isAbortSignalLike(new AbortController().signal)).toBe(true);
    expect(isAbortSignalLike({ aborted: false })).toBe(false);
  });
});
