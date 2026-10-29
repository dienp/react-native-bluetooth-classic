# Spec Delta

## Purpose

Lets apps see whether Bluetooth hardware exists and whether it is on, follow state changes, ask the user to turn Bluetooth on, and open the relevant settings. Covers both what Android allows and the limits iOS imposes.

## ADDED Requirements

### Requirement: Adapter state query
`getAdapterState()` SHALL resolve with one of `'unavailable'`, `'off'`, `'turningOn'`, `'on'` or `'turningOff'`, reflecting the OS adapter state at call time. `'unavailable'` means the device has no Bluetooth hardware. On iOS the call SHALL reject with `UNSUPPORTED_ON_PLATFORM`, because ExternalAccessory does not expose adapter state.

#### Scenario: Adapter on (Android)
- **WHEN** Bluetooth is on and an Android app calls `getAdapterState()`
- **THEN** it resolves with `'on'`

#### Scenario: No Bluetooth hardware (Android)
- **WHEN** an Android device has no Bluetooth adapter
- **THEN** `getAdapterState()` resolves with `'unavailable'`

#### Scenario: Adapter state on iOS
- **WHEN** an iOS app calls `getAdapterState()`
- **THEN** it rejects with `UNSUPPORTED_ON_PLATFORM`
- **AND** no Bluetooth permission prompt is shown

### Requirement: Adapter state change events
On Android, `onAdapterStateChange(listener)` SHALL deliver `{ state, previousState, timestamp }` for every adapter transition while the JS runtime is alive. This includes transitions that happen while the app is in the background or while a system dialog covers the activity. On iOS, subscribing SHALL throw `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: User turns Bluetooth off from quick settings (Android)
- **WHEN** the user turns Bluetooth off while the app is in the foreground
- **THEN** listeners receive `turningOff` and then `off`, each with the correct `previousState`

#### Scenario: Transition behind a system dialog (Android)
- **WHEN** the system enable-Bluetooth dialog is shown and the adapter turns on
- **THEN** listeners receive the `turningOn` and `on` transitions

#### Scenario: Subscribing on iOS
- **WHEN** an iOS app calls `onAdapterStateChange(listener)`
- **THEN** the call throws a `BluetoothClassicError` with code `UNSUPPORTED_ON_PLATFORM`

### Requirement: Adapter preconditions for operations
Any operation that needs the adapter SHALL check it before starting. It SHALL reject with `BLUETOOTH_UNAVAILABLE` when the device has no Bluetooth hardware, and with `BLUETOOTH_DISABLED` when the adapter is not `'on'`. This applies on Android to discovery, pairing, connect, accept, bonded-device listing and setting the adapter name.

#### Scenario: Connect while Bluetooth is off (Android)
- **WHEN** an Android app calls `connect()` while the adapter is `'off'`
- **THEN** the promise rejects with `BLUETOOTH_DISABLED`, and no socket is created

### Requirement: Request to enable Bluetooth
On Android, `requestEnable()` SHALL show the system enable-Bluetooth prompt and resolve once the adapter reports `'on'`. If the adapter is already `'on'` it SHALL resolve immediately without a prompt. Concurrent calls SHALL share one prompt and one result. On iOS it SHALL reject with `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: User accepts (Android)
- **WHEN** an app calls `requestEnable()` and the user accepts the prompt
- **THEN** the promise resolves after the adapter state becomes `'on'`

#### Scenario: User declines (Android)
- **WHEN** the user declines the prompt
- **THEN** the promise rejects with `USER_REJECTED`

#### Scenario: Concurrent requests (Android)
- **WHEN** an app calls `requestEnable()` twice before the user answers
- **THEN** only one prompt is shown, and both promises settle with the same outcome

#### Scenario: No foreground activity (Android)
- **WHEN** an app calls `requestEnable()` while no activity is in the foreground
- **THEN** the promise rejects with `ACTIVITY_UNAVAILABLE`

#### Scenario: Missing permission on API 31+
- **WHEN** an app on API 31 or later calls `requestEnable()` without `BLUETOOTH_CONNECT` granted
- **THEN** the promise rejects with `PERMISSION_DENIED` and `missingPermissions` contains `BLUETOOTH_CONNECT`

#### Scenario: Request on iOS
- **WHEN** an iOS app calls `requestEnable()`
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`

### Requirement: Open settings
`openSettings()` SHALL open the most relevant system settings screen and resolve once the screen is launched. On Android this is the Bluetooth settings screen; it SHALL reject with `ACTIVITY_UNAVAILABLE` if no app can handle that screen. On iOS this is the app's own settings page.

#### Scenario: Open settings on Android
- **WHEN** an Android app calls `openSettings()`
- **THEN** the system Bluetooth settings screen opens and the promise resolves

#### Scenario: Open settings on iOS
- **WHEN** an iOS app calls `openSettings()`
- **THEN** the app's page in the Settings app opens and the promise resolves

### Requirement: Set the adapter name
On Android, `setAdapterName(name)` SHALL set the local adapter's visible name and resolve once the OS accepts it. An empty name SHALL reject with `INVALID_ARGUMENT`. A name of more than 248 UTF-8 bytes SHALL reject with `INVALID_ARGUMENT`. On iOS the call SHALL reject with `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Valid name (Android)
- **WHEN** an Android app with the required permissions calls `setAdapterName('Kiosk 12')` while the adapter is on
- **THEN** the promise resolves, and the adapter name reported by the OS is `Kiosk 12`

#### Scenario: Empty name (Android)
- **WHEN** an Android app calls `setAdapterName('')`
- **THEN** the promise rejects with `INVALID_ARGUMENT`

#### Scenario: Set name on iOS
- **WHEN** an iOS app calls `setAdapterName('x')`
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`
