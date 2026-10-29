import { LOG_LEVELS, setJsLogLevel } from '../logger';
import { getNativeModule } from '../native';
import { hostPlatform } from '../platform';
import type { LogLevel } from '../types';
import { invalidArgument } from '../validation';

/**
 * Sets how much the library logs, in JS and natively. The default is
 * `'warn'`. Payloads, device names and addresses are only logged at
 * `'debug'`.
 */
export function setLogLevel(level: LogLevel): void {
  if (!LOG_LEVELS.includes(level)) {
    throw invalidArgument(
      `level must be one of ${LOG_LEVELS.map((l) => `'${l}'`).join(', ')}`
    );
  }
  setJsLogLevel(level);
  if (hostPlatform() !== 'other') {
    getNativeModule().setLogLevel(level);
  }
}
