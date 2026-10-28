# Spec Delta

## Purpose

Defines how apps find devices they can connect to. On Android that means bonded devices and discovery sessions; on iOS it means MFi accessories that are already connected, plus the system accessory picker. Also defines the device objects these APIs return.

## ADDED Requirements

### Requirement: Android device objects
Android devices SHALL be immutable plain objects with these fields:
- `id`: the MAC address in upper case, which equals `address`
- `address`
- `name`: `null` when unknown
- `bondState`: `'none'`, `'bonding'` or `'bonded'`
- `type`: `'classic'`, `'le'`, `'dual'` or `'unknown'`
- `deviceClass`: `{ major, value }`, or `null`
- `rssi`: present only on objects from discovery

Every API SHALL accept addresses in either case. A malformed address SHALL reject with `INVALID_ARGUMENT`.

#### Scenario: Lower-case address input (Android)
- **WHEN** an Android app calls `connect('00:11:22:aa:bb:cc')`
- **THEN** the call is treated as the device with `id` `00:11:22:AA:BB:CC`

#### Scenario: Malformed address (Android)
- **WHEN** an Android app calls `pair('00:11:22')`
- **THEN** the promise rejects with `INVALID_ARGUMENT`

#### Scenario: Device objects are immutable (Android)
- **WHEN** app code tries to assign to a field of a returned device object
- **THEN** the assignment has no effect on the object

### Requirement: iOS accessory objects
iOS accessories SHALL be immutable plain objects with these fields:
- `id`: the OS connection identifier as a string; it changes each time the accessory reconnects to the OS
- `name`
- `manufacturer`, `modelNumber`, `serialNumber`, `firmwareRevision`, `hardwareRevision`
- `protocolStrings`

#### Scenario: Accessory identity (iOS)
- **WHEN** an MFi accessory disconnects from the OS and reconnects
- **THEN** it is reported with a new `id` and the same `serialNumber`

### Requirement: Bonded devices
On Android, `getBondedDevices()` SHALL resolve with every device currently bonded to the adapter, in OS order. It needs the `'connect'` permission scope and the adapter turned on. On iOS it SHALL reject with `UNSUPPORTED_ON_PLATFORM`; apps use `getConnectedAccessories()` instead.

#### Scenario: Bonded devices listed (Android)
- **WHEN** an Android app with permissions calls `getBondedDevices()` while the adapter is on
- **THEN** it resolves with one device object per bonded device, each with `bondState: 'bonded'`

#### Scenario: Adapter off (Android)
- **WHEN** an Android app calls `getBondedDevices()` while the adapter is off
- **THEN** the promise rejects with `BLUETOOTH_DISABLED`

#### Scenario: Bonded devices on iOS
- **WHEN** an iOS app calls `getBondedDevices()`
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`

### Requirement: Discovery sessions
On Android, `startDiscovery(options?)` SHALL start a discovery session. It SHALL emit `onDeviceFound({ device, timestamp })` at most once per address per session. It SHALL resolve with every device found when the session ends by OS completion, by `timeoutMs` elapsing, or by `cancelDiscovery()`. On iOS it SHALL reject with `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Device seen twice (Android)
- **WHEN** the OS reports the same device more than once during one session
- **THEN** `onDeviceFound` fires once for that address
- **AND** the resolved list contains that device once, with its latest name and RSSI

#### Scenario: Session ends by timeout (Android)
- **WHEN** an app calls `startDiscovery({ timeoutMs: 5000 })`
- **THEN** discovery stops no later than 5 seconds after starting
- **AND** the promise resolves with the devices found so far

#### Scenario: Discovery on iOS
- **WHEN** an iOS app calls `startDiscovery()`
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`

### Requirement: Discovery always settles
A discovery promise SHALL settle whatever happens to the activity or the adapter. App pause, system dialogs and backgrounding SHALL NOT stop the session or leave it pending. When the adapter turns off during a session, the promise SHALL reject with `BLUETOOTH_DISABLED`. When the OS refuses to start discovery, the promise SHALL reject with `DISCOVERY_FAILED`.

#### Scenario: App paused during discovery (Android)
- **WHEN** the app moves to the background while a discovery session is running
- **THEN** the session continues until it ends normally, and the promise resolves with the devices found

#### Scenario: Adapter turned off during discovery (Android)
- **WHEN** the adapter turns off while a discovery session is running
- **THEN** the promise rejects with `BLUETOOTH_DISABLED`

#### Scenario: OS refuses to start (Android)
- **WHEN** the OS reports that discovery could not be started
- **THEN** the promise rejects with `DISCOVERY_FAILED`

### Requirement: One discovery session at a time
Only one discovery session started by the library SHALL run at a time. On Android, calling `startDiscovery()` while a session is running SHALL reject with `DISCOVERY_ALREADY_RUNNING`. The running session SHALL be unaffected.

#### Scenario: Second start (Android)
- **WHEN** an app calls `startDiscovery()` while its earlier session is still running
- **THEN** the second call rejects with `DISCOVERY_ALREADY_RUNNING`, and the first session continues

### Requirement: Cancel discovery
On Android, `cancelDiscovery()` SHALL stop the running session and resolve once it has stopped. The pending `startDiscovery()` promise SHALL resolve with the devices found so far. Calling it with no session running SHALL resolve without effect. On iOS it SHALL reject with `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Cancel a running session (Android)
- **WHEN** an app calls `cancelDiscovery()` during a session that has found two devices
- **THEN** `cancelDiscovery()` resolves, and the pending `startDiscovery()` resolves with those two devices

#### Scenario: Cancel with nothing running (Android)
- **WHEN** an app calls `cancelDiscovery()` while no session is running
- **THEN** the promise resolves, and nothing else happens

### Requirement: Connected accessories
On iOS, `getConnectedAccessories()` SHALL resolve with the accessories currently connected to the OS that support at least one protocol declared in `UISupportedExternalAccessoryProtocols`. On Android it SHALL reject with `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Accessory with a declared protocol (iOS)
- **WHEN** an MFi accessory that supports a declared protocol is connected to the OS
- **THEN** `getConnectedAccessories()` includes it, with its `protocolStrings`

#### Scenario: Accessory without a declared protocol (iOS)
- **WHEN** a connected accessory supports none of the declared protocols
- **THEN** `getConnectedAccessories()` does not include it

#### Scenario: Connected accessories on Android
- **WHEN** an Android app calls `getConnectedAccessories()`
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`

### Requirement: Accessory picker
On iOS, `showAccessoryPicker({ nameFilter? })` SHALL show the system Bluetooth accessory picker. It SHALL resolve when the user selects an accessory or the accessory is already connected. It SHALL reject with `USER_REJECTED` when the user cancels, with `DEVICE_NOT_FOUND` when no matching accessory is found, and with `UNKNOWN` on any other picker failure. On Android it SHALL reject with `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: User selects an accessory (iOS)
- **WHEN** the user selects an accessory in the picker
- **THEN** the promise resolves, and `onAccessoryConnected` fires once the accessory connects to the OS

#### Scenario: User cancels (iOS)
- **WHEN** the user dismisses the picker without selecting
- **THEN** the promise rejects with `USER_REJECTED`

#### Scenario: Picker on Android
- **WHEN** an Android app calls `showAccessoryPicker()`
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`

### Requirement: Accessory connection events
On iOS, `onAccessoryConnected(listener)` and `onAccessoryDisconnected(listener)` SHALL deliver `{ accessory, timestamp }` when an accessory that supports a declared protocol connects to or disconnects from the OS. On Android, subscribing SHALL throw `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Accessory powered off (iOS)
- **WHEN** a connected accessory with a declared protocol is powered off
- **THEN** `onAccessoryDisconnected` fires with that accessory

#### Scenario: Subscribing on Android
- **WHEN** an Android app calls `onAccessoryConnected(listener)`
- **THEN** the call throws a `BluetoothClassicError` with code `UNSUPPORTED_ON_PLATFORM`
