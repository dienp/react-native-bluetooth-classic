# Spec Delta

## Purpose

Defines the one error type and the closed set of error codes that every API uses on both platforms. Apps can rely on these codes, and every operation is guaranteed to finish exactly once, without crashing the host app.

## ADDED Requirements

### Requirement: Single runtime error type
Every failure surfaced by the library SHALL be an instance of `BluetoothClassicError`, a subclass of `Error` exported as a runtime value. It SHALL have `name === 'BluetoothClassicError'`, a `code` from the `ErrorCode` set, and a non-empty human-readable `message`. The library SHALL also export a runtime `ErrorCode` constant object and an `isBluetoothClassicError(value, code?)` type guard.

#### Scenario: Catching a typed error
- **WHEN** a `connect()` call fails and the app catches the rejection
- **THEN** `error instanceof BluetoothClassicError` is `true`
- **AND** `error.code` equals one of the `ErrorCode` values

#### Scenario: Comparing against exported codes
- **WHEN** an app evaluates `error.code === ErrorCode.CONNECT_TIMEOUT`
- **THEN** the comparison works at runtime because `ErrorCode` is a value export, not a type-only export

### Requirement: Error context fields
`BluetoothClassicError` SHALL carry `platform` (`'android'` or `'ios'`). When relevant it SHALL also carry `deviceId`, `connectionId`, `missingPermissions` (permission names), `nativeCode` and `nativeMessage` (the underlying OS error). It SHALL serialize those fields with `toJSON()` for logging.

#### Scenario: Native cause preserved
- **WHEN** an Android RFCOMM connect fails with an OS I/O error
- **THEN** the rejection has code `CONNECT_FAILED`, the target `deviceId`, and the OS error text in `nativeMessage`

#### Scenario: Serializing for logs
- **WHEN** an app calls `JSON.stringify(error)` on a `BluetoothClassicError`
- **THEN** the output includes `code`, `message`, `platform` and every context field that is set

### Requirement: Setup and adapter error codes
The `ErrorCode` set SHALL contain these setup and adapter codes:
- `MODULE_NOT_LINKED`
- `UNSUPPORTED_ON_PLATFORM`: the platform or OS release cannot do the operation
- `INVALID_ARGUMENT`
- `BLUETOOTH_UNAVAILABLE`: no Bluetooth hardware
- `BLUETOOTH_DISABLED`
- `PERMISSION_DENIED`
- `LOCATION_SERVICES_DISABLED`
- `USER_REJECTED`
- `ACTIVITY_UNAVAILABLE`: no foreground Android activity
- `UNKNOWN`

#### Scenario: Adapter switched off
- **WHEN** an operation that needs the adapter is called while Bluetooth is off
- **THEN** it rejects with `BLUETOOTH_DISABLED`

#### Scenario: No Bluetooth hardware
- **WHEN** an operation that needs the adapter is called on an Android device without Bluetooth hardware
- **THEN** it rejects with `BLUETOOTH_UNAVAILABLE`

### Requirement: Discovery and pairing error codes
The `ErrorCode` set SHALL contain these discovery and pairing codes:
- `DEVICE_NOT_FOUND`
- `DISCOVERY_ALREADY_RUNNING`
- `DISCOVERY_FAILED`: the OS refused to start discovery
- `PAIRING_IN_PROGRESS`
- `PAIRING_FAILED`
- `PAIRING_TIMEOUT`

#### Scenario: Pairing rejected on the remote device
- **WHEN** bonding with a device ends without a bond
- **THEN** the pairing call rejects with `PAIRING_FAILED`

### Requirement: Connection and data error codes
The `ErrorCode` set SHALL contain these connection and data codes:
- Connect: `CONNECT_FAILED`, `CONNECT_TIMEOUT`, `CONNECT_CANCELLED`, `ALREADY_CONNECTED`, `ALREADY_CONNECTING`
- Connection state: `NOT_CONNECTED`, `CONNECTION_LOST`
- Accept: `ACCEPT_FAILED`, `ACCEPT_TIMEOUT`, `ACCEPT_CANCELLED`, `ACCEPT_ALREADY_RUNNING`
- Data: `WRITE_FAILED`, `WRITE_TIMEOUT`, `READ_TIMEOUT`, `BUFFER_OVERFLOW`

#### Scenario: Operation on a closed connection
- **WHEN** an app calls `write()` on a connection whose state is `disconnected`
- **THEN** the promise rejects with `NOT_CONNECTED`

### Requirement: iOS accessory error codes
The `ErrorCode` set SHALL contain these iOS accessory codes:
- `PROTOCOL_NOT_DECLARED`: the protocol is missing from Info.plist
- `PROTOCOL_NOT_SUPPORTED`: the accessory does not support the protocol
- `ACCESSORY_NOT_CONNECTED`
- `SESSION_OPEN_FAILED`: the OS refused to open a session

#### Scenario: Undeclared protocol
- **WHEN** an iOS app connects with a protocol that is not listed in `UISupportedExternalAccessoryProtocols`
- **THEN** the promise rejects with `PROTOCOL_NOT_DECLARED`

### Requirement: Normalization of native failures
Every native failure SHALL be mapped to an `ErrorCode` before it reaches app code. A failure with no specific mapping SHALL become `UNKNOWN`, keeping `nativeCode` and `nativeMessage`. Raw React Native error objects, `EUNSPECIFIED` codes and platform-specific code strings SHALL never reach app code.

#### Scenario: Unmapped Android exception
- **WHEN** an unexpected Android exception occurs during an operation
- **THEN** the operation rejects with `UNKNOWN`
- **AND** the exception class and message are available in `nativeCode` and `nativeMessage`

#### Scenario: Same failure, same code on both platforms
- **WHEN** a write is attempted on a connection that has already ended, on Android and on iOS
- **THEN** both platforms reject with `NOT_CONNECTED`

### Requirement: Every operation settles exactly once
Every promise the library returns SHALL resolve or reject exactly once, within its documented timeout. This SHALL hold when the app is backgrounded, when system dialogs pause the activity, when the adapter turns off, when an operation is cancelled, and when the module is torn down. If an operation has no timeout option, the spec for that operation states its terminal conditions.

#### Scenario: Activity paused by a system dialog
- **WHEN** a system pairing or permission dialog pauses the Android activity while an operation is pending
- **THEN** the operation still settles as specified once its terminal condition occurs

#### Scenario: Module teardown with pending operations
- **WHEN** the JS runtime reloads while a `connect()` is pending
- **THEN** the native operation is cancelled and its socket or session is closed, and no callback is delivered to the new runtime

### Requirement: No crashes from library failures
Failures inside the library, including OS security exceptions, invalid input and I/O errors on background threads, SHALL NOT crash the host app. They SHALL surface as rejections, as thrown `BluetoothClassicError`s from synchronous APIs, or as terminal connection events.

#### Scenario: Missing runtime permission on Android 12+
- **WHEN** an app on API 31+ calls `getBondedDevices()` without `BLUETOOTH_CONNECT` granted
- **THEN** the promise rejects with `PERMISSION_DENIED` and the app keeps running

#### Scenario: Malformed input
- **WHEN** an app calls `connect('not-an-address')` on Android
- **THEN** the promise rejects with `INVALID_ARGUMENT` and the app keeps running

### Requirement: Asynchronous APIs never throw synchronously
Every API that returns a promise SHALL report all failures, including argument validation and platform checks, by rejecting that promise. It SHALL NOT throw synchronously.

#### Scenario: Invalid options
- **WHEN** an app calls `connect(deviceId, { timeoutMs: -1 })`
- **THEN** the call returns a promise that rejects with `INVALID_ARGUMENT` naming `timeoutMs`
- **AND** no exception is thrown at the call site

### Requirement: Strict option validation
Options objects SHALL be validated before any native work starts. An unknown key, a value of the wrong type or an out-of-range value SHALL reject with `INVALID_ARGUMENT`, and the message SHALL name the key. Option keys are camelCase only.

#### Scenario: v1-style option key
- **WHEN** an app passes `{ DELIMITER: '\n' }` to `connect()`
- **THEN** the promise rejects with `INVALID_ARGUMENT`, and the message names `DELIMITER` as an unknown option
