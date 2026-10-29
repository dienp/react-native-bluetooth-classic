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

export type ConnectionState =
  'connecting' | 'connected' | 'disconnecting' | 'disconnected';

/**
 * Why a connection ended: `'local'` after `disconnect()`, `'remote'` when the
 * peer closed the link or the link dropped, `'error'` when the library ended
 * it because of a failure (see `error`).
 */
export type DisconnectReason = 'local' | 'remote' | 'error';

export interface ConnectionStateEvent {
  readonly state: ConnectionState;
  readonly previousState: ConnectionState;
  readonly timestamp: number;
}

export interface ConnectOptions {
  /** Defaults to 15000. */
  timeoutMs?: number;
  /** Aborting it cancels a pending connect with `CONNECT_CANCELLED`. */
  signal?: AbortSignal;
  /** Limit for received bytes not yet delivered to a consumer. Defaults to 1 MiB. */
  maxBufferBytes?: number;
  /** Ignored on iOS. */
  android?: {
    /** Defaults to `'secure'`. */
    transport?: 'secure' | 'insecure';
    /** Service UUID. Defaults to the Serial Port Profile UUID. */
    uuid?: string;
    /** Retry once on this RFCOMM channel if the UUID-based attempt fails. Opt-in. */
    fallbackChannel?: number;
  };
  /** Ignored on Android. */
  ios?: {
    /** Defaults to the first declared protocol the accessory supports. */
    protocol?: string;
  };
}

export interface AcceptOptions {
  /** Defaults to the Serial Port Profile UUID. */
  uuid?: string;
  serviceName?: string;
  /** Defaults to `'secure'`. */
  transport?: 'secure' | 'insecure';
  /** No default: waits until a device connects or the accept is cancelled. */
  timeoutMs?: number;
  /** Aborting it cancels the pending accept with `ACCEPT_CANCELLED`. */
  signal?: AbortSignal;
  /** Limit for received bytes not yet delivered to a consumer. Defaults to 1 MiB. */
  maxBufferBytes?: number;
}

export interface DisconnectOptions {
  /** How long queued writes may take to finish. Defaults to 5000. */
  timeoutMs?: number;
}

export interface ReadOptions {
  /** Reject with `READ_TIMEOUT` when no frame arrives in time. */
  timeoutMs?: number;
  signal?: AbortSignal;
}
