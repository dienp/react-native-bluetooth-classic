# Android

What the library needs from an Android app, and how it behaves on each Android release it supports (API 24–37).

> Status: adapter state, permissions, `requestEnable()`, `openSettings()` and `setAdapterName()` are implemented natively. Discovery, pairing and connections still reject with `UNSUPPORTED_ON_PLATFORM`, and `getCapabilities()` reports them as `false` until they land.

## Permissions by API level

The library groups runtime permissions into three scopes. Each scope needs different permissions depending on the Android release the app runs on:

| Scope         | API 24–28                                                                    | API 29–30                                        | API 31+                                  |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| `'discovery'` | `ACCESS_COARSE_LOCATION` or `ACCESS_FINE_LOCATION`, and Location Services on | `ACCESS_FINE_LOCATION`, and Location Services on | `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` |
| `'connect'`   | none                                                                         | none                                             | `BLUETOOTH_CONNECT`                      |
| `'server'`    | none                                                                         | none                                             | `BLUETOOTH_CONNECT`                      |

On API 24–30 the `'connect'` and `'server'` scopes rely on `BLUETOOTH` and `BLUETOOTH_ADMIN`, which are install-time permissions that the library's manifest declares for you.

- **`checkPermissions(scope)`** reports `{ granted, missing }` and never shows a prompt. For `'discovery'` on API 24–30 it also reports `locationServicesEnabled`.
- **`requestPermissions(scope)`** prompts only for what is missing and resolves with `{ granted, missing, canAskAgain }`. When `canAskAgain` is `false`, the OS will not show the prompt again; send the user to the app's settings instead.
- **Operations never prompt.** If a permission is missing, they reject with `PERMISSION_DENIED`, and `error.missingPermissions` lists what to request.

`requestPermissions()` needs a React Native activity (`ReactActivity`) in the foreground. Without one it rejects with `ACTIVITY_UNAVAILABLE`. Concurrent requests are shown one after another, because the activity can only track one permission request at a time.

```ts
const status = await requestPermissions('discovery');
if (!status.granted) {
  showExplanation(status.missing, { openAppSettings: !status.canAskAgain });
}
```

## Manifest

The library's manifest is merged into your app automatically. It declares:

<!-- manifest-check:start -->

```xml
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-feature android:name="android.hardware.bluetooth" android:required="false" />
```

<!-- manifest-check:end -->

CI builds the example app and checks that its merged manifest contains exactly these entries ([`scripts/ci/check-android-manifest.mjs`](../scripts/ci/check-android-manifest.mjs)).

What this means for your app:

- **On API 31+ no location permission is requested.** `BLUETOOTH_SCAN` is flagged `neverForLocation`, so discovery works without location access.
- **Location permissions are limited to API 24–30**, where discovery cannot work without them.
- **Devices without Bluetooth can still install the app** from Google Play. On those devices `getAdapterState()` resolves with `'unavailable'`, and operations reject with `BLUETOOTH_UNAVAILABLE`.

### Overriding the defaults

Add these to your app's `android/app/src/main/AndroidManifest.xml`. Each needs the `tools` namespace on the `<manifest>` element: `xmlns:tools="http://schemas.android.com/tools"`.

**Derive location from scans** on API 31+. Remove the `neverForLocation` flag, and keep the fine location permission on every release:

```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" tools:remove="android:usesPermissionFlags" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" tools:remove="android:maxSdkVersion" />
```

Your app then has to request `ACCESS_FINE_LOCATION` itself on API 31+; the library's `'discovery'` scope does not include it there.

**No location permission at all**, for apps that never run discovery:

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" tools:node="remove" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" tools:node="remove" />
```

On API 24–30, discovery then always rejects with `PERMISSION_DENIED`. Bonded devices, pairing by address and connections are unaffected.

**Require Bluetooth hardware** on Google Play:

```xml
<uses-feature android:name="android.hardware.bluetooth" android:required="true" tools:replace="android:required" />
```

## The Location Services trap (API 24–30)

On Android 7 to 11, discovery needs the system **Location Services** switch to be on, in addition to the location permission. When it is off, the OS runs discovery without reporting an error and finds nothing. The library checks the switch instead:

- `startDiscovery()` rejects with `LOCATION_SERVICES_DISABLED` while Location Services is off.
- `checkPermissions('discovery')` reports `locationServicesEnabled`, so you can explain the problem before starting.

On API 31 and later the switch has no effect on discovery.

`openSettings()` opens the Bluetooth settings. To open the location settings, use React Native's `Linking`:

```ts
import { Linking } from 'react-native';

const status = await checkPermissions('discovery');
if (status.locationServicesEnabled === false) {
  await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
}
```

## Turning Bluetooth on

`requestEnable()` shows the system "Turn on Bluetooth?" prompt:

- If Bluetooth is already on, it resolves immediately without a prompt.
- If the user accepts, it resolves once the adapter reports `'on'`. If the adapter has not turned on within 15 seconds, it rejects with `BLUETOOTH_DISABLED`.
- If the user declines, it rejects with `USER_REJECTED`.
- Concurrent calls share one prompt and settle with the same result.
- On API 31+ it needs `BLUETOOTH_CONNECT`, so call `requestPermissions('connect')` first. Otherwise it rejects with `PERMISSION_DENIED`.
- Without an activity in the foreground it rejects with `ACTIVITY_UNAVAILABLE`.

It also resolves if the user turns Bluetooth on another way, for example from quick settings, while the prompt is pending.

```ts
const permissions = await requestPermissions('connect');
if (permissions.granted && (await getAdapterState()) !== 'on') {
  await requestEnable();
}
```

`openSettings()` opens the system Bluetooth settings. It needs an activity in the foreground, because Android blocks background apps from opening screens without reporting an error.

`setAdapterName(name)` needs the `'connect'` scope and Bluetooth on. The name must not be empty and must fit in 248 UTF-8 bytes.

## Adapter state events

`onAdapterStateChange` listens for system broadcasts on the application context, not the activity. It therefore keeps delivering transitions while the app is in the background or a system dialog covers it, as long as the JavaScript runtime is alive. When the runtime reloads, the library unregisters its receivers and drops pending requests, so nothing is delivered to the new runtime.

## Logging

Native logs use the tag `RNBluetoothClassic`:

```sh
adb logcat -s RNBluetoothClassic
```

The default level is `'warn'`. Device names, addresses and transferred data appear only after `setLogLevel('debug')`.
