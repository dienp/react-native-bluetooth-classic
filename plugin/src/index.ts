import {
  AndroidConfig,
  createRunOncePlugin,
  WarningAggregator,
  withAndroidManifest,
  withInfoPlist,
  type ConfigPlugin,
  type InfoPlist,
} from '@expo/config-plugins';

type AndroidManifest = AndroidConfig.Manifest.AndroidManifest;

const PACKAGE = '@dynlabs/react-native-bluetooth-classic';
const PROTOCOLS_KEY = 'UISupportedExternalAccessoryProtocols';
const BACKGROUND_MODE = 'external-accessory';

export interface BluetoothClassicPluginOptions {
  /**
   * Android: flag `BLUETOOTH_SCAN` with `neverForLocation` (default `true`).
   * `false` lets the app derive location from scans: the flag is removed and
   * `ACCESS_FINE_LOCATION` is declared for every API level.
   */
  neverForLocation?: boolean;
  /** iOS: the accessory protocols for `UISupportedExternalAccessoryProtocols`, in order. */
  protocols?: string[];
  /** iOS: add the `external-accessory` background mode (default `false`). */
  iosBackgroundMode?: boolean;
}

interface ResolvedOptions {
  neverForLocation: boolean;
  protocols: string[];
  iosBackgroundMode: boolean;
}

const EXPECTED: Record<keyof BluetoothClassicPluginOptions, string> = {
  neverForLocation: 'a boolean',
  protocols: 'an array of strings',
  iosBackgroundMode: 'a boolean',
};

function optionError(name: string, expected: string): Error {
  return new Error(`${PACKAGE}: the "${name}" option must be ${expected}.`);
}

/** Checks the options from the app config; throws an error naming the bad option. */
export function resolveOptions(options: unknown): ResolvedOptions {
  if (options === undefined || options === null) {
    return { neverForLocation: true, protocols: [], iosBackgroundMode: false };
  }
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new Error(
      `${PACKAGE}: plugin options must be an object with ${Object.keys(EXPECTED).join(', ')}.`
    );
  }
  const record = options as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(key in EXPECTED)) {
      throw new Error(
        `${PACKAGE}: unknown option "${key}". Valid options: ${Object.keys(EXPECTED).join(', ')}.`
      );
    }
  }
  const { neverForLocation, protocols, iosBackgroundMode } = record;
  if (neverForLocation !== undefined && typeof neverForLocation !== 'boolean') {
    throw optionError('neverForLocation', EXPECTED.neverForLocation);
  }
  if (
    protocols !== undefined &&
    (!Array.isArray(protocols) ||
      !protocols.every(
        (entry) => typeof entry === 'string' && entry.length > 0
      ))
  ) {
    throw optionError('protocols', EXPECTED.protocols);
  }
  if (
    iosBackgroundMode !== undefined &&
    typeof iosBackgroundMode !== 'boolean'
  ) {
    throw optionError('iosBackgroundMode', EXPECTED.iosBackgroundMode);
  }
  return {
    neverForLocation: neverForLocation ?? true,
    protocols: (protocols as string[] | undefined) ?? [],
    iosBackgroundMode: iosBackgroundMode ?? false,
  };
}

type Attributes = Record<string, string>;

/** The entries the library needs, as docs/android.md lists them. */
function permissions(neverForLocation: boolean): Array<[string, Attributes]> {
  return [
    ['android.permission.BLUETOOTH', { 'android:maxSdkVersion': '30' }],
    ['android.permission.BLUETOOTH_ADMIN', { 'android:maxSdkVersion': '30' }],
    [
      'android.permission.ACCESS_COARSE_LOCATION',
      { 'android:maxSdkVersion': '30' },
    ],
    [
      'android.permission.ACCESS_FINE_LOCATION',
      // tools:remove drops the limit the library's own manifest would merge in.
      neverForLocation
        ? { 'android:maxSdkVersion': '30' }
        : { 'tools:remove': 'android:maxSdkVersion' },
    ],
    [
      'android.permission.BLUETOOTH_SCAN',
      neverForLocation
        ? { 'android:usesPermissionFlags': 'neverForLocation' }
        : { 'tools:remove': 'android:usesPermissionFlags' },
    ],
    ['android.permission.BLUETOOTH_CONNECT', {}],
  ];
}

/** Attributes the plugin owns; others on an existing entry are left alone. */
const MANAGED = [
  'android:maxSdkVersion',
  'android:usesPermissionFlags',
  'tools:remove',
];

/**
 * Adds or updates the library's permissions and its optional Bluetooth
 * feature. Applying it again gives the same manifest. An entry the app
 * already overrides with `tools:node` or `tools:replace` is left as it is.
 */
export function applyAndroidManifest(
  manifest: AndroidManifest,
  options: Pick<ResolvedOptions, 'neverForLocation'>
): AndroidManifest {
  const root = manifest.manifest;
  const entries = (root['uses-permission'] ??= []);
  let usesTools = false;
  for (const [name, attributes] of permissions(options.neverForLocation)) {
    let entry = entries.find(
      (candidate) => candidate.$['android:name'] === name
    );
    if (entry === undefined) {
      entry = { $: { 'android:name': name } };
      entries.push(entry);
    } else if ('tools:node' in entry.$ || 'tools:replace' in entry.$) {
      continue;
    }
    const current = entry.$ as Attributes;
    for (const key of MANAGED) delete current[key];
    Object.assign(current, attributes);
    if ('tools:remove' in attributes) usesTools = true;
  }
  const features = (root['uses-feature'] ??= []);
  if (
    !features.some(
      (feature) => feature.$['android:name'] === 'android.hardware.bluetooth'
    )
  ) {
    features.push({
      $: {
        'android:name': 'android.hardware.bluetooth',
        'android:required': 'false',
      },
    });
  }
  return usesTools
    ? AndroidConfig.Manifest.ensureToolsAvailable(manifest)
    : manifest;
}

/** Configured protocols first, in order, then entries the app already declared; no duplicates. */
export function applyInfoPlist(
  plist: InfoPlist,
  options: Pick<ResolvedOptions, 'protocols' | 'iosBackgroundMode'>
): InfoPlist {
  const existing = Array.isArray(plist[PROTOCOLS_KEY])
    ? (plist[PROTOCOLS_KEY] as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string'
      )
    : [];
  const protocols = [...new Set([...options.protocols, ...existing])];
  if (protocols.length > 0) {
    plist[PROTOCOLS_KEY] = protocols;
  }
  if (options.iosBackgroundMode) {
    const modes = Array.isArray(plist.UIBackgroundModes)
      ? (plist.UIBackgroundModes as string[])
      : [];
    if (!modes.includes(BACKGROUND_MODE)) {
      plist.UIBackgroundModes = [...modes, BACKGROUND_MODE];
    }
  }
  return plist;
}

const withBluetoothClassic: ConfigPlugin<
  BluetoothClassicPluginOptions | void
> = (config, rawOptions) => {
  // Validated when the config is read, so a bad option fails prebuild before any file is written.
  const options = resolveOptions(rawOptions);

  config = withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = applyAndroidManifest(modConfig.modResults, options);
    return modConfig;
  });

  return withInfoPlist(config, (modConfig) => {
    modConfig.modResults = applyInfoPlist(modConfig.modResults, options);
    if (!Array.isArray(modConfig.modResults[PROTOCOLS_KEY])) {
      WarningAggregator.addWarningIOS(
        PACKAGE,
        `No accessory protocols are declared: set the plugin's "protocols" option, or iOS connections will fail with PROTOCOL_NOT_DECLARED.`
      );
    }
    return modConfig;
  });
};

export default createRunOncePlugin(withBluetoothClassic, PACKAGE);
