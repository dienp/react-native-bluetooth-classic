import {
  getCapabilities,
  getConnectedAccessories,
  onAccessoryConnected,
  showAccessoryPicker,
  type IosAccessory,
} from 'react-native-bluetooth-classic';

/** iOS: returns a connected MFi accessory, showing the system picker if none is connected. */
export async function pickAccessory(): Promise<IosAccessory | null> {
  if (!getCapabilities().accessoryPicker) {
    return null;
  }
  const [connected] = await getConnectedAccessories();
  if (connected !== undefined) {
    return connected;
  }

  return new Promise<IosAccessory | null>((resolve, reject) => {
    const subscription = onAccessoryConnected((event) => {
      subscription.remove();
      resolve(event.accessory);
    });
    showAccessoryPicker().catch((error: unknown) => {
      subscription.remove();
      reject(error);
    });
  });
}
