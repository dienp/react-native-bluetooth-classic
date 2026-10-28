/**
 * In-memory implementation of the native module spec. It emulates the native
 * behavior the specs require (preconditions, permission bands, events) so the
 * TypeScript layer can be tested without a device, and it backs the public
 * Jest mock.
 */
import type { CodegenTypes, EventSubscription } from 'react-native';

import { fromBase64, toBase64 } from '../data/base64';
import { encodeText } from '../data/codecs';
import { ErrorCode } from '../errors/ErrorCode';
import type {
  NativeAcceptOptions,
  NativeAccessory,
  NativeAccessoryEvent,
  NativeAdapterStateEvent,
  NativeAndroidDevice,
  NativeBondLostEvent,
  NativeBondStateEvent,
  NativeCapabilities,
  NativeConnectOptions,
  NativeConnection,
  NativeConnectionStateEvent,
  NativeDataEvent,
  NativeDeviceFoundEvent,
  NativePermissionStatus,
  Spec,
} from '../specs/NativeBluetoothClassic';

export type FakePlatform =
  { os: 'android'; apiLevel: number } | { os: 'ios'; version?: string };

export interface FakeDeviceInit {
  address: string;
  name?: string | null;
  bonded?: boolean;
  /** Reported by discovery sessions. Defaults to `true`. */
  discoverable?: boolean;
  type?: 'classic' | 'le' | 'dual' | 'unknown';
  deviceClass?: { major: number; value: number } | null;
  rssi?: number;
}

export interface FakeAccessoryInit {
  id?: string;
  name: string;
  protocolStrings: string[];
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  firmwareRevision?: string;
  hardwareRevision?: string;
}

/** How the emulated user answers a pairing request for a device. */
export type FakePairingResponse = 'accept' | 'reject' | 'ignore';

type FakeEmitter<T> = CodegenTypes.EventEmitter<T> & {
  emit(event: T): void;
  readonly listenerCount: number;
};

function createEmitter<T>(): FakeEmitter<T> {
  const listeners = new Set<(event: T) => void>();
  const subscribe = ((listener: (event: T) => void): EventSubscription => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  }) as FakeEmitter<T>;
  Object.defineProperty(subscribe, 'emit', {
    value: (event: T) => {
      for (const listener of Array.from(listeners)) listener(event);
    },
  });
  Object.defineProperty(subscribe, 'listenerCount', {
    get: () => listeners.size,
  });
  return subscribe;
}

/** The shape React Native gives a promise rejected with `reject(code, message, userInfo)`. */
export function nativeRejection(
  code: string,
  message: string,
  userInfo?: Record<string, unknown>
): Error {
  return Object.assign(new Error(message), {
    code,
    userInfo: userInfo ?? null,
  });
}

interface FakeDevice {
  address: string;
  name: string | null;
  bondState: 'none' | 'bonding' | 'bonded';
  discoverable: boolean;
  type: string;
  deviceClass: { major: number; value: number } | null;
  rssi: number | undefined;
}

interface DiscoverySession {
  found: Map<string, NativeAndroidDevice>;
  resolve: (devices: NativeAndroidDevice[]) => void;
  reject: (error: Error) => void;
  timers: ReturnType<typeof setTimeout>[];
}

interface PendingPairing {
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type Failure = {
  code: string;
  message: string;
  userInfo?: Record<string, unknown>;
};

interface ConnectTarget {
  key: string;
  device?: FakeDevice;
  accessory?: NativeAccessory;
  protocol?: string;
}

interface FakeConnection {
  id: string;
  targetKey: string;
  state: 'connecting' | 'connected' | 'disconnecting' | 'disconnected';
  connectedAt: number;
  device?: FakeDevice;
  accessory?: NativeAccessory;
  protocol?: string;
  seq: number;
  written: number[];
  writeChain: Promise<void>;
  disconnecting: Promise<void> | null;
  stalledWrites: Set<(error: Error) => void>;
}

interface PendingOperation {
  cancelCode: string;
  reject: (error: Error) => void;
  timers: ReturnType<typeof setTimeout>[];
}

const SCAN = 'BLUETOOTH_SCAN';
const CONNECT = 'BLUETOOTH_CONNECT';
const FINE = 'ACCESS_FINE_LOCATION';
const COARSE = 'ACCESS_COARSE_LOCATION';

export class FakeNativeModule implements Spec {
  // ---- Emulated environment (tests may change these directly) ----
  platform: FakePlatform;
  adapterState: 'unavailable' | 'off' | 'turningOn' | 'on' | 'turningOff' =
    'on';
  adapterName = 'Fake adapter';
  /** Granted runtime permissions, without the `android.permission.` prefix. */
  readonly grantedPermissions = new Set<string>([SCAN, CONNECT, FINE, COARSE]);
  /** Permissions denied with "don't ask again". */
  readonly blockedPermissions = new Set<string>();
  /** How the emulated user answers permission prompts. */
  permissionPromptResponse: 'grant' | 'deny' | 'denyForever' = 'grant';
  locationServicesEnabled = true;
  /** Whether an Android activity is in the foreground. */
  hasForegroundActivity = true;
  enablePromptResponse: 'accept' | 'decline' = 'accept';
  /** How long the OS runs a discovery session when no timeout is given. */
  discoveryDurationMs = 12_000;
  /** Android API 24-35: whether the OS blocks bond removal. */
  unpairBlocked = false;
  /** Pairing responses per address; the default is `'accept'`. */
  readonly pairingResponses = new Map<string, FakePairingResponse>();
  /** iOS: `UISupportedExternalAccessoryProtocols`. */
  declaredProtocols: string[] = [];
  pickerResponse:
    | { type: 'select'; accessory?: FakeAccessoryInit }
    | { type: 'cancel' | 'notFound' | 'failed' } = { type: 'cancel' };
  logLevel = 'warn';

  /** Every native call, in order, for assertions. */
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  // ---- Events ----
  readonly onAdapterStateChange = createEmitter<NativeAdapterStateEvent>();
  readonly onDeviceFound = createEmitter<NativeDeviceFoundEvent>();
  readonly onBondStateChange = createEmitter<NativeBondStateEvent>();
  readonly onBondLost = createEmitter<NativeBondLostEvent>();
  readonly onAccessoryConnected = createEmitter<NativeAccessoryEvent>();
  readonly onAccessoryDisconnected = createEmitter<NativeAccessoryEvent>();
  readonly onConnectionStateChange =
    createEmitter<NativeConnectionStateEvent>();
  readonly onData = createEmitter<NativeDataEvent>();

  private readonly devices = new Map<string, FakeDevice>();
  private readonly accessories = new Map<string, NativeAccessory>();
  private readonly failures = new Map<string, Failure[]>();
  private discovery: DiscoverySession | null = null;
  private readonly pairings = new Map<string, PendingPairing>();
  private pendingEnable: Promise<void> | null = null;
  private nextAccessoryId = 1;
  private nextConnectionId = 1;
  private readonly connections = new Map<string, FakeConnection>();
  private readonly connectingTargets = new Set<string>();
  private readonly operations = new Map<string, PendingOperation>();
  private pendingAccept: {
    operationId: string;
    resolve: (connection: FakeConnection) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(platform: FakePlatform = { os: 'android', apiLevel: 36 }) {
    this.platform = platform;
  }

  // ---------------------------------------------------------------------
  // Test controls
  // ---------------------------------------------------------------------

  /** Makes the next call to `method` reject with `code`. */
  failNext(
    method: keyof Spec,
    code: string,
    message = `Simulated ${code}`,
    userInfo?: Record<string, unknown>
  ): void {
    const queue = this.failures.get(method) ?? [];
    queue.push({ code, message, userInfo });
    this.failures.set(method, queue);
  }

  addDevice(init: FakeDeviceInit): void {
    const address = init.address.toUpperCase();
    this.devices.set(address, {
      address,
      name: init.name === undefined ? `Device ${address.slice(-5)}` : init.name,
      bondState: init.bonded ? 'bonded' : 'none',
      discoverable: init.discoverable ?? true,
      type: init.type ?? 'classic',
      deviceClass:
        init.deviceClass === undefined
          ? { major: 1536, value: 1664 }
          : init.deviceClass,
      rssi: init.rssi ?? -60,
    });
  }

  /** Changes the adapter state, emitting the transition and its side effects. */
  setAdapterState(state: FakeNativeModule['adapterState']): void {
    const previousState = this.adapterState;
    if (previousState === state) {
      return;
    }
    this.adapterState = state;
    this.onAdapterStateChange.emit({
      state,
      previousState,
      timestamp: Date.now(),
    });
    if (state !== 'on' && this.discovery !== null) {
      const session = this.discovery;
      this.endDiscovery();
      session.reject(
        nativeRejection(
          ErrorCode.BLUETOOTH_DISABLED,
          'Bluetooth was turned off'
        )
      );
    }
    if (state !== 'on' && this.platform.os === 'android') {
      for (const [operationId, operation] of Array.from(this.operations)) {
        this.operations.delete(operationId);
        operation.timers.forEach(clearTimeout);
        if (this.pendingAccept?.operationId === operationId) {
          this.pendingAccept = null;
        }
        operation.reject(
          nativeRejection(
            ErrorCode.BLUETOOTH_DISABLED,
            'Bluetooth was turned off'
          )
        );
      }
      for (const connection of Array.from(this.connections.values())) {
        this.terminate(
          connection,
          'error',
          ErrorCode.BLUETOOTH_DISABLED,
          'Bluetooth was turned off'
        );
      }
    }
  }

  /** Simulates an accessory connecting to iOS; returns its id. */
  connectAccessory(init: FakeAccessoryInit): string {
    const id = init.id ?? String(this.nextAccessoryId++);
    const accessory: NativeAccessory = {
      id,
      name: init.name,
      manufacturer: init.manufacturer ?? 'Acme',
      modelNumber: init.modelNumber ?? 'M1',
      serialNumber: init.serialNumber ?? `SN-${id}`,
      firmwareRevision: init.firmwareRevision ?? '1.0.0',
      hardwareRevision: init.hardwareRevision ?? '1.0',
      protocolStrings: [...init.protocolStrings],
    };
    this.accessories.set(id, accessory);
    if (this.supportsDeclaredProtocol(accessory)) {
      this.onAccessoryConnected.emit({ accessory, timestamp: Date.now() });
    }
    return id;
  }

  /** Simulates an accessory disconnecting from iOS. */
  disconnectAccessory(id: string): void {
    const accessory = this.accessories.get(id);
    if (accessory === undefined) {
      return;
    }
    this.accessories.delete(id);
    if (this.supportsDeclaredProtocol(accessory)) {
      this.onAccessoryDisconnected.emit({ accessory, timestamp: Date.now() });
    }
  }

  /** Ends the running discovery session as if the OS finished it. */
  finishDiscovery(): void {
    const session = this.discovery;
    if (session === null) {
      return;
    }
    this.endDiscovery();
    session.resolve(Array.from(session.found.values()));
  }

  /** Simulates the OS reporting lost bonding keys (API 36+). */
  loseBond(address: string): void {
    const device = this.devices.get(address.toUpperCase());
    if (device !== undefined && this.apiLevel() >= 36) {
      this.onBondLost.emit({
        device: this.toNative(device),
        timestamp: Date.now(),
      });
    }
  }

  // ---------------------------------------------------------------------
  // Spec: platform
  // ---------------------------------------------------------------------

  getCapabilities(): NativeCapabilities {
    this.record('getCapabilities', []);
    if (this.platform.os === 'ios') {
      return {
        platform: 'ios',
        osVersion: this.platform.version ?? '18.0',
        discovery: false,
        pairing: false,
        server: false,
        adapterState: false,
        requestEnable: false,
        bondLossEvents: false,
        accessoryPicker: true,
        declaredProtocols: [...this.declaredProtocols],
      };
    }
    return {
      platform: 'android',
      osVersion: String(this.platform.apiLevel),
      discovery: true,
      pairing: true,
      server: true,
      adapterState: true,
      requestEnable: true,
      bondLossEvents: this.platform.apiLevel >= 36,
      accessoryPicker: false,
      declaredProtocols: [],
    };
  }

  setLogLevel(level: string): void {
    this.record('setLogLevel', [level]);
    this.logLevel = level;
  }

  // ---------------------------------------------------------------------
  // Spec: adapter
  // ---------------------------------------------------------------------

  async getAdapterState(): Promise<string> {
    this.begin('getAdapterState', []);
    this.androidOnly();
    return this.adapterState;
  }

  async requestEnable(): Promise<void> {
    this.begin('requestEnable', []);
    this.androidOnly();
    this.requireHardware();
    this.requirePermissions('connect');
    if (this.adapterState === 'on') {
      return;
    }
    if (this.pendingEnable !== null) {
      return this.pendingEnable;
    }
    if (!this.hasForegroundActivity) {
      throw nativeRejection(
        ErrorCode.ACTIVITY_UNAVAILABLE,
        'No activity in the foreground'
      );
    }
    this.pendingEnable = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        this.pendingEnable = null;
        if (this.enablePromptResponse === 'decline') {
          reject(nativeRejection(ErrorCode.USER_REJECTED, 'The user declined'));
          return;
        }
        this.setAdapterState('turningOn');
        this.setAdapterState('on');
        resolve();
      }, 0);
    });
    return this.pendingEnable;
  }

  async openSettings(): Promise<void> {
    this.begin('openSettings', []);
    if (this.platform.os === 'android' && !this.hasForegroundActivity) {
      throw nativeRejection(
        ErrorCode.ACTIVITY_UNAVAILABLE,
        'No app can open the Bluetooth settings'
      );
    }
  }

  async setAdapterName(name: string): Promise<void> {
    this.begin('setAdapterName', [name]);
    this.androidOnly();
    this.requireAdapter('connect');
    this.adapterName = name;
  }

  // ---------------------------------------------------------------------
  // Spec: permissions
  // ---------------------------------------------------------------------

  async checkPermissions(scope: string): Promise<NativePermissionStatus> {
    this.begin('checkPermissions', [scope]);
    this.androidOnly();
    return this.permissionStatus(scope);
  }

  async requestPermissions(scope: string): Promise<NativePermissionStatus> {
    this.begin('requestPermissions', [scope]);
    this.androidOnly();
    const before = this.permissionStatus(scope);
    if (before.missing.length === 0) {
      return { ...before, canAskAgain: true };
    }
    if (!this.hasForegroundActivity) {
      throw nativeRejection(
        ErrorCode.ACTIVITY_UNAVAILABLE,
        'No activity in the foreground'
      );
    }
    for (const permission of before.missing) {
      if (this.blockedPermissions.has(permission)) {
        continue;
      }
      if (this.permissionPromptResponse === 'grant') {
        this.grantedPermissions.add(permission);
      } else if (this.permissionPromptResponse === 'denyForever') {
        this.blockedPermissions.add(permission);
      }
    }
    const after = this.permissionStatus(scope);
    return {
      ...after,
      canAskAgain: after.missing.every((p) => !this.blockedPermissions.has(p)),
    };
  }

  // ---------------------------------------------------------------------
  // Spec: discovery and pairing
  // ---------------------------------------------------------------------

  async getBondedDevices(): Promise<NativeAndroidDevice[]> {
    this.begin('getBondedDevices', []);
    this.androidOnly();
    this.requireAdapter('connect');
    return Array.from(this.devices.values())
      .filter((device) => device.bondState === 'bonded')
      .map((device) => this.toNative(device));
  }

  startDiscovery(timeoutMs: number): Promise<NativeAndroidDevice[]> {
    return this.run('startDiscovery', [timeoutMs], () => {
      this.androidOnly();
      this.requireAdapter('discovery');
      if (this.apiLevel() <= 30 && !this.locationServicesEnabled) {
        throw nativeRejection(
          ErrorCode.LOCATION_SERVICES_DISABLED,
          'Location Services must be on for discovery on Android 7-11'
        );
      }
      if (this.discovery !== null) {
        throw nativeRejection(
          ErrorCode.DISCOVERY_ALREADY_RUNNING,
          'A discovery session is already running'
        );
      }
      return new Promise<NativeAndroidDevice[]>((resolve, reject) => {
        const session: DiscoverySession = {
          found: new Map(),
          resolve,
          reject,
          timers: [],
        };
        this.discovery = session;
        session.timers.push(
          setTimeout(() => {
            for (const device of this.devices.values()) {
              if (!device.discoverable || this.discovery !== session) continue;
              const native = this.toNative(device, true);
              session.found.set(device.address, native);
              this.onDeviceFound.emit({
                device: native,
                timestamp: Date.now(),
              });
            }
          }, 0)
        );
        const duration =
          timeoutMs > 0
            ? Math.min(timeoutMs, this.discoveryDurationMs)
            : this.discoveryDurationMs;
        session.timers.push(setTimeout(() => this.finishDiscovery(), duration));
      });
    });
  }

  async cancelDiscovery(): Promise<void> {
    this.begin('cancelDiscovery', []);
    this.androidOnly();
    this.finishDiscovery();
  }

  pair(address: string, timeoutMs: number): Promise<NativeAndroidDevice> {
    return this.run('pair', [address, timeoutMs], () => {
      this.androidOnly();
      this.requireAdapter('connect');
      const key = address.toUpperCase();
      if (this.pairings.has(key)) {
        throw nativeRejection(
          ErrorCode.PAIRING_IN_PROGRESS,
          `Pairing with ${key} is already in progress`,
          { deviceId: key }
        );
      }
      const device = this.devices.get(key);
      if (device === undefined) {
        throw nativeRejection(ErrorCode.PAIRING_FAILED, 'Device unreachable', {
          deviceId: key,
        });
      }
      if (device.bondState === 'bonded') {
        return Promise.resolve(this.toNative(device));
      }
      const response = this.pairingResponses.get(key) ?? 'accept';
      return new Promise<NativeAndroidDevice>((resolve, reject) => {
        const pending: PendingPairing = {
          reject,
          timer: setTimeout(() => {
            this.pairings.delete(key);
            this.setBondState(device, 'none');
            reject(
              nativeRejection(ErrorCode.PAIRING_TIMEOUT, 'Pairing timed out', {
                deviceId: key,
              })
            );
          }, timeoutMs),
        };
        this.pairings.set(key, pending);
        this.setBondState(device, 'bonding');
        if (response === 'ignore') {
          return;
        }
        setTimeout(() => {
          if (this.pairings.get(key) !== pending) return;
          clearTimeout(pending.timer);
          this.pairings.delete(key);
          if (response === 'accept') {
            this.setBondState(device, 'bonded');
            resolve(this.toNative(device));
          } else {
            this.setBondState(device, 'none');
            reject(
              nativeRejection(
                ErrorCode.PAIRING_FAILED,
                'Pairing was rejected',
                {
                  deviceId: key,
                }
              )
            );
          }
        }, 0);
      });
    });
  }

  async unpair(address: string): Promise<void> {
    this.begin('unpair', [address]);
    this.androidOnly();
    this.requireAdapter('connect');
    const device = this.devices.get(address.toUpperCase());
    if (device === undefined || device.bondState === 'none') {
      return;
    }
    if (this.apiLevel() < 36 && this.unpairBlocked) {
      throw nativeRejection(
        ErrorCode.UNSUPPORTED_ON_PLATFORM,
        'This Android release does not allow apps to remove bonds; unpair in system settings',
        { deviceId: device.address }
      );
    }
    this.setBondState(device, 'none');
  }

  // ---------------------------------------------------------------------
  // Spec: accessories
  // ---------------------------------------------------------------------

  async getConnectedAccessories(): Promise<NativeAccessory[]> {
    this.begin('getConnectedAccessories', []);
    this.iosOnly();
    return Array.from(this.accessories.values()).filter((accessory) =>
      this.supportsDeclaredProtocol(accessory)
    );
  }

  async showAccessoryPicker(nameFilter: string | null): Promise<void> {
    this.begin('showAccessoryPicker', [nameFilter]);
    this.iosOnly();
    const response = this.pickerResponse;
    switch (response.type) {
      case 'select':
        if (response.accessory !== undefined) {
          this.connectAccessory(response.accessory);
        }
        return;
      case 'cancel':
        throw nativeRejection(
          ErrorCode.USER_REJECTED,
          'The picker was dismissed'
        );
      case 'notFound':
        throw nativeRejection(ErrorCode.DEVICE_NOT_FOUND, 'No accessory found');
      case 'failed':
        throw nativeRejection(ErrorCode.UNKNOWN, 'The picker failed', {
          nativeCode: 'EABluetoothAccessoryPickerResultFailed',
        });
    }
  }

  // ---------------------------------------------------------------------
  // Spec: connections
  // ---------------------------------------------------------------------

  async connect(
    operationId: string,
    deviceId: string,
    options: NativeConnectOptions
  ): Promise<NativeConnection> {
    this.begin('connect', [operationId, deviceId, options]);
    if (this.platform.os === 'android') {
      this.requireAdapter('connect');
    }
    const target = this.connectTarget(deviceId, options);
    const existing = Array.from(this.connections.values()).find(
      (connection) =>
        connection.targetKey === target.key &&
        connection.state !== 'disconnected'
    );
    if (existing !== undefined) {
      throw nativeRejection(ErrorCode.ALREADY_CONNECTED, 'Already connected', {
        deviceId,
        connectionId: existing.id,
      });
    }
    if (this.connectingTargets.has(target.key)) {
      throw nativeRejection(
        ErrorCode.ALREADY_CONNECTING,
        'Already connecting',
        { deviceId }
      );
    }
    if (this.platform.os === 'android') {
      this.finishDiscovery();
    }
    const response = this.connectResponses.get(deviceId) ?? 'accept';
    this.connectingTargets.add(target.key);
    return new Promise<NativeConnection>((resolve, reject) => {
      const operation: PendingOperation = {
        cancelCode: ErrorCode.CONNECT_CANCELLED,
        reject: (error) => {
          this.connectingTargets.delete(target.key);
          reject(error);
        },
        timers: [],
      };
      this.operations.set(operationId, operation);
      const settle = (body: () => void) => {
        if (this.operations.get(operationId) !== operation) return;
        this.operations.delete(operationId);
        operation.timers.forEach(clearTimeout);
        this.connectingTargets.delete(target.key);
        body();
      };
      operation.timers.push(
        setTimeout(
          () =>
            settle(() =>
              reject(
                nativeRejection(
                  ErrorCode.CONNECT_TIMEOUT,
                  'Connect timed out',
                  {
                    deviceId,
                  }
                )
              )
            ),
          options.timeoutMs
        )
      );
      if (response === 'hang') {
        return;
      }
      operation.timers.push(
        setTimeout(
          () =>
            settle(() => {
              if (response === 'fail') {
                reject(
                  nativeRejection(
                    ErrorCode.CONNECT_FAILED,
                    'Connection refused',
                    {
                      deviceId,
                      nativeCode: 'IOException',
                      nativeMessage:
                        'read failed, socket might closed or timeout',
                    }
                  )
                );
                return;
              }
              if (response === 'sessionFail') {
                reject(
                  nativeRejection(
                    ErrorCode.SESSION_OPEN_FAILED,
                    'The OS returned no session'
                  )
                );
                return;
              }
              const connection = this.openConnection(target);
              this.onConnectionOpened?.(connection.id);
              resolve(this.toNativeConnection(connection));
            }),
          0
        )
      );
    });
  }

  async accept(
    operationId: string,
    options: NativeAcceptOptions
  ): Promise<NativeConnection> {
    this.begin('accept', [operationId, options]);
    this.androidOnly();
    this.requireAdapter('server');
    if (this.pendingAccept !== null) {
      throw nativeRejection(
        ErrorCode.ACCEPT_ALREADY_RUNNING,
        'Another accept is pending'
      );
    }
    return new Promise<NativeConnection>((resolve, reject) => {
      const operation: PendingOperation = {
        cancelCode: ErrorCode.ACCEPT_CANCELLED,
        reject: (error) => {
          this.pendingAccept = null;
          reject(error);
        },
        timers: [],
      };
      this.operations.set(operationId, operation);
      const finish = () => {
        this.operations.delete(operationId);
        operation.timers.forEach(clearTimeout);
        this.pendingAccept = null;
      };
      this.pendingAccept = {
        operationId,
        resolve: (connection) => {
          finish();
          resolve(this.toNativeConnection(connection));
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      };
      if (options.timeoutMs !== undefined) {
        operation.timers.push(
          setTimeout(
            () =>
              this.pendingAccept?.reject(
                nativeRejection(ErrorCode.ACCEPT_TIMEOUT, 'No device connected')
              ),
            options.timeoutMs
          )
        );
      }
    });
  }

  async cancelOperation(operationId: string): Promise<void> {
    this.begin('cancelOperation', [operationId]);
    const operation = this.operations.get(operationId);
    if (operation === undefined) {
      return;
    }
    this.operations.delete(operationId);
    operation.timers.forEach(clearTimeout);
    if (this.pendingAccept?.operationId === operationId) {
      this.pendingAccept = null;
    }
    operation.reject(
      nativeRejection(operation.cancelCode, 'The operation was cancelled')
    );
  }

  async cancelAccept(): Promise<void> {
    this.begin('cancelAccept', []);
    this.androidOnly();
    this.pendingAccept?.reject(
      nativeRejection(ErrorCode.ACCEPT_CANCELLED, 'The accept was cancelled')
    );
  }

  async getConnections(): Promise<NativeConnection[]> {
    this.begin('getConnections', []);
    return Array.from(this.connections.values())
      .filter((connection) => connection.state !== 'disconnected')
      .map((connection) => this.toNativeConnection(connection));
  }

  write(connectionId: string, data: string, timeoutMs: number): Promise<void> {
    return this.run('write', [connectionId, data, timeoutMs], () => {
      const connection = this.connections.get(connectionId);
      if (connection === undefined || connection.state !== 'connected') {
        throw nativeRejection(ErrorCode.NOT_CONNECTED, 'Not connected', {
          connectionId,
        });
      }
      const bytes = fromBase64(data);
      const result = connection.writeChain.then(() =>
        this.performWrite(connection, bytes, timeoutMs)
      );
      connection.writeChain = result.catch(() => {});
      return result;
    });
  }

  async disconnect(connectionId: string, timeoutMs: number): Promise<void> {
    this.begin('disconnect', [connectionId, timeoutMs]);
    const connection = this.connections.get(connectionId);
    if (connection === undefined || connection.state === 'disconnected') {
      return;
    }
    if (connection.disconnecting !== null) {
      return connection.disconnecting;
    }
    this.setConnectionState(connection, 'disconnecting');
    connection.disconnecting = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        connection.writeChain,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      clearTimeout(timer);
      this.terminate(connection, 'local');
    })();
    return connection.disconnecting;
  }

  async closeWithError(
    connectionId: string,
    code: string,
    message: string
  ): Promise<void> {
    this.begin('closeWithError', [connectionId, code, message]);
    const connection = this.connections.get(connectionId);
    if (connection !== undefined) {
      this.terminate(connection, 'error', code, message);
    }
  }

  // ---------------------------------------------------------------------
  // Connection test controls
  // ---------------------------------------------------------------------

  /**
   * How connect attempts behave per device id (upper-case address on
   * Android, accessory id on iOS). The default is `'accept'`.
   */
  readonly connectResponses = new Map<
    string,
    'accept' | 'fail' | 'hang' | 'sessionFail'
  >();
  /** How writes behave: accepted, OS error, or never accepted. */
  writeBehavior: 'accept' | 'fail' | 'stall' = 'accept';
  /** Called right after a connection opens, before `connect()` resolves. */
  onConnectionOpened: ((connectionId: string) => void) | undefined;

  /** Simulates a remote device connecting to a pending `accept()`. */
  incomingConnection(address: string): string {
    const pending = this.pendingAccept;
    if (pending === null) {
      throw new Error('No accept() is pending');
    }
    const key = address.toUpperCase();
    if (!this.devices.has(key)) {
      this.addDevice({ address: key });
    }
    const connection = this.openConnection({
      key,
      device: this.devices.get(key)!,
    });
    pending.resolve(connection);
    return connection.id;
  }

  /** Simulates bytes arriving from the remote device. */
  pushData(connectionId: string, data: Uint8Array | string): void {
    const connection = this.connections.get(connectionId);
    if (connection === undefined || connection.state === 'disconnected') {
      throw new Error(`Connection ${connectionId} is not open`);
    }
    const bytes = typeof data === 'string' ? encodeText(data, 'utf8') : data;
    this.onData.emit({
      connectionId,
      data: toBase64(bytes),
      seq: connection.seq++,
    });
  }

  /** Simulates the remote device closing the link. */
  remoteClose(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection !== undefined) this.terminate(connection, 'remote');
  }

  /** Simulates the connection failing with `code`. */
  failConnection(
    connectionId: string,
    code: string = ErrorCode.CONNECTION_LOST
  ): void {
    const connection = this.connections.get(connectionId);
    if (connection !== undefined) {
      this.terminate(connection, 'error', code, `Simulated ${code}`, {
        nativeCode: 'IOException',
        nativeMessage: 'Broken pipe',
      });
    }
  }

  /** Every byte written to the connection, in order. */
  writtenBytes(connectionId: string): Uint8Array {
    return Uint8Array.from(this.connections.get(connectionId)?.written ?? []);
  }

  private connectTarget(
    deviceId: string,
    options: NativeConnectOptions
  ): ConnectTarget {
    if (this.platform.os === 'android') {
      const key = deviceId.toUpperCase();
      const device = this.devices.get(key);
      if (device === undefined) {
        throw nativeRejection(ErrorCode.CONNECT_FAILED, 'Device unreachable', {
          deviceId: key,
          nativeCode: 'IOException',
          nativeMessage: 'read failed, socket might closed or timeout',
        });
      }
      return { key, device };
    }
    const accessory = this.accessories.get(deviceId);
    if (accessory === undefined) {
      throw nativeRejection(
        ErrorCode.ACCESSORY_NOT_CONNECTED,
        'The accessory is not connected',
        { deviceId }
      );
    }
    let protocol = options.protocol;
    if (protocol !== undefined) {
      if (!this.declaredProtocols.includes(protocol)) {
        throw nativeRejection(
          ErrorCode.PROTOCOL_NOT_DECLARED,
          `${protocol} is not declared in UISupportedExternalAccessoryProtocols`
        );
      }
      if (!accessory.protocolStrings.includes(protocol)) {
        throw nativeRejection(
          ErrorCode.PROTOCOL_NOT_SUPPORTED,
          `The accessory does not support ${protocol}`
        );
      }
    } else {
      protocol = this.declaredProtocols.find((p) =>
        accessory.protocolStrings.includes(p)
      );
      if (protocol === undefined) {
        throw nativeRejection(
          ErrorCode.PROTOCOL_NOT_SUPPORTED,
          'The accessory supports none of the declared protocols'
        );
      }
    }
    return { key: `${deviceId}|${protocol}`, accessory, protocol };
  }

  private openConnection(target: ConnectTarget): FakeConnection {
    const connection: FakeConnection = {
      id: `conn-${this.nextConnectionId++}`,
      targetKey: target.key,
      state: 'connected',
      connectedAt: Date.now(),
      seq: 0,
      written: [],
      writeChain: Promise.resolve(),
      disconnecting: null,
      stalledWrites: new Set(),
    };
    if (target.device !== undefined) connection.device = target.device;
    if (target.accessory !== undefined) connection.accessory = target.accessory;
    if (target.protocol !== undefined) connection.protocol = target.protocol;
    this.connections.set(connection.id, connection);
    return connection;
  }

  private async performWrite(
    connection: FakeConnection,
    bytes: Uint8Array,
    timeoutMs: number
  ): Promise<void> {
    if (connection.state === 'disconnected') {
      throw nativeRejection(ErrorCode.NOT_CONNECTED, 'Not connected', {
        connectionId: connection.id,
      });
    }
    switch (this.writeBehavior) {
      case 'accept':
        connection.written.push(...bytes);
        return;
      case 'fail':
        this.terminate(
          connection,
          'error',
          ErrorCode.WRITE_FAILED,
          'Broken pipe'
        );
        throw nativeRejection(ErrorCode.WRITE_FAILED, 'Broken pipe', {
          connectionId: connection.id,
        });
      case 'stall':
        await new Promise<void>((_resolve, reject) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const stalled = (error: Error) => {
            clearTimeout(timer);
            connection.stalledWrites.delete(stalled);
            reject(error);
          };
          connection.stalledWrites.add(stalled);
          if (timeoutMs > 0) {
            timer = setTimeout(() => {
              stalled(
                nativeRejection(ErrorCode.WRITE_TIMEOUT, 'Write timed out', {
                  connectionId: connection.id,
                })
              );
              this.terminate(
                connection,
                'error',
                ErrorCode.WRITE_TIMEOUT,
                'Write timed out'
              );
            }, timeoutMs);
          }
        });
    }
  }

  private setConnectionState(
    connection: FakeConnection,
    state: FakeConnection['state'],
    extra: Partial<NativeConnectionStateEvent> = {}
  ): void {
    const previousState = connection.state;
    connection.state = state;
    this.onConnectionStateChange.emit({
      connectionId: connection.id,
      state,
      previousState,
      timestamp: Date.now(),
      ...extra,
    });
  }

  private terminate(
    connection: FakeConnection,
    reason: 'local' | 'remote' | 'error',
    errorCode?: string,
    errorMessage?: string,
    nativeInfo: { nativeCode?: string; nativeMessage?: string } = {}
  ): void {
    if (connection.state === 'disconnected') {
      return;
    }
    const extra: Partial<NativeConnectionStateEvent> = {
      reason,
      ...nativeInfo,
    };
    if (errorCode !== undefined) extra.errorCode = errorCode;
    if (errorMessage !== undefined) extra.errorMessage = errorMessage;
    this.setConnectionState(connection, 'disconnected', extra);
    for (const stalled of Array.from(connection.stalledWrites)) {
      stalled(
        nativeRejection(ErrorCode.NOT_CONNECTED, 'Not connected', {
          connectionId: connection.id,
        })
      );
    }
  }

  private toNativeConnection(connection: FakeConnection): NativeConnection {
    const native: NativeConnection = {
      id: connection.id,
      state: connection.state,
      connectedAt: connection.connectedAt,
    };
    if (connection.device !== undefined) {
      native.androidDevice = this.toNative(connection.device);
    }
    if (connection.accessory !== undefined) {
      native.accessory = connection.accessory;
    }
    if (connection.protocol !== undefined) {
      native.protocol = connection.protocol;
    }
    return native;
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  /** Records the call and applies a queued `failNext`. */
  private begin(method: keyof Spec, args: unknown[]): void {
    this.record(method, args);
    const failure = this.failures.get(method)?.shift();
    if (failure !== undefined) {
      throw nativeRejection(failure.code, failure.message, failure.userInfo);
    }
  }

  /** Like `begin` for methods that return a promise without being `async`. */
  private run<T>(
    method: keyof Spec,
    args: unknown[],
    body: () => Promise<T>
  ): Promise<T> {
    try {
      this.begin(method, args);
      return body();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private apiLevel(): number {
    return this.platform.os === 'android' ? this.platform.apiLevel : 0;
  }

  private androidOnly(): void {
    if (this.platform.os !== 'android') {
      throw nativeRejection(ErrorCode.UNSUPPORTED_ON_PLATFORM, 'Android only');
    }
  }

  private iosOnly(): void {
    if (this.platform.os !== 'ios') {
      throw nativeRejection(ErrorCode.UNSUPPORTED_ON_PLATFORM, 'iOS only');
    }
  }

  private requireHardware(): void {
    if (this.adapterState === 'unavailable') {
      throw nativeRejection(
        ErrorCode.BLUETOOTH_UNAVAILABLE,
        'This device has no Bluetooth adapter'
      );
    }
  }

  private requirePermissions(scope: string): void {
    const { missing } = this.permissionStatus(scope);
    if (missing.length > 0) {
      throw nativeRejection(
        ErrorCode.PERMISSION_DENIED,
        `Missing permissions: ${missing.join(', ')}`,
        { missingPermissions: missing }
      );
    }
  }

  /** Precondition order: hardware, permissions, adapter on. */
  private requireAdapter(scope: string): void {
    this.requireHardware();
    this.requirePermissions(scope);
    if (this.adapterState !== 'on') {
      throw nativeRejection(ErrorCode.BLUETOOTH_DISABLED, 'Bluetooth is off');
    }
  }

  private requiredPermissions(scope: string): string[][] {
    const api = this.apiLevel();
    if (api >= 31) {
      return scope === 'discovery' ? [[SCAN], [CONNECT]] : [[CONNECT]];
    }
    if (scope !== 'discovery') {
      return [];
    }
    // Each inner list is satisfied by any one of its permissions.
    return api >= 29 ? [[FINE]] : [[COARSE, FINE]];
  }

  private permissionStatus(scope: string): NativePermissionStatus {
    const missing = this.requiredPermissions(scope)
      .filter((alternatives) =>
        alternatives.every((p) => !this.grantedPermissions.has(p))
      )
      .map((alternatives) => alternatives[0] as string);
    const status: NativePermissionStatus = {
      granted: missing.length === 0,
      missing,
    };
    if (scope === 'discovery' && this.apiLevel() <= 30) {
      status.locationServicesEnabled = this.locationServicesEnabled;
    }
    return status;
  }

  private endDiscovery(): void {
    const session = this.discovery;
    if (session === null) return;
    session.timers.forEach(clearTimeout);
    this.discovery = null;
  }

  private setBondState(
    device: FakeDevice,
    state: FakeDevice['bondState']
  ): void {
    const previousState = device.bondState;
    if (previousState === state) return;
    device.bondState = state;
    this.onBondStateChange.emit({
      device: this.toNative(device),
      state,
      previousState,
      timestamp: Date.now(),
    });
  }

  private supportsDeclaredProtocol(accessory: NativeAccessory): boolean {
    return accessory.protocolStrings.some((p) =>
      this.declaredProtocols.includes(p)
    );
  }

  private toNative(device: FakeDevice, withRssi = false): NativeAndroidDevice {
    const native: NativeAndroidDevice = {
      id: device.address,
      address: device.address,
      name: device.name,
      bondState: device.bondState,
      type: device.type,
      deviceClass: device.deviceClass,
    };
    if (withRssi && device.rssi !== undefined) {
      native.rssi = device.rssi;
    }
    return native;
  }
}
