import NativeBluetoothClassic, {
  type NativeCapabilities,
} from './specs/NativeBluetoothClassic';

/**
 * Temporary scaffold entry point. The full v2 API is introduced by task
 * group 2 of the `rework-v2-new-architecture` OpenSpec change.
 */
export function getCapabilities(): NativeCapabilities | null {
  return NativeBluetoothClassic?.getCapabilities() ?? null;
}
