import {
  ErrorCode,
  getAdapterState,
  onAdapterStateChange,
  openSettings,
  requestEnable,
  setAdapterName,
} from '../index';
import {
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../__fakes__/install';

afterEach(() => uninstallFakeNativeModule());

describe('getAdapterState', () => {
  it('resolves with the Android adapter state', async () => {
    const fake = installFakeNativeModule();
    await expect(getAdapterState()).resolves.toBe('on');
    fake.adapterState = 'unavailable';
    await expect(getAdapterState()).resolves.toBe('unavailable');
  });

  it('rejects with UNSUPPORTED_ON_PLATFORM on iOS without calling native', async () => {
    const fake = installFakeNativeModule({ os: 'ios' });
    await expect(getAdapterState()).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
      platform: 'ios',
    });
    expect(fake.calls).toEqual([]);
  });
});

describe('adapter state events', () => {
  it('reports turningOff then off with previous states', () => {
    const fake = installFakeNativeModule();
    const events: unknown[] = [];
    onAdapterStateChange((e) => events.push([e.previousState, e.state]));
    fake.setAdapterState('turningOff');
    fake.setAdapterState('off');
    expect(events).toEqual([
      ['on', 'turningOff'],
      ['turningOff', 'off'],
    ]);
  });
});

describe('requestEnable', () => {
  it('resolves immediately when the adapter is already on', async () => {
    installFakeNativeModule();
    await expect(requestEnable()).resolves.toBeUndefined();
  });

  it('resolves after the adapter turns on when the user accepts', async () => {
    const fake = installFakeNativeModule();
    fake.adapterState = 'off';
    const states: string[] = [];
    onAdapterStateChange((e) => states.push(e.state));

    await requestEnable();

    expect(fake.adapterState).toBe('on');
    expect(states).toEqual(['turningOn', 'on']);
  });

  it('rejects with USER_REJECTED when the user declines', async () => {
    const fake = installFakeNativeModule();
    fake.adapterState = 'off';
    fake.enablePromptResponse = 'decline';
    await expect(requestEnable()).rejects.toMatchObject({
      code: ErrorCode.USER_REJECTED,
    });
  });

  it('shares one prompt between concurrent calls', async () => {
    const fake = installFakeNativeModule();
    fake.adapterState = 'off';
    const first = requestEnable();
    const second = requestEnable();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(fake.calls.filter((c) => c.method === 'requestEnable')).toHaveLength(
      1
    );
  });

  it('rejects with ACTIVITY_UNAVAILABLE without a foreground activity', async () => {
    const fake = installFakeNativeModule();
    fake.adapterState = 'off';
    fake.hasForegroundActivity = false;
    await expect(requestEnable()).rejects.toMatchObject({
      code: ErrorCode.ACTIVITY_UNAVAILABLE,
    });
  });

  it('rejects with PERMISSION_DENIED on API 31+ without BLUETOOTH_CONNECT', async () => {
    const fake = installFakeNativeModule({ os: 'android', apiLevel: 31 });
    fake.adapterState = 'off';
    fake.grantedPermissions.delete('BLUETOOTH_CONNECT');
    await expect(requestEnable()).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      missingPermissions: ['BLUETOOTH_CONNECT'],
    });
  });

  it('rejects with UNSUPPORTED_ON_PLATFORM on iOS', async () => {
    installFakeNativeModule({ os: 'ios' });
    await expect(requestEnable()).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });

  it('rejects with BLUETOOTH_UNAVAILABLE without hardware', async () => {
    const fake = installFakeNativeModule();
    fake.adapterState = 'unavailable';
    await expect(requestEnable()).rejects.toMatchObject({
      code: ErrorCode.BLUETOOTH_UNAVAILABLE,
    });
  });
});

describe('openSettings', () => {
  it.each([{ os: 'android', apiLevel: 33 } as const, { os: 'ios' } as const])(
    'resolves on %j',
    async (platform) => {
      installFakeNativeModule(platform);
      await expect(openSettings()).resolves.toBeUndefined();
    }
  );

  it('rejects with ACTIVITY_UNAVAILABLE when nothing can open settings', async () => {
    const fake = installFakeNativeModule();
    fake.hasForegroundActivity = false;
    await expect(openSettings()).rejects.toMatchObject({
      code: ErrorCode.ACTIVITY_UNAVAILABLE,
    });
  });
});

describe('setAdapterName', () => {
  it('sets the name', async () => {
    const fake = installFakeNativeModule();
    await setAdapterName('Kiosk 12');
    expect(fake.adapterName).toBe('Kiosk 12');
  });

  it.each(['', 'x'.repeat(249), '€'.repeat(83)])('rejects %j', async (name) => {
    const fake = installFakeNativeModule();
    await expect(setAdapterName(name)).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
    expect(fake.calls).toEqual([]);
  });

  it('accepts exactly 248 UTF-8 bytes', async () => {
    installFakeNativeModule();
    await expect(setAdapterName('x'.repeat(248))).resolves.toBeUndefined();
  });

  it('rejects with BLUETOOTH_DISABLED when the adapter is off', async () => {
    const fake = installFakeNativeModule();
    fake.adapterState = 'off';
    await expect(setAdapterName('x')).rejects.toMatchObject({
      code: ErrorCode.BLUETOOTH_DISABLED,
    });
  });

  it('rejects with UNSUPPORTED_ON_PLATFORM on iOS', async () => {
    installFakeNativeModule({ os: 'ios' });
    await expect(setAdapterName('x')).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });
});
