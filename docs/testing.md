# Testing

How to unit-test code that uses the library without Bluetooth hardware, and how the library itself is validated on devices.

## The Jest mock

`@dynlabs/react-native-bluetooth-classic/jest` is the library's real JavaScript API running on an in-memory fake of the native module. It has the same TypeScript types, `BluetoothClassicError` class and error codes as the real package, and the same validation, framing and connection behavior, because it is the same code. Enable it with one line per test file:

```ts
jest.mock('@dynlabs/react-native-bluetooth-classic', () =>
  require('@dynlabs/react-native-bluetooth-classic/jest')
);
```

The package ships ES modules. React Native's Jest preset transforms only a few packages in `node_modules`, so add this one to your Jest config:

```js
transformIgnorePatterns: [
  'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@dynlabs/react-native-bluetooth-classic)/)',
],
```

Then drive the fake devices through `mock`:

```ts
import { mock } from '@dynlabs/react-native-bluetooth-classic/jest';
```

| Control                                                      | What it does                                                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock.reset(platform?)`                                      | Starts over with no devices, connections or queued failures. `platform` is `{ os: 'android', apiLevel }` (default API 36) or `{ os: 'ios' }`. Call it in `beforeEach`. |
| `mock.addDevice({ address, name?, bonded?, discoverable? })` | Android: a device that `getBondedDevices()` lists when `bonded`, discovery finds when `discoverable` (default `true`), and `connect()` reaches.                        |
| `mock.setDeclaredProtocols(protocols)`                       | iOS: the `UISupportedExternalAccessoryProtocols` of the emulated app.                                                                                                  |
| `mock.connectAccessory({ name, protocolStrings })`           | iOS: an accessory connects to the OS; returns its `id`. `mock.disconnectAccessory(id)` removes it.                                                                     |
| `mock.onConnectionOpened(listener)`                          | Runs `listener(connectionId)` when a connection opens, before `connect()` or `accept()` resolves: a device that greets or answers at once.                             |
| `mock.pushData(connectionId, data)`                          | Bytes from the remote device. A string is sent as UTF-8.                                                                                                               |
| `mock.endConnection(connectionId, reason?, code?)`           | Ends a connection as `'remote'` (default) or as `'error'` with `code` (default `CONNECTION_LOST`).                                                                     |
| `mock.failNext(method, code, message?)`                      | The next call of `method` rejects with `code`. Library functions and `Connection` methods use the same names: `'connect'`, `'write'`, `'disconnect'`.                  |
| `mock.writtenBytes(connectionId)`                            | Every byte written to the connection, in order.                                                                                                                        |
| `mock.native`                                                | The fake native module, for anything else: `locationServicesEnabled`, `grantedPermissions`, `setAdapterState(state)`, `permissionPromptResponse`, `pickerResponse`.    |

### Example

This is the test CI runs, as `example/src/__tests__/testing-sample.test.ts`:

<!-- testing-sample:start -->

```ts
import {
  connect,
  decodeText,
  delimiter,
  ErrorCode,
} from '@dynlabs/react-native-bluetooth-classic';
import { mock } from '@dynlabs/react-native-bluetooth-classic/jest';

jest.mock('@dynlabs/react-native-bluetooth-classic', () =>
  require('@dynlabs/react-native-bluetooth-classic/jest')
);

const SCALE = '00:11:22:AA:BB:CC';

// The code under test: asks a serial scale for its weight.
async function readWeight(address: string): Promise<number> {
  const connection = await connect(address);
  try {
    const lines = connection.createReader({
      framer: delimiter('\r\n'),
      encoding: 'utf8',
    });
    await connection.write('W\r\n');
    return Number.parseFloat(await lines.read({ timeoutMs: 2_000 }));
  } finally {
    await connection.disconnect();
  }
}

beforeEach(() => {
  mock.reset({ os: 'android', apiLevel: 36 });
  mock.addDevice({ address: SCALE, name: 'Scale', bonded: true });
});

test('reads the weight the scale reports', async () => {
  let connectionId = '';
  // Play the scale: it answers as soon as the link is up.
  mock.onConnectionOpened((id) => {
    connectionId = id;
    mock.pushData(id, '12.5\r\n');
  });

  await expect(readWeight(SCALE)).resolves.toBe(12.5);
  expect(decodeText(mock.writtenBytes(connectionId))).toBe('W\r\n');
});

test('passes on a connect failure', async () => {
  mock.failNext('connect', ErrorCode.CONNECT_FAILED);

  await expect(readWeight(SCALE)).rejects.toMatchObject({
    code: ErrorCode.CONNECT_FAILED,
  });
});
```

<!-- testing-sample:end -->

### Platform emulation

The emulated platform decides what the API does, as on a device:

- With `{ os: 'ios' }`, `getCapabilities().discovery` is `false`, and `startDiscovery()`, `pair()` and `accept()` reject with `UNSUPPORTED_ON_PLATFORM`.
- With `{ os: 'android', apiLevel: 30 }` and `mock.native.locationServicesEnabled = false`, `startDiscovery()` rejects with `LOCATION_SERVICES_DISABLED`.
- Permission results follow the API level: on API 24–30 the `'discovery'` scope needs location permissions, on API 31+ `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT`.

## On devices

The example app (`example/`) has a screen for each area: adapter state and permissions, discovery and pairing (Android), the accessory picker (iOS), connecting, and an echo test that sends a random line to a loopback device and reports whether the same bytes came back, with the round-trip time. Run it on the release checklist's devices before each release.
