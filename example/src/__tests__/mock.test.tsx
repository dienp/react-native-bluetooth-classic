// The Jest mock as an app's tests use it.
import {
  BluetoothClassicError,
  connect,
  delimiter,
  ErrorCode,
  getCapabilities,
  isBluetoothClassicError,
  startDiscovery,
  type DisconnectedEvent,
} from '@dynlabs/react-native-bluetooth-classic';
import { mock } from '@dynlabs/react-native-bluetooth-classic/jest';

jest.mock('@dynlabs/react-native-bluetooth-classic', () =>
  require('@dynlabs/react-native-bluetooth-classic/jest')
);

const PRINTER = '00:11:22:AA:BB:01';

beforeEach(() => {
  mock.reset();
  mock.addDevice({ address: PRINTER, name: 'Printer', bonded: true });
});

test('a reply pushed by the test reaches a delimiter reader as a frame', async () => {
  const connection = await connect(PRINTER);
  const reader = connection.createReader({
    framer: delimiter('\r\n'),
    encoding: 'utf8',
  });

  mock.pushData(connection.id, 'OK\r\n');

  await expect(reader.read({ timeoutMs: 1_000 })).resolves.toBe('OK');
});

test('the next connect fails with the configured code', async () => {
  mock.failNext('connect', ErrorCode.CONNECT_TIMEOUT);

  const error = await connect(PRINTER).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(BluetoothClassicError);
  expect(isBluetoothClassicError(error, ErrorCode.CONNECT_TIMEOUT)).toBe(true);
  // Only the next call fails.
  await expect(connect(PRINTER)).resolves.toBeDefined();
});

test('the test reads back exactly the bytes written, in order', async () => {
  const connection = await connect(PRINTER);

  await connection.write(new Uint8Array([0x1b, 0x40]));
  await connection.write('hi\n');

  expect(Array.from(mock.writtenBytes(connection.id))).toEqual([
    0x1b, 0x40, 0x68, 0x69, 0x0a,
  ]);
});

test('the test ends a connection with a reason and a code', async () => {
  const connection = await connect(PRINTER);
  const ended = new Promise<DisconnectedEvent>((resolve) =>
    connection.onDisconnected(resolve)
  );

  mock.endConnection(connection.id, 'error', ErrorCode.CONNECTION_LOST);

  const event = await ended;
  expect(event.reason).toBe('error');
  expect(event.error?.code).toBe(ErrorCode.CONNECTION_LOST);
});

test('emulating iOS: no discovery', async () => {
  mock.reset({ os: 'ios' });

  expect(getCapabilities().discovery).toBe(false);
  await expect(startDiscovery()).rejects.toMatchObject({
    code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
  });
});

test('emulating Android API 30 with Location Services off', async () => {
  mock.reset({ os: 'android', apiLevel: 30 });
  mock.native.locationServicesEnabled = false;

  await expect(startDiscovery()).rejects.toMatchObject({
    code: ErrorCode.LOCATION_SERVICES_DISABLED,
  });
});
