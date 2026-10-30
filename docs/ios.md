# iOS

What the library needs from an iOS app, and how it behaves on each iOS release it supports (15.1–27).

> Status: every iOS API is implemented natively, on ExternalAccessory. The Android-only APIs reject with `UNSUPPORTED_ON_PLATFORM`.

## MFi accessories only

On iOS the library talks to accessories through Apple's ExternalAccessory framework. That framework only reaches **MFi accessories** (Made for iPhone/iPad), and only over the protocols they declare. iOS gives apps no access to RFCOMM, so an ordinary Bluetooth serial device (SPP) that Android can use cannot be used from iOS.

Because of that, iOS has no discovery, pairing, adapter state or server:

- `getCapabilities()` reports `discovery`, `pairing`, `server`, `adapterState`, `requestEnable` and `bondLossEvents` as `false`, and `accessoryPicker` as `true`.
- `startDiscovery()`, `getBondedDevices()`, `pair()`, `accept()`, `getAdapterState()`, `requestEnable()` and `setAdapterName()` reject with `UNSUPPORTED_ON_PLATFORM`.
- Subscribing to `onAdapterStateChange`, `onDeviceFound`, `onBondStateChange` or `onBondLost` throws `UNSUPPORTED_ON_PLATFORM`.

The user pairs an accessory in Settings, or in the system picker that `showAccessoryPicker()` opens.

## Info.plist

Declare every protocol your app uses, as the accessory maker names them:

```xml
<key>UISupportedExternalAccessoryProtocols</key>
<array>
  <string>com.acme.serial</string>
</array>
```

- The order matters: `connect()` picks the first declared protocol the accessory supports.
- Without the key the app still starts. `getCapabilities().declaredProtocols` is then empty, `getConnectedAccessories()` resolves with nothing, and `connect()` rejects with `PROTOCOL_NOT_DECLARED`.
- App Review asks for the accessory's MFi approval when an app declares accessory protocols. Get it from the accessory maker.

The library does not use CoreBluetooth, so there is no Bluetooth permission prompt and no `NSBluetoothAlwaysUsageDescription` to add. `checkPermissions('connect')` and `requestPermissions('connect')` resolve with `granted: true`; the `'discovery'` and `'server'` scopes reject with `UNSUPPORTED_ON_PLATFORM`.

### Background sessions

To keep sessions open while the app is in the background, add the `external-accessory` background mode:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>external-accessory</string>
</array>
```

Without it, iOS may close sessions when it suspends the app. Each closed session's `onDisconnected` then fires once when the app becomes active again.

## Finding accessories

- **`getConnectedAccessories()`** resolves with the accessories connected to iOS that support at least one declared protocol. Each has `id`, `name`, `manufacturer`, `modelNumber`, `serialNumber`, `firmwareRevision`, `hardwareRevision` and `protocolStrings`.
- **`onAccessoryConnected` and `onAccessoryDisconnected`** report the same accessories as they come and go, for example when one is powered off.
- **`showAccessoryPicker({ nameFilter? })`** opens the system picker for Bluetooth accessories that are not connected yet. `nameFilter` keeps the accessories whose name contains it, ignoring case.
  - It resolves when the user selects an accessory or the accessory is already connected. The accessory then arrives through `onAccessoryConnected`.
  - It rejects with `USER_REJECTED` when the user dismisses the picker, `DEVICE_NOT_FOUND` when no accessory matches, and `UNKNOWN` on any other picker failure.

**An accessory's `id` changes every time it reconnects to iOS.** Don't store it. To recognize an accessory later, use its `serialNumber`, or its `name` and `modelNumber`.

```ts
const subscription = onAccessoryConnected(({ accessory }) =>
  connectTo(accessory)
);
await showAccessoryPicker({ nameFilter: 'Printer' });
```

## Connecting

`connect(accessory.id, options?)` opens an ExternalAccessory session and resolves with a `Connection` once both of its streams are open.

| Option         | Default                                            | Effect                                                                               |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ios.protocol` | The first declared protocol the accessory supports | Must be declared in Info.plist and supported by the accessory.                       |
| `timeoutMs`    | `15000`                                            | If the streams are not both open in time, the session closes with `CONNECT_TIMEOUT`. |
| `signal`       | none                                               | Aborting closes the session and rejects with `CONNECT_CANCELLED`.                    |

The `android` options block is ignored on iOS, so one options object works on both platforms.

| Code                      | When                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `PROTOCOL_NOT_DECLARED`   | `ios.protocol` is not in `UISupportedExternalAccessoryProtocols`, or the key is missing.  |
| `PROTOCOL_NOT_SUPPORTED`  | The accessory does not list `ios.protocol`, or none of the declared protocols.            |
| `ACCESSORY_NOT_CONNECTED` | No accessory with that `id` is connected, often because it reconnected under a new `id`.  |
| `SESSION_OPEN_FAILED`     | iOS returned no session, for example because another app holds one for the same protocol. |
| `CONNECT_FAILED`          | A stream failed or ended while the session was opening.                                   |
| `ALREADY_CONNECTED`       | A connection to this accessory with this protocol is open; `error.connectionId` names it. |
| `ALREADY_CONNECTING`      | A connect to this accessory with this protocol is still pending.                          |

One accessory can have one connection per protocol: two protocols on the same accessory can be open at once.

## Data

- **Streams run on their own thread.** Each session's streams are scheduled on one dedicated I/O thread, never on the main thread, so the UI never waits for an accessory.
- **Reads** reach JS in batches, at most 16 ms or 16 KiB after the stream reported them, and never out of order.
- **Writes** go out in call order. Each is written as fast as the output stream accepts it, and `write()` resolves once its last byte is accepted. A stream error rejects with `WRITE_FAILED` and ends the connection with that code. With `timeoutMs`, a write the accessory does not accept in time rejects with `WRITE_TIMEOUT` and ends the connection; writes queued behind it reject with `NOT_CONNECTED`.
- **`disconnect()`** lets writes queued before it finish, for up to `timeoutMs` (default 5000), then closes the session.

### How connections end

Every connection reports `onDisconnected` exactly once:

| What happened                                                      | `reason`   | `error.code`                    |
| ------------------------------------------------------------------ | ---------- | ------------------------------- |
| `disconnect()`                                                     | `'local'`  |                                 |
| The stream reached its end, or the accessory disconnected from iOS | `'remote'` |                                 |
| A stream error while the accessory is still connected              | `'error'`  | `CONNECTION_LOST`               |
| A write failed or timed out                                        | `'error'`  | `WRITE_FAILED`, `WRITE_TIMEOUT` |
| More unread data than `maxBufferBytes`                             | `'error'`  | `BUFFER_OVERFLOW`               |

When the JS runtime reloads, the library closes every session and stops following accessories without delivering anything to the new runtime. Connect again from the new runtime.

## Settings

`openSettings()` opens the app's own page in the Settings app. iOS does not let apps open the Bluetooth settings.

## Logging

Native logs go to unified logging with the subsystem `dynlabs.react-native-bluetooth-classic`. Watch them in Console.app, or from a Mac with the device or simulator attached:

```sh
log stream --predicate 'subsystem == "dynlabs.react-native-bluetooth-classic"'
```

The default level is `'warn'`. Connection details and byte counts appear only after `setLogLevel('debug')`.
