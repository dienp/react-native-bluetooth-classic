import { BluetoothClassicError } from './errors/BluetoothClassicError';
import { ErrorCode } from './errors/ErrorCode';

export type Rule =
  | { kind: 'integer'; min: number; max: number }
  | { kind: 'string'; pattern?: RegExp; hint?: string; maxUtf8Bytes?: number }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'boolean' }
  | { kind: 'signal' }
  | { kind: 'object'; schema: Schema };

export type Schema = Readonly<Record<string, Rule>>;

export function invalidArgument(message: string): BluetoothClassicError {
  return new BluetoothClassicError(ErrorCode.INVALID_ARGUMENT, message);
}

/**
 * Validates an options object against a schema. `undefined` options and
 * `undefined` values are treated as absent; unknown keys are rejected so that
 * misspelled or v1-style options never pass silently.
 */
export function validateOptions<T extends object>(
  value: unknown,
  schema: Schema,
  path = 'options'
): T {
  if (value === undefined) {
    return {} as T;
  }
  if (!isPlainObject(value)) {
    throw invalidArgument(`${path} must be an object`);
  }
  for (const key of Object.keys(value)) {
    const rule = schema[key];
    const keyPath = `${path}.${key}`;
    if (rule === undefined) {
      throw invalidArgument(`Unknown option "${keyPath}"`);
    }
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) {
      checkRule(entry, rule, keyPath);
    }
  }
  return value as T;
}

function checkRule(value: unknown, rule: Rule, path: string): void {
  switch (rule.kind) {
    case 'integer':
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < rule.min ||
        value > rule.max
      ) {
        throw invalidArgument(
          `Option "${path}" must be an integer between ${rule.min} and ${rule.max}`
        );
      }
      return;
    case 'string':
      if (typeof value !== 'string' || value.length === 0) {
        throw invalidArgument(`Option "${path}" must be a non-empty string`);
      }
      if (rule.pattern !== undefined && !rule.pattern.test(value)) {
        throw invalidArgument(
          `Option "${path}" must be ${rule.hint ?? `a string matching ${rule.pattern}`}`
        );
      }
      if (
        rule.maxUtf8Bytes !== undefined &&
        utf8ByteLength(value) > rule.maxUtf8Bytes
      ) {
        throw invalidArgument(
          `Option "${path}" must be at most ${rule.maxUtf8Bytes} UTF-8 bytes`
        );
      }
      return;
    case 'enum':
      if (typeof value !== 'string' || !rule.values.includes(value)) {
        throw invalidArgument(
          `Option "${path}" must be one of ${rule.values.map((v) => `'${v}'`).join(', ')}`
        );
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw invalidArgument(`Option "${path}" must be a boolean`);
      }
      return;
    case 'signal':
      if (!isAbortSignalLike(value)) {
        throw invalidArgument(`Option "${path}" must be an AbortSignal`);
      }
      return;
    case 'object':
      validateOptions(value, rule.schema, path);
      return;
  }
}

export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export function isAbortSignalLike(value: unknown): value is AbortSignalLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AbortSignalLike).aborted === 'boolean' &&
    typeof (value as AbortSignalLike).addEventListener === 'function' &&
    typeof (value as AbortSignalLike).removeEventListener === 'function'
  );
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const ADDRESS_PATTERN = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;

/** Validates an Android MAC address and returns it in upper case. */
export function normalizeAddress(value: unknown, name = 'address'): string {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) {
    throw invalidArgument(
      `Invalid ${name} ${JSON.stringify(value)}: expected six colon-separated hex bytes such as "00:11:22:AA:BB:CC"`
    );
  }
  return value.toUpperCase();
}

export function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidArgument(`${name} must be a non-empty string`);
  }
  return value;
}

export function requireFunction<T extends Function>(
  value: unknown,
  name: string
): T {
  if (typeof value !== 'function') {
    throw invalidArgument(`${name} must be a function`);
  }
  return value as T;
}

export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
