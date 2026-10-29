# API reference

> v2 is in development. The JavaScript layer described here is implemented and tested. Natively, Android implements adapter state, permissions, `requestEnable`, `openSettings`, `setAdapterName`, discovery, pairing and bond events (see [android.md](./android.md)); everything else still rejects with `UNSUPPORTED_ON_PLATFORM`.

```ts
import * as BluetoothClassic from '@dynlabs/react-native-bluetooth-classic';
```

## Conventions

- Every asynchronous function returns a promise and **never throws synchronously**. Every failure is a [`BluetoothClassicError`](./errors.md) with a `code`.
- Synchronous functions (`getCapabilities`, `setLogLevel`, `on*` subscriptions) throw a `BluetoothClassicError`.
- Calling an API the platform cannot support fails with `UNSUPPORTED_ON_PLATFORM`. Check [`getCapabilities()`](#getcapabilities) first.
- Options are validated before any native work. Unknown keys, wrong types and out-of-range values fail with `INVALID_ARGUMENT`, and the message names the key.
- Returned objects and event payloads are frozen. Timestamps are milliseconds since the Unix epoch.
- Android addresses are accepted in any case and returned in upper case.
- On Android, operations check their preconditions in this order: Bluetooth hardware (`BLUETOOTH_UNAVAILABLE`), runtime permissions (`PERMISSION_DENIED`), adapter on (`BLUETOOTH_DISABLED`), then Location Services for discovery on API 24–30 (`LOCATION_SERVICES_DISABLED`).

## Platform

### `getCapabilities()`

```ts
getCapabilities(): Capabilities
```

Synchronously reports what the current platform can do: `platform`, `osVersion` (Android API level or iOS version) and the flags `discovery`, `pairing`, `server`, `adapterState`, `requestEnable`, `bondLossEvents` and `accessoryPicker`. On iOS, `declaredProtocols` lists `UISupportedExternalAccessoryProtocols` from Info.plist. On hosts other than Android and iOS every flag is `false`.

### `setLogLevel(level)`

```ts
setLogLevel(level: 'debug' | 'info' | 'warn' | 'error' | 'silent'): void
```

The default is `'warn'`. Payloads, device names and addresses are only logged at `'debug'`.

## Adapter

| Function | Platforms | Notes |
|---|---|---|
| `getAdapterState(): Promise<AdapterState>` | Android | `'unavailable' \| 'off' \| 'turningOn' \| 'on' \| 'turningOff'` |
| `onAdapterStateChange(listener): Subscription` | Android | `{ state, previousState, timestamp }` for every transition |
| `requestEnable(): Promise<void>` | Android | Shows the system prompt and resolves once the adapter is on. Concurrent calls share one prompt. `USER_REJECTED`, `ACTIVITY_UNAVAILABLE` |
| `openSettings(): Promise<void>` | Android, iOS | Bluetooth settings on Android; the app's settings page on iOS |
| `setAdapterName(name): Promise<void>` | Android | 1–248 UTF-8 bytes |

## Permissions

| Function | Notes |
|---|---|
| `checkPermissions(scope): Promise<PermissionStatus>` | `{ granted, missing, locationServicesEnabled? }`, never prompts |
| `requestPermissions(scope): Promise<PermissionRequestResult>` | Prompts for missing permissions only; adds `canAskAgain` |

`scope` is `'discovery'`, `'connect'` or `'server'`. Permission names in `missing` omit the `android.permission.` prefix.

| Android API | `'discovery'` | `'connect'` / `'server'` |
|---|---|---|
| 24–28 | `ACCESS_COARSE_LOCATION` (or `ACCESS_FINE_LOCATION`) | none |
| 29–30 | `ACCESS_FINE_LOCATION`, and Location Services switched on | none |
| 31+ | `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` | `BLUETOOTH_CONNECT` |

On iOS, `'connect'` always resolves as granted and the other scopes fail with `UNSUPPORTED_ON_PLATFORM`.

## Discovery (Android)

| Function | Notes |
|---|---|
| `getBondedDevices(): Promise<AndroidDevice[]>` | Devices bonded to the adapter |
| `startDiscovery({ timeoutMs? }): Promise<AndroidDevice[]>` | Resolves with every device found when the session ends (OS completion, `timeoutMs`, or `cancelDiscovery()`). `DISCOVERY_ALREADY_RUNNING`, `DISCOVERY_FAILED`, `LOCATION_SERVICES_DISABLED` |
| `cancelDiscovery(): Promise<void>` | Resolves even when nothing is running |
| `onDeviceFound(listener): Subscription` | Fires at most once per address per session |

`AndroidDevice`: `{ id, address, name, bondState, type, deviceClass, rssi? }`. `id` equals the upper-case `address`; `rssi` is present only on discovery results.

## Pairing (Android)

| Function | Notes |
|---|---|
| `pair(address, { timeoutMs? }): Promise<AndroidDevice>` | Default timeout 60 s. Pairing confirmation always goes through the system UI. `PAIRING_FAILED`, `PAIRING_TIMEOUT`, `PAIRING_IN_PROGRESS` |
| `unpair(address): Promise<void>` | Android has no public bond-removal API, so this fails with `UNSUPPORTED_ON_PLATFORM` on releases that block it; the user then unpairs in system settings |
| `onBondStateChange(listener): Subscription` | `{ device, state, previousState, timestamp }` for any device |
| `onBondLost(listener): Subscription` | API 36+ only; see `getCapabilities().bondLossEvents` |

## Accessories (iOS)

| Function | Notes |
|---|---|
| `getConnectedAccessories(): Promise<IosAccessory[]>` | Accessories connected to iOS that support a declared protocol |
| `showAccessoryPicker({ nameFilter? }): Promise<void>` | `USER_REJECTED` when dismissed, `DEVICE_NOT_FOUND` when nothing matches |
| `onAccessoryConnected(listener)` / `onAccessoryDisconnected(listener)` | `{ accessory, timestamp }` |

`IosAccessory`: `{ id, name, manufacturer, modelNumber, serialNumber, firmwareRevision, hardwareRevision, protocolStrings }`. `id` changes every time the accessory reconnects to iOS; `serialNumber` does not.

## Connections

| Function | Notes |
|---|---|
| `connect(deviceId, options?): Promise<Connection>` | Android address or iOS accessory id. See [data.md](./data.md#connecting) |
| `accept(options?): Promise<Connection>` | Android only |
| `cancelAccept(): Promise<void>` | Android only |
| `getConnections(): Promise<Connection[]>` | Connections that have not ended |
| `getConnection(id): Promise<Connection \| null>` | |

`Connection`: `id`, `device`, `protocol` (iOS), `connectedAt`, `state`, `write()`, `disconnect()`, `onData()`, `onStateChange()`, `onDisconnected()`, `createReader()`. See [data.md](./data.md).

## Data helpers

`delimiter()`, `fixedLength()`, `raw()`, `encodeText()`, `decodeText()`, `createTextDecoder()`, `toHex()`, `fromHex()`, `toBase64()`, `fromBase64()`. See [data.md](./data.md#framers).

## Examples

- [Quick start](./examples/quick-start.ts)
- [Discovery](./examples/discovery.ts)
- [iOS accessories](./examples/accessories.ts)
- [Printing and request/response](./examples/printer.ts)
- [Streaming and a custom framer](./examples/streaming.ts)
