/**
 * Codegen spec for the native module. Internal: apps use the typed API
 * exported from `src/index.ts`, which validates input, gates platforms and
 * normalizes errors before and after calling into this module.
 *
 * String unions (states, scopes, reasons) are plain `string` here and are
 * narrowed by the TypeScript layer.
 */
import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

export type NativeCapabilities = {
  platform: string;
  osVersion: string;
  discovery: boolean;
  pairing: boolean;
  server: boolean;
  adapterState: boolean;
  requestEnable: boolean;
  bondLossEvents: boolean;
  accessoryPicker: boolean;
  declaredProtocols: string[];
};

export type NativeDeviceClass = {
  major: number;
  value: number;
};

export type NativeAndroidDevice = {
  id: string;
  address: string;
  name: string | null;
  bondState: string;
  type: string;
  deviceClass: NativeDeviceClass | null;
  rssi?: number;
};

export type NativeAccessory = {
  id: string;
  name: string;
  manufacturer: string;
  modelNumber: string;
  serialNumber: string;
  firmwareRevision: string;
  hardwareRevision: string;
  protocolStrings: string[];
};

export type NativePermissionStatus = {
  granted: boolean;
  missing: string[];
  canAskAgain?: boolean;
  locationServicesEnabled?: boolean;
};

export type NativeConnectOptions = {
  timeoutMs: number;
  transport?: string;
  uuid?: string;
  fallbackChannel?: number;
  protocol?: string;
};

export type NativeAcceptOptions = {
  timeoutMs?: number;
  transport?: string;
  uuid?: string;
  serviceName?: string;
};

export type NativeConnection = {
  id: string;
  state: string;
  connectedAt: number;
  androidDevice?: NativeAndroidDevice;
  accessory?: NativeAccessory;
  protocol?: string;
};

export type NativeAdapterStateEvent = {
  state: string;
  previousState: string;
  timestamp: number;
};

export type NativeDeviceFoundEvent = {
  device: NativeAndroidDevice;
  timestamp: number;
};

export type NativeBondStateEvent = {
  device: NativeAndroidDevice;
  state: string;
  previousState: string;
  timestamp: number;
};

export type NativeBondLostEvent = {
  device: NativeAndroidDevice;
  timestamp: number;
};

export type NativeAccessoryEvent = {
  accessory: NativeAccessory;
  timestamp: number;
};

export type NativeConnectionStateEvent = {
  connectionId: string;
  state: string;
  previousState: string;
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
  nativeCode?: string;
  nativeMessage?: string;
  timestamp: number;
};

export type NativeDataEvent = {
  connectionId: string;
  /** Base64-encoded bytes. */
  data: string;
  /** Per-connection sequence number, starting at 0. */
  seq: number;
};

export interface Spec extends TurboModule {
  // Platform
  getCapabilities(): NativeCapabilities;
  setLogLevel(level: string): void;

  // Adapter
  getAdapterState(): Promise<string>;
  requestEnable(): Promise<void>;
  openSettings(): Promise<void>;
  setAdapterName(name: string): Promise<void>;

  // Permissions
  checkPermissions(scope: string): Promise<NativePermissionStatus>;
  requestPermissions(scope: string): Promise<NativePermissionStatus>;

  // Discovery and pairing (Android)
  getBondedDevices(): Promise<NativeAndroidDevice[]>;
  /** `timeoutMs` of 0 lets the OS decide when the session ends. */
  startDiscovery(timeoutMs: number): Promise<NativeAndroidDevice[]>;
  cancelDiscovery(): Promise<void>;
  pair(address: string, timeoutMs: number): Promise<NativeAndroidDevice>;
  unpair(address: string): Promise<void>;

  // Accessories (iOS)
  getConnectedAccessories(): Promise<NativeAccessory[]>;
  showAccessoryPicker(nameFilter: string | null): Promise<void>;

  // Connections
  connect(
    operationId: string,
    deviceId: string,
    options: NativeConnectOptions
  ): Promise<NativeConnection>;
  accept(
    operationId: string,
    options: NativeAcceptOptions
  ): Promise<NativeConnection>;
  cancelOperation(operationId: string): Promise<void>;
  cancelAccept(): Promise<void>;
  getConnections(): Promise<NativeConnection[]>;
  /** `data` is base64; `timeoutMs` of 0 means no timeout. */
  write(connectionId: string, data: string, timeoutMs: number): Promise<void>;
  disconnect(connectionId: string, timeoutMs: number): Promise<void>;
  closeWithError(
    connectionId: string,
    code: string,
    message: string
  ): Promise<void>;

  // Events
  readonly onAdapterStateChange: CodegenTypes.EventEmitter<NativeAdapterStateEvent>;
  readonly onDeviceFound: CodegenTypes.EventEmitter<NativeDeviceFoundEvent>;
  readonly onBondStateChange: CodegenTypes.EventEmitter<NativeBondStateEvent>;
  readonly onBondLost: CodegenTypes.EventEmitter<NativeBondLostEvent>;
  readonly onAccessoryConnected: CodegenTypes.EventEmitter<NativeAccessoryEvent>;
  readonly onAccessoryDisconnected: CodegenTypes.EventEmitter<NativeAccessoryEvent>;
  readonly onConnectionStateChange: CodegenTypes.EventEmitter<NativeConnectionStateEvent>;
  readonly onData: CodegenTypes.EventEmitter<NativeDataEvent>;
}

export default TurboModuleRegistry.get<Spec>('RNBluetoothClassic');
