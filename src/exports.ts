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

export {
  accept,
  cancelAccept,
  connect,
  getConnection,
  getConnections,
} from './api/connections';
export { Connection } from './connection/Connection';
export type { DisconnectedEvent, WriteOptions } from './connection/Connection';
export { Reader } from './connection/reader';
export type { FrameOf, ReaderOptions } from './connection/reader';

export { createTextDecoder, decodeText, encodeText } from './data/codecs';
export type {
  Encoding,
  StreamingTextDecoder,
  TextEncoding,
} from './data/codecs';
export { fromBase64, toBase64 } from './data/base64';
export { fromHex, toHex } from './data/hex';
export { delimiter, fixedLength, raw } from './data/framers';
export type { DelimiterOptions, Framer } from './data/framers';

export type * from './types';
