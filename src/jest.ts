/**
 * A Jest mock of the library: the real JavaScript API, running on an
 * in-memory fake of the native module. Enable it in a test file with
 *
 *   jest.mock('@dynlabs/react-native-bluetooth-classic', () =>
 *     require('@dynlabs/react-native-bluetooth-classic/jest')
 *   );
 *
 * and drive the fake devices through `mock`. See docs/testing.md.
 */
import { ErrorCode } from './errors/ErrorCode';
import {
  FakeNativeModule,
  type FakeAccessoryInit,
  type FakeDeviceInit,
  type FakePlatform,
} from './__fakes__/FakeNativeModule';
import { installFakeNativeModule } from './__fakes__/install';
import type { Spec } from './specs/NativeBluetoothClassic';

// Not './index': tests mock that module with this one.
export * from './exports';

export type MockPlatform = FakePlatform;
export type MockDevice = FakeDeviceInit;
export type MockAccessory = FakeAccessoryInit;
/** A native call `failNext` can make fail. Library functions and `Connection` methods share these names. */
export type MockMethod = Extract<
  {
    [K in keyof Spec]: Spec[K] extends (...args: never[]) => Promise<unknown>
      ? K
      : never;
  }[keyof Spec],
  keyof Spec
>;

let fake = installFakeNativeModule();

export const mock = {
  /**
   * Starts over with no devices, connections or queued failures, emulating
   * `platform` (Android API 36 by default). Call it in `beforeEach`.
   */
  reset(platform?: MockPlatform): void {
    fake = installFakeNativeModule(platform);
  },

  /** The fake native module, for settings the helpers below don't cover. */
  get native(): FakeNativeModule {
    return fake;
  },

  /** Android: a device that is bonded and/or found by discovery. */
  addDevice(device: MockDevice): void {
    fake.addDevice(device);
  },

  /** iOS: the protocols the app declares in `UISupportedExternalAccessoryProtocols`. */
  setDeclaredProtocols(protocols: readonly string[]): void {
    fake.declaredProtocols = [...protocols];
  },

  /** iOS: an accessory connects to the OS. Returns its id. */
  connectAccessory(accessory: MockAccessory): string {
    return fake.connectAccessory(accessory);
  },

  /** iOS: the accessory disconnects from the OS. */
  disconnectAccessory(id: string): void {
    fake.disconnectAccessory(id);
  },

  /**
   * Runs `listener` each time a connection opens, before `connect()` or
   * `accept()` resolves: a device that greets or answers at once. Bytes it
   * pushes wait for the connection's first reader.
   */
  onConnectionOpened(
    listener: ((connectionId: string) => void) | undefined
  ): void {
    fake.onConnectionOpened = listener;
  },

  /** Bytes arriving from the remote device; a string is sent as UTF-8. */
  pushData(connectionId: string, data: Uint8Array | string): void {
    fake.pushData(connectionId, data);
  },

  /** Ends a connection as the remote side would (`'remote'`), or with an error code (`'error'`). */
  endConnection(
    connectionId: string,
    reason: 'remote' | 'error' = 'remote',
    code: ErrorCode = ErrorCode.CONNECTION_LOST
  ): void {
    if (reason === 'remote') {
      fake.remoteClose(connectionId);
    } else {
      fake.failConnection(connectionId, code);
    }
  },

  /** Makes the next call of `method` reject with `code`. */
  failNext(method: MockMethod, code: ErrorCode, message?: string): void {
    fake.failNext(method, code, message);
  },

  /** Every byte written to the connection, in order. */
  writtenBytes(connectionId: string): Uint8Array {
    return fake.writtenBytes(connectionId);
  },
};
