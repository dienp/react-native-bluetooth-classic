export type AdapterState =
  'unavailable' | 'off' | 'turningOn' | 'on' | 'turningOff';

export type PermissionScope = 'discovery' | 'connect' | 'server';

export type BondState = 'none' | 'bonding' | 'bonded';

export type DeviceType = 'classic' | 'le' | 'dual' | 'unknown';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Subscription {
  /** Stops delivery to this listener. Calling it again has no effect. */
  remove(): void;
}

export interface DeviceClass {
  readonly major: number;
  readonly value: number;
}

/** A remote Bluetooth device on Android. Immutable. */
export interface AndroidDevice {
  /** The MAC address in upper case; equal to `address`. */
  readonly id: string;
  readonly address: string;
  readonly name: string | null;
  readonly bondState: BondState;
  readonly type: DeviceType;
  readonly deviceClass: DeviceClass | null;
  /** Signal strength, present only on devices returned by discovery. */
  readonly rssi?: number;
}

/** An MFi accessory connected to iOS. Immutable. */
export interface IosAccessory {
  /** The OS connection identifier. It changes every time the accessory reconnects. */
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly modelNumber: string;
  readonly serialNumber: string;
  readonly firmwareRevision: string;
  readonly hardwareRevision: string;
  readonly protocolStrings: readonly string[];
}

export type Device = AndroidDevice | IosAccessory;

export interface Capabilities {
  readonly platform: 'android' | 'ios' | 'other';
  /** Android API level, or the iOS version. Empty on other platforms. */
  readonly osVersion: string;
  readonly discovery: boolean;
  readonly pairing: boolean;
  readonly server: boolean;
  readonly adapterState: boolean;
  readonly requestEnable: boolean;
  readonly bondLossEvents: boolean;
  readonly accessoryPicker: boolean;
  /** iOS only: `UISupportedExternalAccessoryProtocols` in Info.plist order. */
  readonly declaredProtocols: readonly string[];
}

export interface PermissionStatus {
  readonly granted: boolean;
  /** Permission names without the `android.permission.` prefix. */
  readonly missing: readonly string[];
  /** Android API 24-30, `'discovery'` scope only. */
  readonly locationServicesEnabled?: boolean;
}

export interface PermissionRequestResult extends PermissionStatus {
  /** `false` when the OS will no longer show the prompt for a missing permission. */
  readonly canAskAgain: boolean;
}

export interface AdapterStateChangeEvent {
  readonly state: AdapterState;
  readonly previousState: AdapterState;
  readonly timestamp: number;
}

export interface DeviceFoundEvent {
  readonly device: AndroidDevice;
  readonly timestamp: number;
}

export interface BondStateChangeEvent {
  readonly device: AndroidDevice;
  readonly state: BondState;
  readonly previousState: BondState;
  readonly timestamp: number;
}

export interface BondLostEvent {
  readonly device: AndroidDevice;
  readonly timestamp: number;
}

export interface AccessoryEvent {
  readonly accessory: IosAccessory;
  readonly timestamp: number;
}

export interface StartDiscoveryOptions {
  /** Stop discovery after this many milliseconds (1-120000). Defaults to the OS duration. */
  timeoutMs?: number;
}

export interface PairOptions {
  /** Defaults to 60000. */
  timeoutMs?: number;
}

export interface AccessoryPickerOptions {
  /** Only show accessories whose name contains this text. */
  nameFilter?: string;
}
