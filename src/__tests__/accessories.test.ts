import {
  ErrorCode,
  getConnectedAccessories,
  onAccessoryConnected,
  onAccessoryDisconnected,
  showAccessoryPicker,
} from '../index';
import {
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../__fakes__/install';
import type { FakeNativeModule } from '../__fakes__/FakeNativeModule';

afterEach(() => uninstallFakeNativeModule());

function ios(): FakeNativeModule {
  const fake = installFakeNativeModule({ os: 'ios', version: '26.0' });
  fake.declaredProtocols = ['com.acme.serial', 'com.acme.update'];
  return fake;
}

describe('getConnectedAccessories', () => {
  it('lists accessories that support a declared protocol', async () => {
    const fake = ios();
    fake.connectAccessory({
      id: '7',
      name: 'Scanner',
      protocolStrings: ['com.acme.update'],
      serialNumber: 'S7',
    });
    fake.connectAccessory({
      id: '8',
      name: 'Other',
      protocolStrings: ['com.other'],
    });

    const accessories = await getConnectedAccessories();

    expect(accessories).toEqual([
      {
        id: '7',
        name: 'Scanner',
        manufacturer: 'Acme',
        modelNumber: 'M1',
        serialNumber: 'S7',
        firmwareRevision: '1.0.0',
        hardwareRevision: '1.0',
        protocolStrings: ['com.acme.update'],
      },
    ]);
    expect(Object.isFrozen(accessories[0])).toBe(true);
    expect(Object.isFrozen(accessories[0]?.protocolStrings)).toBe(true);
  });

  it('reports a new id with the same serial number after a reconnect', async () => {
    const fake = ios();
    fake.connectAccessory({
      id: '1',
      name: 'Scanner',
      protocolStrings: ['com.acme.serial'],
      serialNumber: 'S',
    });
    fake.disconnectAccessory('1');
    fake.connectAccessory({
      id: '2',
      name: 'Scanner',
      protocolStrings: ['com.acme.serial'],
      serialNumber: 'S',
    });
    const [accessory] = await getConnectedAccessories();
    expect(accessory).toMatchObject({ id: '2', serialNumber: 'S' });
  });

  it('rejects with UNSUPPORTED_ON_PLATFORM on Android', async () => {
    installFakeNativeModule();
    await expect(getConnectedAccessories()).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });
});

describe('showAccessoryPicker', () => {
  it('resolves and the accessory connects when the user selects one', async () => {
    const fake = ios();
    fake.pickerResponse = {
      type: 'select',
      accessory: { name: 'Scanner', protocolStrings: ['com.acme.serial'] },
    };
    const connected = jest.fn();
    onAccessoryConnected(connected);

    await expect(
      showAccessoryPicker({ nameFilter: 'Scan' })
    ).resolves.toBeUndefined();

    expect(connected).toHaveBeenCalledWith({
      accessory: expect.objectContaining({ name: 'Scanner' }),
      timestamp: expect.any(Number),
    });
    expect(
      fake.calls.find((c) => c.method === 'showAccessoryPicker')?.args
    ).toEqual(['Scan']);
  });

  it('passes null when no filter is given', async () => {
    const fake = ios();
    fake.pickerResponse = { type: 'select' };
    await showAccessoryPicker();
    expect(
      fake.calls.find((c) => c.method === 'showAccessoryPicker')?.args
    ).toEqual([null]);
  });

  it.each([
    ['cancel', ErrorCode.USER_REJECTED],
    ['notFound', ErrorCode.DEVICE_NOT_FOUND],
    ['failed', ErrorCode.UNKNOWN],
  ] as const)('maps %s to %s', async (type, code) => {
    const fake = ios();
    fake.pickerResponse = { type };
    await expect(showAccessoryPicker()).rejects.toMatchObject({ code });
  });

  it('rejects with UNSUPPORTED_ON_PLATFORM on Android', async () => {
    installFakeNativeModule();
    await expect(showAccessoryPicker()).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });
});

describe('accessory events', () => {
  it('reports disconnects of accessories with a declared protocol only', () => {
    const fake = ios();
    const disconnected = jest.fn();
    onAccessoryDisconnected(disconnected);
    const a = fake.connectAccessory({
      name: 'A',
      protocolStrings: ['com.acme.serial'],
    });
    const b = fake.connectAccessory({
      name: 'B',
      protocolStrings: ['com.other'],
    });
    fake.disconnectAccessory(a);
    fake.disconnectAccessory(b);
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(disconnected.mock.calls[0][0].accessory.name).toBe('A');
  });
});
