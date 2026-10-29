import * as BluetoothClassic from '../index';
import { ErrorCode, isBluetoothClassicError } from '../index';
import {
  emulateMissingNativeModule,
  emulateUnsupportedHost,
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../__fakes__/install';

afterEach(() => uninstallFakeNativeModule());

/** Calls every async API with arguments that are invalid in some way. */
const asyncCalls: Array<[string, () => Promise<unknown>]> = [
  ['getAdapterState', () => BluetoothClassic.getAdapterState()],
  ['requestEnable', () => BluetoothClassic.requestEnable()],
  ['openSettings', () => BluetoothClassic.openSettings()],
  ['setAdapterName', () => BluetoothClassic.setAdapterName(42 as never)],
  [
    'checkPermissions',
    () => BluetoothClassic.checkPermissions('nope' as never),
  ],
  [
    'requestPermissions',
    () => BluetoothClassic.requestPermissions(null as never),
  ],
  ['getBondedDevices', () => BluetoothClassic.getBondedDevices()],
  ['startDiscovery', () => BluetoothClassic.startDiscovery({ timeoutMs: -1 })],
  ['cancelDiscovery', () => BluetoothClassic.cancelDiscovery()],
  ['pair', () => BluetoothClassic.pair({} as never, 'x' as never)],
  ['unpair', () => BluetoothClassic.unpair(undefined as never)],
  ['getConnectedAccessories', () => BluetoothClassic.getConnectedAccessories()],
  [
    'showAccessoryPicker',
    () => BluetoothClassic.showAccessoryPicker([] as never),
  ],
];

const environments: Array<[string, () => void]> = [
  [
    'Android API 24',
    () => {
      installFakeNativeModule({ os: 'android', apiLevel: 24 });
    },
  ],
  [
    'Android API 37',
    () => {
      installFakeNativeModule({ os: 'android', apiLevel: 37 });
    },
  ],
  [
    'iOS',
    () => {
      installFakeNativeModule({ os: 'ios' });
    },
  ],
  ['missing module (Android)', () => emulateMissingNativeModule('android')],
  ['missing module (iOS)', () => emulateMissingNativeModule('ios')],
  ['unsupported host', () => emulateUnsupportedHost()],
];

describe.each(environments)('on %s', (_name, setup) => {
  it.each(asyncCalls)(
    '%s returns a promise and never throws synchronously',
    async (_api, call) => {
      setup();
      let result: Promise<unknown> | undefined;
      expect(() => {
        result = call();
      }).not.toThrow();
      expect(result).toBeInstanceOf(Promise);
      const outcome = await result!.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
      if ('error' in outcome) {
        expect(isBluetoothClassicError(outcome.error)).toBe(true);
      }
    }
  );
});

it('rejects invalid arguments before any native work', async () => {
  const fake = installFakeNativeModule({ os: 'android', apiLevel: 34 });
  await expect(
    BluetoothClassic.startDiscovery({ timeoutMs: -1 })
  ).rejects.toMatchObject({
    code: ErrorCode.INVALID_ARGUMENT,
    message: expect.stringContaining('timeoutMs'),
  });
  expect(fake.calls).toEqual([]);
});
