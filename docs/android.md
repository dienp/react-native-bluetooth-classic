# Android

What the library needs from an Android app, and how it behaves on each Android release it supports (API 24–37).

> Status: every Android API is implemented natively: adapter state, permissions, `requestEnable()`, `openSettings()`, `setAdapterName()`, discovery, pairing, bond events, connections, the server (`accept()`) and data transfer.

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

## Discovery

`startDiscovery({ timeoutMs? })` runs one discovery session and resolves with every device it found. It needs the `'discovery'` scope, Bluetooth on and, on API 24–30, Location Services on.

- **Results:** `onDeviceFound` fires at most once per address in a session. The resolved list has one entry per device, with the latest name and RSSI the OS reported. Only discovery results carry `rssi`.
- **How a session ends:**
  - The OS finishes it, after about 12 seconds.
  - `timeoutMs` elapses. Without it, the session also stops after 120 seconds if the OS never reports that it finished.
  - `cancelDiscovery()` stops it, and the pending `startDiscovery()` resolves with what was found so far.
- **One session at a time:** a second `startDiscovery()` rejects with `DISCOVERY_ALREADY_RUNNING`, and the first session carries on. `cancelDiscovery()` with nothing running resolves without effect.
- **Always settles:** the session runs on the application context, so pausing the app, a system dialog or going to the background doesn't stop it. Bluetooth turning off rejects it with `BLUETOOTH_DISABLED`. If the OS refuses to start, or never reports that discovery started (within 10 seconds), it rejects with `DISCOVERY_FAILED`.

```ts
const subscription = onDeviceFound(({ device }) => showDevice(device));
try {
  const devices = await startDiscovery({ timeoutMs: 10_000 });
} finally {
  subscription.remove();
}
```

## Pairing

`pair(address, { timeoutMs? })` starts bonding and resolves with the device once it reaches `'bonded'`. It needs the `'connect'` scope and Bluetooth on.

- **System UI only:** the OS pairing dialog collects any PIN or passkey. The library never supplies or confirms one; it only watches the bond state of that address.
- **Outcomes:**
  - Already bonded: it resolves immediately.
  - The OS refuses to start bonding: `PAIRING_FAILED`, immediately.
  - Bonding ends in `'none'`, for example because the user declined: `PAIRING_FAILED`.
  - No outcome within `timeoutMs` (default 60 seconds): `PAIRING_TIMEOUT`, after asking the OS to cancel the attempt.
  - Bluetooth turns off: `BLUETOOTH_DISABLED`.
- **One pairing per device:** a second `pair()` for the same address rejects with `PAIRING_IN_PROGRESS`. Different devices can pair at the same time.

### Unpairing

Android has no public API for removing a bond on any release, so `unpair(address)` calls the OS's hidden bond-removal method. Where the OS blocks it, `unpair()` rejects with `UNSUPPORTED_ON_PLATFORM`; send the user to the Bluetooth settings with `openSettings()` instead. When it works, it resolves once the device's bond state is `'none'`, and immediately if the device wasn't bonded.

### Bond events

`onBondStateChange` reports every bond transition of any device, `{ device, state, previousState }`. It works while the system pairing dialog covers the app, because the receiver lives on the application context.

`onBondLost` fires on API 36 and later when the OS reports that a bonded device lost its keys, for example after a factory reset; `getCapabilities().bondLossEvents` is `true` there. On API 24–35 the subscription is accepted but never fires.

## Connections

`connect(address, options?)` opens an RFCOMM link and resolves with a `Connection` once it is `connected`. It needs the `'connect'` scope and Bluetooth on.

```ts
const connection = await connect('00:11:22:AA:BB:CC', {
  timeoutMs: 10_000,
  android: { transport: 'secure' },
});
```

| Option                    | Default                                      | Effect                                                                                       |
| ------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `timeoutMs`               | `15000`                                      | Closes the socket and rejects with `CONNECT_TIMEOUT`. A link the OS reports later is closed. |
| `signal`                  | none                                         | Aborting closes the socket and rejects with `CONNECT_CANCELLED`.                             |
| `android.transport`       | `'secure'`                                   | `'insecure'` opens an unauthenticated, unencrypted link, for devices that cannot pair.       |
| `android.uuid`            | `00001101-0000-1000-8000-00805F9B34FB` (SPP) | The service the OS looks up on the device.                                                   |
| `android.fallbackChannel` | none                                         | See [Fallback channel](#fallback-channel).                                                   |

- **Discovery stops first.** A running discovery session slows down or breaks RFCOMM connects, so `connect()` ends it, and the pending `startDiscovery()` resolves with what it found, before the attempt starts.
- **One connection per device.** A second `connect()` to the same address rejects with `ALREADY_CONNECTED`, and `error.connectionId` names the open connection. While an attempt is still pending, it rejects with `ALREADY_CONNECTING`.
- **Every connection ends exactly once.** `onDisconnected` reports `'local'` after `disconnect()`, `'remote'` when the peer closes the link or it drops, and `'error'` when the library ends it. On API 37 a peer close reaches the app as end-of-stream rather than a read error; both are `'remote'`.

### Fallback channel

Some devices advertise their serial port wrongly or not at all, so the OS's lookup of the UUID fails although the port is listening. With `android: { fallbackChannel: n }` (1 to 30), a failed UUID attempt is followed by one attempt on RFCOMM channel `n`:

- The first socket is closed before the retry, so at most one stays open.
- If both attempts fail, `error.nativeMessage` holds both reasons: `uuid <uuid>: <reason>; channel <n>: <reason>`.
- Without the option, the library never tries a channel.

Android has no public API for channel sockets, so the retry uses the OS's hidden method. Where an Android build blocks it, the second attempt fails with `This Android release does not allow RFCOMM channel sockets`. Use the option only for a device you know listens on that channel.

### Troubleshooting `CONNECT_FAILED`

`error.nativeMessage` carries the OS's reason. With `setLogLevel('debug')`, the attempts also appear in `adb logcat -s RNBluetoothClassic`.

| `nativeMessage` contains                                                | Usual cause                                                                                                     | What to try                                                                                                                                                                      |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read failed, socket might closed or timeout`                           | The device is off, out of range, connected to another host, has no service with that UUID, or refused the link. | Check that the device is on and free, and the UUID it advertises. Pair first with `pair()`, or try `transport: 'insecure'` for a device that cannot pair. Try `fallbackChannel`. |
| `uuid …: …; channel …: …`                                               | Both the UUID attempt and the fallback channel failed.                                                          | Read both reasons; the channel may be wrong.                                                                                                                                     |
| `Could not create a channel` or `does not allow RFCOMM channel sockets` | The OS refused the fallback channel socket.                                                                     | Drop `fallbackChannel` and fix the UUID instead.                                                                                                                                 |

### Writing and reading

- **Writes** on one connection go out in call order on a dedicated thread, in 8 KiB chunks. `write()` resolves once the OS accepted every byte. An OS error rejects with `WRITE_FAILED` and ends the connection with that code. With `timeoutMs`, a write the device does not accept in time rejects with `WRITE_TIMEOUT` and ends the connection, because the stream position is then unknown; writes queued behind it reject with `NOT_CONNECTED`.
- **Reads** run on another thread. Bytes reach JS in batches, at most 16 ms or 16 KiB after the OS made them readable, and never out of order.
- **Bluetooth turning off** ends every connection with `'error'` and `BLUETOOTH_DISABLED`, and rejects pending `connect()` and `accept()` calls with the same code.

### Write then disconnect

`disconnect({ timeoutMs })` lets writes queued before it finish, then closes the link. So this is safe without awaiting the write:

```ts
connection.write(receipt);
await connection.disconnect();
```

Writes still pending after `timeoutMs` (default 5000) reject with `NOT_CONNECTED`. Calling `disconnect()` again, or on a connection that already ended, resolves without effect.

"Accepted by the OS" is not "received by the device": the OS may still be sending when the socket closes. If the device must have everything before you hang up, wait for its acknowledgement first.

### Accepting connections

`accept({ uuid?, serviceName?, transport?, timeoutMs?, signal? })` advertises a service and resolves with the first device that connects. It needs the `'server'` scope and Bluetooth on.

- The listening socket closes as soon as `accept()` settles, whatever the outcome.
- Without `timeoutMs` it waits until a device connects or it is cancelled. With it, it rejects with `ACCEPT_TIMEOUT`.
- Only one `accept()` runs at a time; a second rejects with `ACCEPT_ALREADY_RUNNING`. `cancelAccept()`, or aborting `signal`, rejects it with `ACCEPT_CANCELLED`.
- A failure to listen or to accept rejects with `ACCEPT_FAILED`, with the OS reason in `nativeMessage`.

### Background and reloads

Connections run on the library's own threads, not on the activity, so they stay open, and keep receiving data, while the app is in the background. They last as long as the process does; Android may kill a background process, so an app that must hold a link for a long time needs its own foreground service.

When the JS runtime reloads, the library closes every socket and stops its threads without delivering anything to the new runtime. Connect again from the new runtime.

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

`onAdapterStateChange` listens for system broadcasts on the application context, not the activity. It therefore keeps delivering transitions while the app is in the background or a system dialog covers it, as long as the JavaScript runtime is alive. When the runtime reloads, the library unregisters its receivers, stops discovery, closes connections and drops pending requests, so nothing is delivered to the new runtime.

## Logging

Native logs use the tag `RNBluetoothClassic`:

```sh
adb logcat -s RNBluetoothClassic
```

The default level is `'warn'`. Device names, addresses and transferred data appear only after `setLogLevel('debug')`.
