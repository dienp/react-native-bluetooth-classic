import {
  ErrorCode,
  getBondedDevices,
  getCapabilities,
  isBluetoothClassicError,
  requestEnable,
  requestPermissions,
  type AndroidDevice,
} from '@dynlabs/react-native-bluetooth-classic';

/** Lists bonded devices on Android, asking for permissions and Bluetooth first. */
export async function listBondedDevices(): Promise<AndroidDevice[]> {
  if (!getCapabilities().pairing) {
    return []; // iOS: use getConnectedAccessories() instead.
  }

  const permissions = await requestPermissions('connect');
  if (!permissions.granted) {
    throw new Error(`Missing permissions: ${permissions.missing.join(', ')}`);
  }

  try {
    return await getBondedDevices();
  } catch (error) {
    if (isBluetoothClassicError(error, ErrorCode.BLUETOOTH_DISABLED)) {
      await requestEnable();
      return getBondedDevices();
    }
    throw error;
  }
}
