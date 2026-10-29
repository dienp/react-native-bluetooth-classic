# Spec Delta

## Purpose

Lets app developers unit-test code that uses the library without Bluetooth hardware, and gives maintainers an example app for repeatable validation on real devices.

## ADDED Requirements

### Requirement: Jest mock entry point
The package SHALL ship a mock at `@dynlabs/react-native-bluetooth-classic/jest` that implements the full public API with the same TypeScript types, error class and error codes as the real module. Enabling it SHALL take one `jest.mock` line.

#### Scenario: Enable the mock
- **WHEN** a test file calls `jest.mock('@dynlabs/react-native-bluetooth-classic', () => require('@dynlabs/react-native-bluetooth-classic/jest'))`
- **THEN** code under test can call every public API without native modules, and the calls type-check against the real declarations

### Requirement: Controllable fake devices
The mock SHALL let tests:
- register fake bonded devices, discoverable devices and iOS accessories
- push inbound bytes to a connection
- end a connection with a chosen terminal reason and error code
- make the next call of a given API fail with a chosen `ErrorCode`
- read back every byte written to a connection

#### Scenario: Simulate a device reply
- **WHEN** a test connects to a fake device and pushes the bytes `"OK\r\n"`
- **THEN** a `delimiter('\r\n')` reader in the code under test produces the frame `"OK"`

#### Scenario: Simulate a failure
- **WHEN** a test configures the next `connect()` to fail with `CONNECT_TIMEOUT`
- **THEN** the code under test receives a `BluetoothClassicError` with code `CONNECT_TIMEOUT`

#### Scenario: Inspect written bytes
- **WHEN** code under test writes a command to a fake connection
- **THEN** the test can read back exactly the bytes written, in order

### Requirement: Platform emulation in the mock
The mock SHALL emulate either Android, at a chosen API level, or iOS. Its capability flags, its `UNSUPPORTED_ON_PLATFORM` behavior and its API-band-dependent permission results SHALL match the real module for that platform.

#### Scenario: Emulating iOS
- **WHEN** a test sets the mock to iOS and calls `startDiscovery()`
- **THEN** the call rejects with `UNSUPPORTED_ON_PLATFORM`, and `getCapabilities().discovery` is `false`

#### Scenario: Emulating Android API 30
- **WHEN** a test sets the mock to Android API 30 with Location Services off and calls `startDiscovery()`
- **THEN** the call rejects with `LOCATION_SERVICES_DISABLED`

### Requirement: Example app for hardware validation
The repository SHALL include an example app that builds on the minimum (0.82) and latest supported React Native releases. It SHALL include screens for adapter state, permissions, discovery and pairing (Android), the accessory picker (iOS), connecting, and a loopback/echo test that reports the bytes sent and received and any error codes. The hardware validation checklist SHALL be run on it before every release.

#### Scenario: Echo test against a serial device
- **WHEN** a maintainer runs the echo test against an SPP device that echoes its input
- **THEN** the screen reports that the bytes received match the bytes sent, with timings

#### Scenario: Error surfaced in the example
- **WHEN** a connect attempt in the example app fails
- **THEN** the screen shows the error's `code`, `message` and `nativeMessage`
