import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../../../src/__fakes__/install';
import { DiscoveryScreen } from '../screens/DiscoveryScreen';
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
