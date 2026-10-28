import { guard } from '../internal';
import { getNativeModule } from '../native';
import { hostPlatform } from '../platform';
import { BluetoothClassicError } from '../errors/BluetoothClassicError';
import { ErrorCode } from '../errors/ErrorCode';
import type {
  PermissionRequestResult,
  PermissionScope,
  PermissionStatus,
} from '../types';
import { invalidArgument } from '../validation';
import type { NativePermissionStatus } from '../specs/NativeBluetoothClassic';

const SCOPES: readonly PermissionScope[] = ['discovery', 'connect', 'server'];

function checkScope(scope: unknown): asserts scope is PermissionScope {
  if (!(SCOPES as readonly unknown[]).includes(scope)) {
    throw invalidArgument(
      `scope must be one of ${SCOPES.map((s) => `'${s}'`).join(', ')}`
    );
  }
}

const IOS_CONNECT_STATUS: PermissionRequestResult = Object.freeze({
  granted: true,
  missing: Object.freeze([]),
  canAskAgain: true,
});

/** On iOS only the `'connect'` scope exists, and it needs no runtime permission. */
function iosStatus(scope: PermissionScope): PermissionRequestResult {
  if (scope !== 'connect') {
    throw new BluetoothClassicError(
      ErrorCode.UNSUPPORTED_ON_PLATFORM,
      `The '${scope}' permission scope is only available on Android`
    );
  }
  return IOS_CONNECT_STATUS;
}

function toStatus(native: NativePermissionStatus): PermissionStatus {
  const status: {
    -readonly [K in keyof PermissionStatus]: PermissionStatus[K];
  } = {
    granted: native.granted,
    missing: Object.freeze([...native.missing]),
  };
  if (typeof native.locationServicesEnabled === 'boolean') {
    status.locationServicesEnabled = native.locationServicesEnabled;
  }
  return Object.freeze(status);
}

/** Reports which permissions a scope still needs, without prompting. */
export function checkPermissions(
  scope: PermissionScope
): Promise<PermissionStatus> {
  return guard(async () => {
    checkScope(scope);
    if (hostPlatform() === 'ios') {
      const { granted, missing } = iosStatus(scope);
      return Object.freeze({ granted, missing });
    }
    return toStatus(await getNativeModule().checkPermissions(scope));
  });
}

/** Prompts for the permissions a scope still needs (Android). */
export function requestPermissions(
  scope: PermissionScope
): Promise<PermissionRequestResult> {
  return guard(async () => {
    checkScope(scope);
    if (hostPlatform() === 'ios') {
      return iosStatus(scope);
    }
    const native = await getNativeModule().requestPermissions(scope);
    return Object.freeze({
      ...toStatus(native),
      canAskAgain: native.canAskAgain ?? true,
    });
  });
}
