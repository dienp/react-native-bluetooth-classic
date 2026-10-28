import {
  ErrorCode,
  checkPermissions,
  isBluetoothClassicError,
  onDeviceFound,
  openSettings,
  requestPermissions,
  startDiscovery,
  type AndroidDevice,
} from 'react-native-bluetooth-classic';

/** Runs a 10 second discovery session on Android, streaming results to `onFound`. */
export async function discover(
  onFound: (device: AndroidDevice) => void
): Promise<AndroidDevice[]> {
  const status = await checkPermissions('discovery');
  if (!status.granted) {
    const result = await requestPermissions('discovery');
    if (!result.granted && !result.canAskAgain) {
      await openSettings(); // The user must grant it in system settings.
      return [];
    }
  }

  const subscription = onDeviceFound((event) => onFound(event.device));
  try {
    return await startDiscovery({ timeoutMs: 10_000 });
  } catch (error) {
    if (isBluetoothClassicError(error, ErrorCode.LOCATION_SERVICES_DISABLED)) {
      // Android 7-11: ask the user to switch on Location Services.
    }
    throw error;
  } finally {
    subscription.remove();
  }
}
