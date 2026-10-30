# Expo

The package includes an Expo config plugin that writes the Android permissions and the iOS Info.plist keys the library needs, so Expo apps never edit native files by hand.

## Development builds only

The library is native code, so it works in [development builds](https://docs.expo.dev/develop/development-builds/introduction/) and EAS Build, and **not in Expo Go**. In Expo Go every call rejects with `MODULE_NOT_LINKED`.

## Setup

```sh
npx expo install @dynlabs/react-native-bluetooth-classic
```

Add the plugin to the app config, with the options your app needs:

```json
{
  "expo": {
    "plugins": [
      [
        "@dynlabs/react-native-bluetooth-classic",
        {
          "protocols": ["com.acme.serial"],
          "iosBackgroundMode": true
        }
      ]
    ]
  }
}
```

Then build as usual: `npx expo prebuild`, `npx expo run:android` / `run:ios`, or EAS Build.

## Options

| Option              | Type       | Default | Effect                                                                                                                                                                               |
| ------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `neverForLocation`  | `boolean`  | `true`  | Android: flags `BLUETOOTH_SCAN` with `neverForLocation`. `false` removes the flag and declares `ACCESS_FINE_LOCATION` for every API level, for apps that derive location from scans. |
| `protocols`         | `string[]` | `[]`    | iOS: the MFi accessory protocols, written to `UISupportedExternalAccessoryProtocols` in this order.                                                                                  |
| `iosBackgroundMode` | `boolean`  | `false` | iOS: adds `external-accessory` to `UIBackgroundModes`, so sessions stay open in the background.                                                                                      |

An invalid option fails prebuild with an error that names it, for example `the "protocols" option must be an array of strings`. Unknown option names fail too.

## What the plugin writes

**Android manifest.** The same entries as the library's own manifest ([android.md](./android.md#manifest)):

- `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`, limited to API 30;
- `BLUETOOTH_SCAN` with `neverForLocation`, and `BLUETOOTH_CONNECT`;
- the `android.hardware.bluetooth` feature, not required.

With `neverForLocation: false`, `BLUETOOTH_SCAN` and `ACCESS_FINE_LOCATION` get `tools:remove` entries instead, so the merged manifest has neither the flag nor the API 30 limit. Your app then requests `ACCESS_FINE_LOCATION` itself on API 31+.

An entry your app config already overrides with `tools:node` or `tools:replace` is left alone.

**iOS Info.plist.**

- `UISupportedExternalAccessoryProtocols`: the `protocols` option, in order, followed by any protocols already declared (for example through `ios.infoPlist`), without duplicates.
- `UIBackgroundModes`: with `iosBackgroundMode`, `external-accessory` is added next to the modes already there.

Without any protocol, prebuild prints a warning naming the `protocols` option: on iOS, `connect()` would reject with `PROTOCOL_NOT_DECLARED`.

## Prebuild again

Running prebuild again with the same configuration produces the same files, with no duplicate entries. After **changing** an option, run `npx expo prebuild --clean`, so entries written for the old options don't stay behind.

CI runs `expo prebuild` twice on a fixture app ([`scripts/ci/expo-fixture`](../scripts/ci/expo-fixture)) and checks the generated manifest and Info.plist each time.
