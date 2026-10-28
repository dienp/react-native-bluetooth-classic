import {
  ErrorCode,
  getBondedDevices,
  getCapabilities,
  onAdapterStateChange,
  openSettings,
  setLogLevel,
  startDiscovery,
} from '../index';
import {
  emulateMissingNativeModule,
  emulateUnsupportedHost,
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../__fakes__/install';

afterEach(() => uninstallFakeNativeModule());

describe('runtime capability flags', () => {
  it.each([24, 30, 31, 35])('reports Android API %i', (apiLevel) => {
    installFakeNativeModule({ os: 'android', apiLevel });
    expect(getCapabilities()).toEqual({
      platform: 'android',
      osVersion: String(apiLevel),
      discovery: true,
      pairing: true,
      server: true,
      adapterState: true,
      requestEnable: true,
      bondLossEvents: false,
      accessoryPicker: false,
      declaredProtocols: [],
    });
  });

  it.each([36, 37])(
    'reports bond loss events on Android API %i',
    (apiLevel) => {
      installFakeNativeModule({ os: 'android', apiLevel });
      expect(getCapabilities().bondLossEvents).toBe(true);
    }
  );

  it('reports iOS capabilities with declared protocols in order', () => {
    const fake = installFakeNativeModule({ os: 'ios', version: '27.0' });
    fake.declaredProtocols = ['com.acme.serial', 'com.acme.update'];

    expect(getCapabilities()).toEqual({
      platform: 'ios',
      osVersion: '27.0',
      discovery: false,
      pairing: false,
      server: false,
      adapterState: false,
      requestEnable: false,
      bondLossEvents: false,
      accessoryPicker: true,
      declaredProtocols: ['com.acme.serial', 'com.acme.update'],
    });
  });

  it('reports an empty protocol list when Info.plist has none', () => {
    installFakeNativeModule({ os: 'ios' });
    expect(getCapabilities().declaredProtocols).toEqual([]);
  });

  it('returns a frozen object', () => {
    installFakeNativeModule();
    expect(Object.isFrozen(getCapabilities())).toBe(true);
  });
});

describe('missing native module', () => {
  it.each(['android', 'ios'] as const)(
    'rejects the first async call with MODULE_NOT_LINKED on %s',
    async (os) => {
      emulateMissingNativeModule(os);
      await expect(openSettings()).rejects.toMatchObject({
        code: ErrorCode.MODULE_NOT_LINKED,
        message: expect.stringMatching(/Rebuild the app/),
      });
    }
  );

  it('rejects Android APIs with MODULE_NOT_LINKED', async () => {
    emulateMissingNativeModule('android');
    await expect(getBondedDevices()).rejects.toMatchObject({
      code: ErrorCode.MODULE_NOT_LINKED,
    });
  });

  it('throws MODULE_NOT_LINKED from synchronous APIs', () => {
    emulateMissingNativeModule('android');
    expect(() => getCapabilities()).toThrow(
      expect.objectContaining({ code: ErrorCode.MODULE_NOT_LINKED })
    );
    expect(() => setLogLevel('debug')).toThrow(
      expect.objectContaining({ code: ErrorCode.MODULE_NOT_LINKED })
    );
    expect(() => onAdapterStateChange(() => {})).toThrow(
      expect.objectContaining({ code: ErrorCode.MODULE_NOT_LINKED })
    );
  });
});

describe('unsupported host platforms', () => {
  beforeEach(() => emulateUnsupportedHost());

  it('reports every capability as false', () => {
    expect(getCapabilities()).toMatchObject({
      platform: 'other',
      discovery: false,
      pairing: false,
      server: false,
      adapterState: false,
      requestEnable: false,
      bondLossEvents: false,
      accessoryPicker: false,
      declaredProtocols: [],
    });
  });

  it('rejects async APIs with UNSUPPORTED_ON_PLATFORM', async () => {
    await expect(openSettings()).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
    await expect(startDiscovery()).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
    });
  });

  it('accepts setLogLevel without a native module', () => {
    expect(() => setLogLevel('error')).not.toThrow();
    setLogLevel('warn');
  });
});
