import { hostPlatform, type HostPlatform } from '../platform';
import { ERROR_CODES, type ErrorCode } from './ErrorCode';

export type ErrorPlatform = HostPlatform;

export interface BluetoothClassicErrorDetails {
  platform?: ErrorPlatform;
  deviceId?: string;
  connectionId?: string;
  missingPermissions?: readonly string[];
  nativeCode?: string;
  nativeMessage?: string;
}

export interface BluetoothClassicErrorJSON {
  name: 'BluetoothClassicError';
  code: ErrorCode;
  message: string;
  platform: ErrorPlatform;
  deviceId?: string;
  connectionId?: string;
  missingPermissions?: readonly string[];
  nativeCode?: string;
  nativeMessage?: string;
}

const DEFAULT_MESSAGE = 'Bluetooth Classic operation failed';

/**
 * The only error type the library surfaces. `code` is always one of
 * `ErrorCode`, on both platforms.
 */
export class BluetoothClassicError extends Error {
  override readonly name = 'BluetoothClassicError' as const;
  readonly code: ErrorCode;
  readonly platform: ErrorPlatform;
  readonly deviceId?: string;
  readonly connectionId?: string;
  readonly missingPermissions?: readonly string[];
  readonly nativeCode?: string;
  readonly nativeMessage?: string;

  constructor(
    code: ErrorCode,
    message?: string,
    details: BluetoothClassicErrorDetails = {}
  ) {
    super(
      message && message.length > 0 ? message : `${DEFAULT_MESSAGE} (${code})`
    );
    // Keep `instanceof` working when classes are transpiled.
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = code;
    this.platform = details.platform ?? hostPlatform();
    if (details.deviceId !== undefined) this.deviceId = details.deviceId;
    if (details.connectionId !== undefined) {
      this.connectionId = details.connectionId;
    }
    if (details.missingPermissions !== undefined) {
      this.missingPermissions = Object.freeze([...details.missingPermissions]);
    }
    if (details.nativeCode !== undefined) this.nativeCode = details.nativeCode;
    if (details.nativeMessage !== undefined) {
      this.nativeMessage = details.nativeMessage;
    }
  }

  toJSON(): BluetoothClassicErrorJSON {
    const json: BluetoothClassicErrorJSON = {
      name: this.name,
      code: this.code,
      message: this.message,
      platform: this.platform,
    };
    if (this.deviceId !== undefined) json.deviceId = this.deviceId;
    if (this.connectionId !== undefined) json.connectionId = this.connectionId;
    if (this.missingPermissions !== undefined) {
      json.missingPermissions = this.missingPermissions;
    }
    if (this.nativeCode !== undefined) json.nativeCode = this.nativeCode;
    if (this.nativeMessage !== undefined) {
      json.nativeMessage = this.nativeMessage;
    }
    return json;
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' &&
    (ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Narrows `value` to a `BluetoothClassicError`, optionally with a given code.
 */
export function isBluetoothClassicError(
  value: unknown,
  code?: ErrorCode
): value is BluetoothClassicError {
  return (
    value instanceof BluetoothClassicError &&
    (code === undefined || value.code === code)
  );
}
