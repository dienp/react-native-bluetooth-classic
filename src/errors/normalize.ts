import {
  BluetoothClassicError,
  isErrorCode,
  type BluetoothClassicErrorDetails,
} from './BluetoothClassicError';
import { ErrorCode } from './ErrorCode';

export interface ErrorContext {
  deviceId?: string;
  connectionId?: string;
}

/**
 * Converts anything thrown or rejected by the native layer (or by the JS
 * layer itself) into a `BluetoothClassicError`. Native modules reject with
 * `reject(code, message, userInfo)`; React Native exposes that as an Error
 * with `code` and `userInfo` properties.
 */
export function toBluetoothClassicError(
  error: unknown,
  context: ErrorContext = {}
): BluetoothClassicError {
  if (error instanceof BluetoothClassicError) {
    return error;
  }

  const record = isRecord(error) ? error : {};
  const rawCode = stringOrUndefined(record.code);
  const message =
    stringOrUndefined(record.message) ??
    (typeof error === 'string' ? error : undefined);
  const userInfo = isRecord(record.userInfo) ? record.userInfo : {};

  const details: BluetoothClassicErrorDetails = {};
  const deviceId = stringOrUndefined(userInfo.deviceId) ?? context.deviceId;
  if (deviceId !== undefined) details.deviceId = deviceId;
  const connectionId =
    stringOrUndefined(userInfo.connectionId) ?? context.connectionId;
  if (connectionId !== undefined) details.connectionId = connectionId;
  const missingPermissions = stringArrayOrUndefined(
    userInfo.missingPermissions
  );
  if (missingPermissions !== undefined) {
    details.missingPermissions = missingPermissions;
  }

  if (isErrorCode(rawCode)) {
    const nativeCode = stringOrUndefined(userInfo.nativeCode);
    if (nativeCode !== undefined) details.nativeCode = nativeCode;
    const nativeMessage = stringOrUndefined(userInfo.nativeMessage);
    if (nativeMessage !== undefined) details.nativeMessage = nativeMessage;
    return new BluetoothClassicError(rawCode, message, details);
  }

  // No mapping: keep whatever the platform reported for diagnosis.
  const nativeCode =
    stringOrUndefined(userInfo.nativeCode) ??
    rawCode ??
    (error instanceof Error ? error.name : undefined);
  if (nativeCode !== undefined) details.nativeCode = nativeCode;
  const nativeMessage = stringOrUndefined(userInfo.nativeMessage) ?? message;
  if (nativeMessage !== undefined) details.nativeMessage = nativeMessage;
  return new BluetoothClassicError(
    ErrorCode.UNKNOWN,
    message !== undefined
      ? `Unexpected failure: ${message}`
      : 'Unexpected failure',
    details
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : undefined;
}
