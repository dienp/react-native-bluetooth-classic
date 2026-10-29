import { BluetoothClassicError } from './errors/BluetoothClassicError';
import { ErrorCode } from './errors/ErrorCode';
import { hostPlatform } from './platform';
import NativeBluetoothClassic, {
  type Spec,
} from './specs/NativeBluetoothClassic';

let override: Spec | null | undefined;

/**
 * Returns the native module, or throws `UNSUPPORTED_ON_PLATFORM` on hosts
 * other than Android and iOS, and `MODULE_NOT_LINKED` when the module is not
 * registered in this build.
 */
export function getNativeModule(): Spec {
  if (hostPlatform() === 'other') {
    throw new BluetoothClassicError(
      ErrorCode.UNSUPPORTED_ON_PLATFORM,
      '@dynlabs/react-native-bluetooth-classic supports Android and iOS only'
    );
  }
  const module = override !== undefined ? override : NativeBluetoothClassic;
  if (module == null) {
    throw new BluetoothClassicError(
      ErrorCode.MODULE_NOT_LINKED,
      "The native module 'RNBluetoothClassic' is not linked. Rebuild the app after installing @dynlabs/react-native-bluetooth-classic. Expo Go is not supported; use a development build."
    );
  }
  return module;
}

/**
 * @internal Used by the Jest mock to install a fake native module. Pass
 * `null` to emulate a missing module and `undefined` to restore the real one.
 */
export function __setNativeModuleOverride(
  module: Spec | null | undefined
): void {
  override = module;
}
