/// <reference types="node" />
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AndroidConfig, type InfoPlist } from '@expo/config-plugins';
import withBluetoothClassic, {
  applyAndroidManifest,
  applyInfoPlist,
  resolveOptions,
} from '../index';

type Manifest = AndroidConfig.Manifest.AndroidManifest;
type ExpoConfig = Parameters<typeof withBluetoothClassic>[0];

const FIXTURE = path.join(__dirname, 'fixtures/AndroidManifest.xml');

function readFixture(): Promise<Manifest> {
  return AndroidConfig.Manifest.readAndroidManifestAsync(FIXTURE);
}

/** The manifest as the XML prebuild writes. */
async function toXml(manifest: Manifest): Promise<string> {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), 'rnbc-plugin-')),
    'AndroidManifest.xml'
  );
  await AndroidConfig.Manifest.writeAndroidManifestAsync(file, manifest);
  return readFileSync(file, 'utf8');
}

function permission(
  manifest: Manifest,
  name: string
): Record<string, string> | undefined {
  return manifest.manifest['uses-permission']?.find(
    (entry) => entry.$['android:name'] === `android.permission.${name}`
  )?.$ as Record<string, string> | undefined;
}

/** Runs the plugin's registered mod for `platform`/`mod` on `modResults`, as prebuild does. */
async function runMod<T>(
  config: ExpoConfig,
  platform: 'android' | 'ios',
  mod: string,
  modResults: T
): Promise<T> {
  const mods = (
    config as {
      mods?: Record<
        string,
        Record<string, (config: unknown) => Promise<{ modResults: T }>>
      >;
    }
  ).mods;
  const run = mods?.[platform]?.[mod];
  if (run === undefined) throw new Error(`No ${platform}.${mod} mod`);
  const result = await run({
    ...config,
    modResults,
    modRequest: {
      platform,
      modName: mod,
      projectRoot: '/app',
      platformProjectRoot: `/app/${platform}`,
      introspect: false,
    },
  });
  return result.modResults;
}

const appConfig = (): ExpoConfig => ({ name: 'fixture', slug: 'fixture' });

describe('Android manifest', () => {
  test('by default, declares the permissions limited to API 30 and BLUETOOTH_SCAN with neverForLocation', async () => {
    const manifest = applyAndroidManifest(await readFixture(), {
      neverForLocation: true,
    });

    for (const name of [
      'BLUETOOTH',
      'BLUETOOTH_ADMIN',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
    ]) {
      expect(permission(manifest, name)?.['android:maxSdkVersion']).toBe('30');
    }
    expect(
      permission(manifest, 'BLUETOOTH_SCAN')?.['android:usesPermissionFlags']
    ).toBe('neverForLocation');
    expect(permission(manifest, 'BLUETOOTH_CONNECT')).toEqual({
      'android:name': 'android.permission.BLUETOOTH_CONNECT',
    });
    expect(permission(manifest, 'INTERNET')).toBeDefined();
    expect(manifest.manifest['uses-feature']).toEqual([
      {
        $: {
          'android:name': 'android.hardware.bluetooth',
          'android:required': 'false',
        },
      },
    ]);
    // The app already declared BLUETOOTH_CONNECT: still one entry.
    const names = manifest.manifest['uses-permission']!.map(
      (entry) => entry.$['android:name']
    );
    expect(new Set(names).size).toBe(names.length);
  });

  test('with neverForLocation false, the flag and the fine location limit are removed from the merged manifest', async () => {
    const manifest = applyAndroidManifest(await readFixture(), {
      neverForLocation: false,
    });

    expect(permission(manifest, 'BLUETOOTH_SCAN')).toEqual({
      'android:name': 'android.permission.BLUETOOTH_SCAN',
      'tools:remove': 'android:usesPermissionFlags',
    });
    expect(permission(manifest, 'ACCESS_FINE_LOCATION')).toEqual({
      'android:name': 'android.permission.ACCESS_FINE_LOCATION',
      'tools:remove': 'android:maxSdkVersion',
    });
    expect(
      permission(manifest, 'ACCESS_COARSE_LOCATION')?.['android:maxSdkVersion']
    ).toBe('30');
    expect(manifest.manifest.$['xmlns:tools']).toBe(
      'http://schemas.android.com/tools'
    );
  });

  test.each([true, false])(
    'applying it twice (neverForLocation %s) writes the same XML',
    async (neverForLocation) => {
      const once = applyAndroidManifest(await readFixture(), {
        neverForLocation,
      });
      const onceXml = await toXml(once);

      const twice = applyAndroidManifest(once, { neverForLocation });

      expect(await toXml(twice)).toBe(onceXml);
    }
  );

  test('an entry the app overrides with tools:node is left alone', async () => {
    const manifest = await readFixture();
    manifest.manifest['uses-permission']!.push({
      $: {
        'android:name': 'android.permission.ACCESS_FINE_LOCATION',
        'tools:node': 'remove',
      },
    });

    applyAndroidManifest(manifest, { neverForLocation: true });

    expect(permission(manifest, 'ACCESS_FINE_LOCATION')).toEqual({
      'android:name': 'android.permission.ACCESS_FINE_LOCATION',
      'tools:node': 'remove',
    });
  });
});

describe('Info.plist', () => {
  test('lists the configured protocols in order, then the existing ones, without duplicates', () => {
    const plist: InfoPlist = {
      UISupportedExternalAccessoryProtocols: ['com.legacy', 'com.acme.serial'],
    };

    applyInfoPlist(plist, {
      protocols: ['com.acme.serial', 'com.acme.update'],
      iosBackgroundMode: false,
    });

    expect(plist.UISupportedExternalAccessoryProtocols).toEqual([
      'com.acme.serial',
      'com.acme.update',
      'com.legacy',
    ]);
    expect(plist.UIBackgroundModes).toBeUndefined();
  });

  test('the background mode is added next to the existing ones', () => {
    const plist: InfoPlist = { UIBackgroundModes: ['audio'] };

    applyInfoPlist(plist, { protocols: [], iosBackgroundMode: true });

    expect(plist.UIBackgroundModes).toEqual(['audio', 'external-accessory']);
    expect(plist.UISupportedExternalAccessoryProtocols).toBeUndefined();
  });

  test('applying it twice gives the same plist', () => {
    const options = {
      protocols: ['com.acme.serial', 'com.acme.update'],
      iosBackgroundMode: true,
    };
    const once = applyInfoPlist({ UIBackgroundModes: ['audio'] }, options);
    const snapshot = JSON.parse(JSON.stringify(once));

    expect(applyInfoPlist(once, options)).toEqual(snapshot);
  });
});

describe('options', () => {
  test('defaults', () => {
    expect(resolveOptions(undefined)).toEqual({
      neverForLocation: true,
      protocols: [],
      iosBackgroundMode: false,
    });
    expect(resolveOptions({})).toEqual({
      neverForLocation: true,
      protocols: [],
      iosBackgroundMode: false,
    });
  });

  test.each([
    [
      { protocols: 'com.acme.serial' },
      /"protocols" option must be an array of strings/,
    ],
    [
      { protocols: ['com.acme.serial', 42] },
      /"protocols" option must be an array of strings/,
    ],
    [{ neverForLocation: 'no' }, /"neverForLocation" option must be a boolean/],
    [{ iosBackgroundMode: 1 }, /"iosBackgroundMode" option must be a boolean/],
    [{ protocol: ['com.acme.serial'] }, /unknown option "protocol"/],
    [['com.acme.serial'], /plugin options must be an object/],
  ])('%j fails with an error naming the option', (options, message) => {
    expect(() => withBluetoothClassic(appConfig(), options as never)).toThrow(
      message
    );
  });
});

describe('the plugin', () => {
  afterEach(() => jest.restoreAllMocks());

  test('registers both mods, which apply the options', async () => {
    const config = withBluetoothClassic(appConfig(), {
      neverForLocation: false,
      protocols: ['com.acme.serial'],
      iosBackgroundMode: true,
    });

    const manifest = await runMod(
      config,
      'android',
      'manifest',
      await readFixture()
    );
    const plist = await runMod<InfoPlist>(config, 'ios', 'infoPlist', {});

    expect(permission(manifest, 'BLUETOOTH_SCAN')?.['tools:remove']).toBe(
      'android:usesPermissionFlags'
    );
    expect(plist).toEqual({
      UISupportedExternalAccessoryProtocols: ['com.acme.serial'],
      UIBackgroundModes: ['external-accessory'],
    });
  });

  test('warns, naming the protocols option, when no protocol is declared', async () => {
    // WarningAggregator prints iOS warnings with console.warn.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await runMod<InfoPlist>(
      withBluetoothClassic(appConfig()),
      'ios',
      'infoPlist',
      {}
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('"protocols" option');
    expect(String(warn.mock.calls[0]![0])).toContain('PROTOCOL_NOT_DECLARED');

    warn.mockClear();
    await runMod<InfoPlist>(
      withBluetoothClassic(appConfig(), { protocols: ['com.acme.serial'] }),
      'ios',
      'infoPlist',
      {}
    );
    expect(warn).not.toHaveBeenCalled();
  });

  test('applies once even if listed twice', async () => {
    const config = withBluetoothClassic(
      withBluetoothClassic(appConfig(), { protocols: ['a'] }),
      { protocols: ['b'] }
    );

    expect(await runMod<InfoPlist>(config, 'ios', 'infoPlist', {})).toEqual({
      UISupportedExternalAccessoryProtocols: ['a'],
    });
  });
});
