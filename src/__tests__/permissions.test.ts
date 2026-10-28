import {
  ErrorCode,
  checkPermissions,
  getBondedDevices,
  requestPermissions,
  startDiscovery,
} from '../index';
import {
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../__fakes__/install';
import type { FakeNativeModule } from '../__fakes__/FakeNativeModule';

afterEach(() => uninstallFakeNativeModule());

function noPermissions(apiLevel: number): FakeNativeModule {
  const fake = installFakeNativeModule({ os: 'android', apiLevel });
  fake.grantedPermissions.clear();
  return fake;
}

describe('permission scopes per API band', () => {
  it.each([
    [24, 'discovery', ['ACCESS_COARSE_LOCATION']],
    [28, 'discovery', ['ACCESS_COARSE_LOCATION']],
    [29, 'discovery', ['ACCESS_FINE_LOCATION']],
    [30, 'discovery', ['ACCESS_FINE_LOCATION']],
    [31, 'discovery', ['BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT']],
    [36, 'discovery', ['BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT']],
    [24, 'connect', []],
    [30, 'server', []],
    [31, 'connect', ['BLUETOOTH_CONNECT']],
    [37, 'server', ['BLUETOOTH_CONNECT']],
  ] as const)('API %i scope %s needs %j', async (apiLevel, scope, missing) => {
    noPermissions(apiLevel);
    const status = await checkPermissions(scope);
    expect(status.missing).toEqual(missing);
    expect(status.granted).toBe(missing.length === 0);
  });

  it('accepts ACCESS_FINE_LOCATION for discovery on API 24-28', async () => {
    const fake = noPermissions(26);
    fake.grantedPermissions.add('ACCESS_FINE_LOCATION');
    await expect(checkPermissions('discovery')).resolves.toMatchObject({
      granted: true,
    });
  });
});

describe('checkPermissions', () => {
  it('reports Location Services on API 29-30 discovery without prompting', async () => {
    const fake = installFakeNativeModule({ os: 'android', apiLevel: 30 });
    fake.locationServicesEnabled = false;
    await expect(checkPermissions('discovery')).resolves.toEqual({
      granted: true,
      missing: [],
      locationServicesEnabled: false,
    });
    expect(fake.calls.map((c) => c.method)).toEqual(['checkPermissions']);
  });

  it('omits locationServicesEnabled on API 31+', async () => {
    installFakeNativeModule({ os: 'android', apiLevel: 33 });
    const status = await checkPermissions('discovery');
    expect(status).not.toHaveProperty('locationServicesEnabled');
  });

  it('resolves connect as granted on iOS', async () => {
    const fake = installFakeNativeModule({ os: 'ios' });
    await expect(checkPermissions('connect')).resolves.toEqual({
      granted: true,
      missing: [],
    });
    expect(fake.calls).toEqual([]);
  });

  it.each(['discovery', 'server'] as const)(
    'rejects %s on iOS with UNSUPPORTED_ON_PLATFORM',
    async (scope) => {
      installFakeNativeModule({ os: 'ios' });
      await expect(checkPermissions(scope)).rejects.toMatchObject({
        code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
      });
    }
  );

  it('rejects unknown scopes', async () => {
    installFakeNativeModule();
    await expect(checkPermissions('scan' as never)).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });
});

describe('requestPermissions', () => {
  it('grants missing permissions on API 31+', async () => {
    noPermissions(31);
    await expect(requestPermissions('discovery')).resolves.toEqual({
      granted: true,
      missing: [],
      canAskAgain: true,
    });
  });

  it('reports permanently denied permissions without prompting again', async () => {
    const fake = noPermissions(33);
    fake.blockedPermissions.add('BLUETOOTH_CONNECT');
    await expect(requestPermissions('connect')).resolves.toEqual({
      granted: false,
      missing: ['BLUETOOTH_CONNECT'],
      canAskAgain: false,
    });
  });

  it('reports canAskAgain after a plain denial', async () => {
    const fake = noPermissions(33);
    fake.permissionPromptResponse = 'deny';
    await expect(requestPermissions('connect')).resolves.toMatchObject({
      granted: false,
      canAskAgain: true,
    });
  });

  it('resolves without prompting when already granted', async () => {
    const fake = installFakeNativeModule({ os: 'android', apiLevel: 33 });
    fake.hasForegroundActivity = false;
    await expect(requestPermissions('connect')).resolves.toMatchObject({
      granted: true,
    });
  });

  it('rejects with ACTIVITY_UNAVAILABLE without a foreground activity', async () => {
    const fake = noPermissions(33);
    fake.hasForegroundActivity = false;
    await expect(requestPermissions('connect')).rejects.toMatchObject({
      code: ErrorCode.ACTIVITY_UNAVAILABLE,
    });
  });

  it('follows checkPermissions rules on iOS', async () => {
    installFakeNativeModule({ os: 'ios' });
    await expect(requestPermissions('connect')).resolves.toMatchObject({
      granted: true,
    });
    await expect(requestPermissions('server')).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });
});

describe('operations check permissions first', () => {
  it('rejects discovery on API 31+ without BLUETOOTH_SCAN', async () => {
    const fake = installFakeNativeModule({ os: 'android', apiLevel: 31 });
    fake.grantedPermissions.delete('BLUETOOTH_SCAN');
    await expect(startDiscovery()).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      missingPermissions: ['BLUETOOTH_SCAN'],
    });
  });

  it('rejects discovery on API 29-30 without location instead of hanging', async () => {
    noPermissions(29);
    await expect(startDiscovery()).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      missingPermissions: ['ACCESS_FINE_LOCATION'],
    });
  });

  it('rejects bonded-device listing on API 31+ without BLUETOOTH_CONNECT', async () => {
    noPermissions(34);
    await expect(getBondedDevices()).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      missingPermissions: ['BLUETOOTH_CONNECT'],
    });
  });
});

describe('Location Services for discovery', () => {
  it('rejects with LOCATION_SERVICES_DISABLED on API 29 when off', async () => {
    const fake = installFakeNativeModule({ os: 'android', apiLevel: 29 });
    fake.locationServicesEnabled = false;
    await expect(startDiscovery()).rejects.toMatchObject({
      code: ErrorCode.LOCATION_SERVICES_DISABLED,
    });
  });

  it('ignores Location Services on API 33', async () => {
    jest.useFakeTimers();
    try {
      const fake = installFakeNativeModule({ os: 'android', apiLevel: 33 });
      fake.locationServicesEnabled = false;
      const discovery = startDiscovery({ timeoutMs: 1000 });
      await jest.advanceTimersByTimeAsync(1000);
      await expect(discovery).resolves.toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});
