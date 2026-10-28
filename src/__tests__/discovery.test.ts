import {
  ErrorCode,
  cancelDiscovery,
  getBondedDevices,
  onDeviceFound,
  startDiscovery,
  type DeviceFoundEvent,
} from '../index';
import {
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../__fakes__/install';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  uninstallFakeNativeModule();
});

describe('device objects', () => {
  it('maps Android devices to frozen objects with upper-case ids', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({
      address: '00:11:22:aa:bb:cc',
      name: 'Printer',
      bonded: true,
    });

    const [device] = await getBondedDevices();

    expect(device).toEqual({
      id: '00:11:22:AA:BB:CC',
      address: '00:11:22:AA:BB:CC',
      name: 'Printer',
      bondState: 'bonded',
      type: 'classic',
      deviceClass: { major: 1536, value: 1664 },
    });
    expect(Object.isFrozen(device)).toBe(true);
    expect(Object.isFrozen(device?.deviceClass)).toBe(true);
  });

  it('reports unknown names as null', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: '00:11:22:AA:BB:CC', name: null, bonded: true });
    const [device] = await getBondedDevices();
    expect(device?.name).toBeNull();
  });
});

describe('getBondedDevices', () => {
  it('lists only bonded devices', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: '00:00:00:00:00:01', bonded: true });
    fake.addDevice({ address: '00:00:00:00:00:02' });
    const devices = await getBondedDevices();
    expect(devices.map((d) => d.id)).toEqual(['00:00:00:00:00:01']);
    expect(devices.every((d) => d.bondState === 'bonded')).toBe(true);
  });

  it('rejects with BLUETOOTH_DISABLED when the adapter is off', async () => {
    const fake = installFakeNativeModule();
    fake.adapterState = 'off';
    await expect(getBondedDevices()).rejects.toMatchObject({
      code: ErrorCode.BLUETOOTH_DISABLED,
    });
  });

  it('rejects with UNSUPPORTED_ON_PLATFORM on iOS', async () => {
    installFakeNativeModule({ os: 'ios' });
    await expect(getBondedDevices()).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });
});

describe('startDiscovery', () => {
  it('reports each device once and resolves when the OS finishes', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: '00:00:00:00:00:01', name: 'A', rssi: -40 });
    fake.addDevice({ address: '00:00:00:00:00:02', name: 'B', bonded: true });
    fake.addDevice({ address: '00:00:00:00:00:03', discoverable: false });
    const found: DeviceFoundEvent[] = [];
    onDeviceFound((e) => found.push(e));

    const discovery = startDiscovery();
    await jest.advanceTimersByTimeAsync(0);
    // The OS reports a device a second time with an updated name.
    fake.onDeviceFound.emit({
      device: {
        id: '00:00:00:00:00:01',
        address: '00:00:00:00:00:01',
        name: 'A (renamed)',
        bondState: 'none',
        type: 'classic',
        deviceClass: null,
        rssi: -42,
      },
      timestamp: Date.now(),
    });
    await jest.advanceTimersByTimeAsync(fake.discoveryDurationMs);
    const devices = await discovery;

    expect(found.map((e) => e.device.id)).toEqual([
      '00:00:00:00:00:01',
      '00:00:00:00:00:02',
    ]);
    expect(found[0]?.device.rssi).toBe(-40);
    expect(devices.map((d) => d.id).sort()).toEqual([
      '00:00:00:00:00:01',
      '00:00:00:00:00:02',
    ]);
  });

  it('keeps one entry per address in the resolved list, the latest one', async () => {
    const fake = installFakeNativeModule();
    jest.spyOn(fake, 'startDiscovery').mockResolvedValue([
      {
        id: 'X',
        address: '00:00:00:00:00:01',
        name: 'old',
        bondState: 'none',
        type: 'classic',
        deviceClass: null,
        rssi: -80,
      },
      {
        id: 'X',
        address: '00:00:00:00:00:01',
        name: 'new',
        bondState: 'none',
        type: 'classic',
        deviceClass: null,
        rssi: -50,
      },
    ]);
    const devices = await startDiscovery();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ name: 'new', rssi: -50 });
  });

  it('ends no later than timeoutMs with the devices found so far', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: '00:00:00:00:00:01' });
    const discovery = startDiscovery({ timeoutMs: 5000 });
    await jest.advanceTimersByTimeAsync(5000);
    await expect(discovery).resolves.toHaveLength(1);
    expect(fake.calls.find((c) => c.method === 'startDiscovery')?.args).toEqual(
      [5000]
    );
  });

  it('passes 0 to native when no timeout is given', async () => {
    const fake = installFakeNativeModule();
    const discovery = startDiscovery();
    await jest.advanceTimersByTimeAsync(fake.discoveryDurationMs);
    await discovery;
    expect(fake.calls.find((c) => c.method === 'startDiscovery')?.args).toEqual(
      [0]
    );
  });

  it('rejects a second session with DISCOVERY_ALREADY_RUNNING', async () => {
    const fake = installFakeNativeModule();
    const first = startDiscovery();
    await expect(startDiscovery()).rejects.toMatchObject({
      code: ErrorCode.DISCOVERY_ALREADY_RUNNING,
    });
    await jest.advanceTimersByTimeAsync(fake.discoveryDurationMs);
    await expect(first).resolves.toEqual([]);
  });

  it('rejects with BLUETOOTH_DISABLED when the adapter turns off mid-session', async () => {
    const fake = installFakeNativeModule();
    const discovery = startDiscovery();
    fake.setAdapterState('off');
    await expect(discovery).rejects.toMatchObject({
      code: ErrorCode.BLUETOOTH_DISABLED,
    });
  });

  it('rejects with DISCOVERY_FAILED when the OS refuses to start', async () => {
    const fake = installFakeNativeModule();
    fake.failNext(
      'startDiscovery',
      'DISCOVERY_FAILED',
      'startDiscovery() returned false'
    );
    await expect(startDiscovery()).rejects.toMatchObject({
      code: ErrorCode.DISCOVERY_FAILED,
    });
  });

  it.each([0, 120_001, 1.5])('rejects timeoutMs %p', async (timeoutMs) => {
    const fake = installFakeNativeModule();
    await expect(startDiscovery({ timeoutMs })).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
    expect(fake.calls).toEqual([]);
  });

  it('rejects with UNSUPPORTED_ON_PLATFORM on iOS', async () => {
    installFakeNativeModule({ os: 'ios' });
    await expect(startDiscovery()).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });

  it('allows a new session after the previous one ends', async () => {
    const fake = installFakeNativeModule();
    const first = startDiscovery({ timeoutMs: 10 });
    await jest.advanceTimersByTimeAsync(10);
    await first;
    const second = startDiscovery({ timeoutMs: 10 });
    await jest.advanceTimersByTimeAsync(10);
    await expect(second).resolves.toEqual([]);
    expect(
      fake.calls.filter((c) => c.method === 'startDiscovery')
    ).toHaveLength(2);
  });
});

describe('cancelDiscovery', () => {
  it('stops the session and resolves it with the devices found so far', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: '00:00:00:00:00:01' });
    fake.addDevice({ address: '00:00:00:00:00:02' });
    const discovery = startDiscovery();
    await jest.advanceTimersByTimeAsync(0);

    await expect(cancelDiscovery()).resolves.toBeUndefined();
    await expect(discovery).resolves.toHaveLength(2);
  });

  it('resolves when nothing is running', async () => {
    installFakeNativeModule();
    await expect(cancelDiscovery()).resolves.toBeUndefined();
  });

  it('rejects with UNSUPPORTED_ON_PLATFORM on iOS', async () => {
    installFakeNativeModule({ os: 'ios' });
    await expect(cancelDiscovery()).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });
});
