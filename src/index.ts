export {
  BluetoothClassicError,
  isBluetoothClassicError,
} from './errors/BluetoothClassicError';
export type {
  BluetoothClassicErrorDetails,
  BluetoothClassicErrorJSON,
  ErrorPlatform,
} from './errors/BluetoothClassicError';
export { ErrorCode, ERROR_CODES } from './errors/ErrorCode';

export { getCapabilities } from './api/capabilities';
export { setLogLevel } from './api/logging';
export {
  getAdapterState,
  onAdapterStateChange,
  openSettings,
  requestEnable,
  setAdapterName,
} from './api/adapter';
export { checkPermissions, requestPermissions } from './api/permissions';
export {
  cancelDiscovery,
  getBondedDevices,
  onDeviceFound,
  startDiscovery,
} from './api/discovery';
export { onBondLost, onBondStateChange, pair, unpair } from './api/pairing';
export {
  getConnectedAccessories,
  onAccessoryConnected,
  onAccessoryDisconnected,
  showAccessoryPicker,
} from './api/accessories';

export type * from './types';
