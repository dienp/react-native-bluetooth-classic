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
    return withContext(error, context);
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

/** Adds call context the error lacks; returns the same error when nothing is missing. */
function withContext(
  error: BluetoothClassicError,
  context: ErrorContext
): BluetoothClassicError {
  const addDevice =
    error.deviceId === undefined && context.deviceId !== undefined;
  const addConnection =
    error.connectionId === undefined && context.connectionId !== undefined;
  if (!addDevice && !addConnection) {
    return error;
  }
  const details: BluetoothClassicErrorDetails = { platform: error.platform };
  const deviceId = error.deviceId ?? context.deviceId;
  if (deviceId !== undefined) details.deviceId = deviceId;
  const connectionId = error.connectionId ?? context.connectionId;
  if (connectionId !== undefined) details.connectionId = connectionId;
  if (error.missingPermissions !== undefined) {
    details.missingPermissions = error.missingPermissions;
  }
  if (error.nativeCode !== undefined) details.nativeCode = error.nativeCode;
  if (error.nativeMessage !== undefined)
    details.nativeMessage = error.nativeMessage;
  const copy = new BluetoothClassicError(error.code, error.message, details);
  if (error.stack !== undefined) copy.stack = error.stack;
  return copy;
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
