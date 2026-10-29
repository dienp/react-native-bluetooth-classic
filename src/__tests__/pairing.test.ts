import {
  ErrorCode,
  getCapabilities,
  onBondLost,
  onBondStateChange,
  pair,
  unpair,
  type BondStateChangeEvent,
} from '../index';
import {
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../__fakes__/install';

const ADDRESS = '00:11:22:AA:BB:CC';
const OTHER = '00:11:22:AA:BB:DD';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  uninstallFakeNativeModule();
});

describe('pair', () => {
  it('resolves with the bonded device after the user confirms', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: ADDRESS });
    const transitions: string[] = [];
    onBondStateChange((e) =>
      transitions.push(`${e.previousState}->${e.state}`)
    );

    const result = pair(ADDRESS.toLowerCase());
    await jest.advanceTimersByTimeAsync(0);

    await expect(result).resolves.toMatchObject({
      id: ADDRESS,
      bondState: 'bonded',
    });
    expect(transitions).toEqual(['none->bonding', 'bonding->bonded']);
  });

  it('resolves immediately when already bonded', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: ADDRESS, bonded: true });
    await expect(pair(ADDRESS)).resolves.toMatchObject({ bondState: 'bonded' });
  });

  it('rejects with PAIRING_FAILED when bonding ends without a bond', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: ADDRESS });
    fake.pairingResponses.set(ADDRESS, 'reject');
    const result = pair(ADDRESS);
    const outcome = result.catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(0);
    expect(await outcome).toMatchObject({
      code: ErrorCode.PAIRING_FAILED,
      deviceId: ADDRESS,
    });
  });

  it('ignores bond changes of other devices', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: ADDRESS });
    fake.addDevice({ address: OTHER });
    fake.pairingResponses.set(ADDRESS, 'ignore');
    fake.pairingResponses.set(OTHER, 'reject');

    const pending = pair(ADDRESS, { timeoutMs: 1000 });
    const other = pair(OTHER).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(0);
    await other;

    let settled = false;
    pending.then(
      () => (settled = true),
      () => (settled = true)
    );
    await jest.advanceTimersByTimeAsync(500);
    expect(settled).toBe(false);

    const outcome = pending.catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(500);
    expect(await outcome).toMatchObject({
      code: ErrorCode.PAIRING_TIMEOUT,
    });
  });

  it('times out with PAIRING_TIMEOUT using the 60 s default', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: ADDRESS });
    fake.pairingResponses.set(ADDRESS, 'ignore');
    const result = pair(ADDRESS);
    const outcome = result.catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(await outcome).toMatchObject({
      code: ErrorCode.PAIRING_TIMEOUT,
    });
    expect(fake.calls.find((c) => c.method === 'pair')?.args).toEqual([
      ADDRESS,
      60_000,
    ]);
  });

  it('rejects a duplicate call with PAIRING_IN_PROGRESS', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: ADDRESS });
    const first = pair(ADDRESS);
    await expect(pair(ADDRESS)).rejects.toMatchObject({
      code: ErrorCode.PAIRING_IN_PROGRESS,
    });
    await jest.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toMatchObject({ bondState: 'bonded' });
  });

  it('rejects with BLUETOOTH_DISABLED when the adapter turns off', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: ADDRESS });
    fake.pairingResponses.set(ADDRESS, 'ignore');
    const outcome = pair(ADDRESS).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(0);
    fake.setAdapterState('turningOff');
    expect(await outcome).toMatchObject({
      code: ErrorCode.BLUETOOTH_DISABLED,
      deviceId: ADDRESS,
    });
  });

  it('rejects malformed addresses with INVALID_ARGUMENT', async () => {
    const fake = installFakeNativeModule();
    await expect(pair('00:11:22')).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
    expect(fake.calls).toEqual([]);
  });

  it('rejects with UNSUPPORTED_ON_PLATFORM on iOS', async () => {
    installFakeNativeModule({ os: 'ios' });
    await expect(pair(ADDRESS)).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });
});

describe('unpair', () => {
  it.each([33, 36])(
    'removes the bond when the OS allows it (API %i)',
    async (apiLevel) => {
      const fake = installFakeNativeModule({ os: 'android', apiLevel });
      fake.addDevice({ address: ADDRESS, bonded: true });
      const events: BondStateChangeEvent[] = [];
      onBondStateChange((e) => events.push(e));
      await unpair(ADDRESS);
      expect(events.map((e) => e.state)).toEqual(['none']);
    }
  );

  it('resolves when the device is not bonded', async () => {
    const fake = installFakeNativeModule();
    fake.addDevice({ address: ADDRESS });
    await expect(unpair(ADDRESS)).resolves.toBeUndefined();
  });

  it.each([33, 36])(
    'rejects with UNSUPPORTED_ON_PLATFORM when the OS blocks it (API %i)',
    async (apiLevel) => {
      const fake = installFakeNativeModule({ os: 'android', apiLevel });
      fake.addDevice({ address: ADDRESS, bonded: true });
      fake.unpairBlocked = true;
      await expect(unpair(ADDRESS)).rejects.toMatchObject({
        code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
        message: expect.stringMatching(/system settings/),
      });
    }
  );

  it('rejects with UNSUPPORTED_ON_PLATFORM on iOS', async () => {
    installFakeNativeModule({ os: 'ios' });
    await expect(unpair(ADDRESS)).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });
});

describe('bond loss events', () => {
  it('fires on API 36+', () => {
    const fake = installFakeNativeModule({ os: 'android', apiLevel: 36 });
    fake.addDevice({ address: ADDRESS, bonded: true });
    const listener = jest.fn();
    onBondLost(listener);
    fake.loseBond(ADDRESS);
    expect(listener).toHaveBeenCalledWith({
      device: expect.objectContaining({ id: ADDRESS }),
      timestamp: expect.any(Number),
    });
  });

  it('accepts subscriptions on API 35 and reports the capability as false', () => {
    const fake = installFakeNativeModule({ os: 'android', apiLevel: 35 });
    fake.addDevice({ address: ADDRESS, bonded: true });
    const listener = jest.fn();
    expect(() => onBondLost(listener)).not.toThrow();
    fake.loseBond(ADDRESS);
    expect(listener).not.toHaveBeenCalled();
    expect(getCapabilities().bondLossEvents).toBe(false);
  });
});
