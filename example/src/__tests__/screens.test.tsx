import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { connect, decodeText } from '@dynlabs/react-native-bluetooth-classic';
import {
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../../../src/__fakes__/install';
import { AccessoriesScreen } from '../screens/AccessoriesScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { DiscoveryScreen } from '../screens/DiscoveryScreen';
import { EchoScreen } from '../screens/EchoScreen';
import { PairingScreen } from '../screens/PairingScreen';

const PRINTER = '00:11:22:AA:BB:01';
const SCALE = '00:11:22:AA:BB:02';

afterEach(() => uninstallFakeNativeModule());

test('the discovery screen lists what the fake discovers', async () => {
  const fake = installFakeNativeModule({ os: 'android', apiLevel: 36 });
  fake.discoveryDurationMs = 10;
  fake.addDevice({ address: PRINTER, name: 'Printer' });
  fake.addDevice({ address: SCALE, name: 'Scale', discoverable: false });

  await render(<DiscoveryScreen />);
  await fireEvent.press(screen.getByText('Start discovery'));

  expect(await screen.findByText('Finished: 1 device(s)')).toBeTruthy();
  expect(screen.getByText('Printer')).toBeTruthy();
  expect(screen.queryByText('Scale')).toBeNull();
});

test('the pairing screen lists bonded devices and pairs by address', async () => {
  const fake = installFakeNativeModule({ os: 'android', apiLevel: 36 });
  fake.addDevice({ address: SCALE, name: 'Scale', bonded: true });
  fake.addDevice({ address: PRINTER, name: 'Printer' });

  await render(<PairingScreen />);
  await fireEvent.press(screen.getByText('Refresh bonded devices'));
  expect(await screen.findByText('Scale')).toBeTruthy();

  await fireEvent.changeText(
    screen.getByPlaceholderText('00:11:22:AA:BB:CC'),
    PRINTER
  );
  await fireEvent.press(screen.getByText('Pair'));

  expect(await screen.findByText('Paired with Printer')).toBeTruthy();
  expect(screen.getByText(`${PRINTER}: none → bonding`)).toBeTruthy();
  expect(await screen.findByText(`Unpair ${PRINTER}`)).toBeTruthy();
});

test('the connect screen connects, accepts and disconnects', async () => {
  const fake = installFakeNativeModule({ os: 'android', apiLevel: 36 });
  fake.addDevice({ address: PRINTER, name: 'Printer', bonded: true });
  fake.addDevice({ address: SCALE, name: 'Scale' });

  await render(<ConnectScreen />);
  await fireEvent.changeText(
    screen.getByPlaceholderText('00:11:22:AA:BB:CC'),
    PRINTER
  );
  await fireEvent.press(screen.getByText('Connect'));
  expect(await screen.findByText('Connected conn-1 to Printer')).toBeTruthy();

  await fireEvent.press(screen.getByText('Accept'));
  await act(async () => {
    fake.incomingConnection(SCALE);
  });
  expect(await screen.findByText('Accepted conn-2 from Scale')).toBeTruthy();

  await fireEvent.press(await screen.findByText('Disconnect conn-1'));
  expect(await screen.findByText('conn-1 ended: local')).toBeTruthy();
  expect(screen.getByText('conn-1: connected → disconnecting')).toBeTruthy();
});

test('the echo screen sends lines, shows replies and checks an echo', async () => {
  const fake = installFakeNativeModule({ os: 'android', apiLevel: 36 });
  fake.addDevice({ address: PRINTER, name: 'Printer', bonded: true });
  const connection = await connect(PRINTER);

  await render(<EchoScreen />);
  expect(await screen.findByText('Using conn-1 (Printer)')).toBeTruthy();

  await fireEvent.changeText(
    screen.getByPlaceholderText('Text to send'),
    'ping'
  );
  await fireEvent.press(screen.getByText('Send'));
  expect(await screen.findByText('→ ping')).toBeTruthy();
  expect(decodeText(fake.writtenBytes(connection.id), 'utf8')).toBe('ping\r\n');

  await act(async () => fake.pushData(connection.id, 'pong\r\n'));
  expect(await screen.findByText('← pong')).toBeTruthy();

  // Play a loopback device: return whatever the echo test writes.
  const before = fake.writtenBytes(connection.id).length;
  await fireEvent.press(screen.getByText('Run echo test'));
  await act(async () => {
    while (fake.writtenBytes(connection.id).length === before) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    fake.pushData(
      connection.id,
      fake.writtenBytes(connection.id).slice(before)
    );
  });
  expect(await screen.findByText(/^Echo OK: 66 bytes/)).toBeTruthy();
});

test('the accessories screen lists accessories, shows the picker and connects', async () => {
  const fake = installFakeNativeModule({ os: 'ios', version: '27.0' });
  fake.declaredProtocols = ['com.acme.serial'];
  fake.connectAccessory({
    id: '7',
    name: 'Receipt printer',
    protocolStrings: ['com.acme.serial'],
  });
  fake.pickerResponse = {
    type: 'select',
    accessory: {
      id: '8',
      name: 'Scanner',
      protocolStrings: ['com.acme.serial'],
    },
  };

  await render(<AccessoriesScreen />);
  expect(await screen.findByText('Receipt printer')).toBeTruthy();

  await fireEvent.press(screen.getByText('Show accessory picker'));
  expect(
    await screen.findByText('Accessory connected: Scanner (8)')
  ).toBeTruthy();
  expect(await screen.findByText('Scanner')).toBeTruthy();

  await fireEvent.press(screen.getByText('Connect Receipt printer'));
  expect(
    await screen.findByText('Connected conn-1 with com.acme.serial')
  ).toBeTruthy();
});
