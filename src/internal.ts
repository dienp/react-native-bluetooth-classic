import { BluetoothClassicError } from './errors/BluetoothClassicError';
import { ErrorCode } from './errors/ErrorCode';
import { toBluetoothClassicError, type ErrorContext } from './errors/normalize';
import { hostPlatform } from './platform';

/**
 * Runs an operation so that every failure, synchronous or not, becomes a
 * rejected promise carrying a `BluetoothClassicError`.
 */
export function guard<T>(
  operation: () => Promise<T> | T,
  context?: ErrorContext
): Promise<T> {
  return (async () => operation())().catch((error: unknown) => {
    throw toBluetoothClassicError(error, context);
  });
}

const PLATFORM_NAMES = { android: 'Android', ios: 'iOS' } as const;

/** Throws `UNSUPPORTED_ON_PLATFORM` unless running on `platform`. */
export function requirePlatform(
  platform: 'android' | 'ios',
  api: string
): void {
  if (hostPlatform() !== platform) {
    throw new BluetoothClassicError(
      ErrorCode.UNSUPPORTED_ON_PLATFORM,
      `${api} is only available on ${PLATFORM_NAMES[platform]}`
    );
  }
}
