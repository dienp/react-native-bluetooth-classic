# Migrating from v1 to v2

v2 is a rewrite, published as a new package: **`@dynlabs/react-native-bluetooth-classic`**. Every app needs code changes. If you cannot meet the new requirements, stay on v1 (`react-native-bluetooth-classic@1`, maintained on the [`1.x` branch](https://github.com/dienp/react-native-bluetooth-classic/tree/1.x)).

## Switching packages

```sh
yarn remove react-native-bluetooth-classic
yarn add @dynlabs/react-native-bluetooth-classic
cd ios && pod install
```

Then replace `from 'react-native-bluetooth-classic'` with `from '@dynlabs/react-native-bluetooth-classic'` in your imports and rebuild the app. Do not keep both packages installed: they register the same native module name.

## Requirements

| | v1 | v2 |
|---|---|---|
| React Native | 0.73+ (legacy or new architecture) | **0.82+**, new architecture only |
| Android | API 16+ | **API 24+** (Android 7.0) |
| iOS | 9.0+ | **15.1+** |
| Windows | Stub | Removed |
| Expo | Third-party plugin | Bundled config plugin, development builds only |

## Principles that changed

- **Errors are typed.** Every failure is a `BluetoothClassicError` with a `code` from `ErrorCode`, on both platforms. v1's `EUNSPECIFIED`, lowercase iOS codes and the type-only `BluetoothError` enum are gone. See [errors.md](./errors.md).
- **Nothing fails silently.** An API that the platform cannot support rejects with `UNSUPPORTED_ON_PLATFORM` instead of resolving, doing nothing or throwing synchronously. Use `getCapabilities()` to branch.
- **Devices are plain data.** v1's stateful `BluetoothDevice` objects with `connect()`, `read()` and `write()` methods are gone. Device objects are frozen snapshots; connections are separate `Connection` handles.
- **Data is bytes.** Writes take `Uint8Array` (or a string with an encoding) and inbound data arrives as `Uint8Array`. Delimiters, fixed-length frames and text decoding are handled by framed readers in JavaScript, so they behave the same on both platforms. The `buffer` package is no longer used.
- **Options are validated.** Option keys are camelCase only, and unknown keys are rejected. v1 keys such as `DELIMITER` or `CONNECTION_TYPE` fail with `INVALID_ARGUMENT`.

## API mapping

| v1 | v2 |
|---|---|
| `isBluetoothAvailable()` | `getAdapterState()` resolves `'unavailable'` (Android); `getCapabilities()` |
| `isBluetoothEnabled()` | `getAdapterState() === 'on'` (Android). iOS has no adapter state. |
| `requestBluetoothEnabled()` | `requestEnable()` |
| `openBluetoothSettings()` | `openSettings()` |
| `setBluetoothAdapterName(name)` | `setAdapterName(name)` |
| `getBondedDevices()` | `getBondedDevices()` (Android) / `getConnectedAccessories()` (iOS) |
| `startDiscovery()` / `cancelDiscovery()` | Same names. Each device is reported once, and the promise always settles. |
| `onDeviceDiscovered(listener)` | `onDeviceFound(listener)` |
| `pairDevice(address)` / `unpairDevice(address)` | `pair(address)` / `unpair(address)` |
| `connectToDevice(address, options)` / `device.connect(options)` | `connect(deviceId, options)` resolves with a `Connection` |
| `accept(options)` / `cancelAccept()` | Same names (Android only), new options |
| `getConnectedDevices()` / `getConnectedDevice(address)` / `isDeviceConnected(address)` | `getConnections()` / `getConnection(id)` / `connection.state` |
| `disconnectFromDevice(address)` / `device.disconnect()` | `connection.disconnect()` |
| `writeToDevice(address, data, encoding)` / `device.write(data)` | `connection.write(data, { encoding })` |
| `readFromDevice()` / `device.read()` / `availableFromDevice()` / `clearFromDevice()` | Removed. Use `connection.createReader({ framer })` or `connection.onData()`. |
| `onDeviceRead(address, listener)` / `device.onDataReceived(listener)` | `connection.onData(listener)`, or iterate a reader with `for await` |
| `onBluetoothEnabled` / `onBluetoothDisabled` / `onStateChanged` | `onAdapterStateChange` (Android) |
| `onDeviceConnected` / `onDeviceDisconnected` | `connection.onDisconnected` (every connection, both platforms); `onAccessoryConnected` / `onAccessoryDisconnected` (iOS) |
| `onError` | Removed. Errors arrive on the promise of the failing call or on `connection.onDisconnected`. |
| `BluetoothError` enum | `ErrorCode` and `BluetoothClassicError` |

## Connection options

| v1 option | v2 |
|---|---|
| `DELIMITER` / `delimiter` | `connection.createReader({ framer: delimiter('\n') })` |
| `DEVICE_CHARSET` / `charset` | Reader `encoding: 'utf8' \| 'ascii' \| 'latin1'` |
| `CONNECTION_TYPE: 'binary'` | `raw()` framer, or `connection.onData()` |
| `READ_SIZE` | `maxBufferBytes` (connect option) and `maxFrameBytes` (reader option) |
| `SECURE_SOCKET` / `secure` | `android: { transport: 'secure' \| 'insecure' }` |
| `CONNECTOR_TYPE`, `ACCEPTOR_TYPE` | Removed |
| `PROTOCOL_STRING` (iOS) | `ios: { protocol }` |
| `READ_TIMEOUT` | `reader.read({ timeoutMs })` |

## Custom connection types

v1 let Android apps register custom Java connection types through `RNBluetoothClassicPackage.Builder.withConnectionFactory`. v2 removes that native extension point. Implement the `Framer` interface in JavaScript instead; it runs identically on Android and iOS.

## Permissions

v1 left Android 12+ permissions to the app and could crash with a `SecurityException`. v2 checks them before every operation and rejects with `PERMISSION_DENIED` and `missingPermissions`. Use `checkPermissions(scope)` and `requestPermissions(scope)`; see the table in [api.md](./api.md#permissions).

## iOS

- The library no longer uses CoreBluetooth. There is no Bluetooth permission prompt and no adapter state on iOS.
- Accessories are identified by the OS connection id, which changes on every reconnect. Match on `serialNumber` if you need a stable identity.
- A missing `UISupportedExternalAccessoryProtocols` key no longer crashes the app. Connecting with an undeclared protocol fails with `PROTOCOL_NOT_DECLARED`.
