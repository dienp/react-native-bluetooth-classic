# Spec Delta

## Purpose

Defines how Android apps create and remove bonds with remote devices and observe bond-state changes, including bond-loss reporting on newer Android releases. iOS does not allow these operations.

## ADDED Requirements

### Requirement: Pair with a device
On Android, `pair(address, { timeoutMs? })` SHALL start bonding with that address. It SHALL resolve with the updated device once that address reaches `'bonded'`. If the device is already bonded, it SHALL resolve immediately. Bond changes for other devices SHALL be ignored. The default timeout SHALL be 60 seconds. On iOS it SHALL reject with `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Successful pairing (Android)
- **WHEN** an app calls `pair(address)` and the user confirms the system pairing dialog
- **THEN** the promise resolves with the device, with `bondState: 'bonded'`

#### Scenario: Pairing declined or failed (Android)
- **WHEN** bonding with that address ends in `'none'` without reaching `'bonded'`
- **THEN** the promise rejects with `PAIRING_FAILED`

#### Scenario: Another device changes bond state (Android)
- **WHEN** a different device becomes bonded or unbonded while `pair(address)` is pending
- **THEN** the pending promise is unaffected

#### Scenario: Pairing times out (Android)
- **WHEN** the device does not reach a terminal bond state within `timeoutMs`
- **THEN** the promise rejects with `PAIRING_TIMEOUT`
- **AND** the library asks the OS to cancel the bonding attempt where the API level allows it

#### Scenario: OS refuses to start bonding (Android)
- **WHEN** the OS refuses to start bonding
- **THEN** the promise rejects with `PAIRING_FAILED` immediately

#### Scenario: Pairing on iOS
- **WHEN** an iOS app calls `pair(id)`
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`

### Requirement: One pairing per device at a time
On Android, calling `pair(address)` while a pairing started by the library for the same address is still pending SHALL reject with `PAIRING_IN_PROGRESS`. Pairing different addresses at the same time SHALL be allowed.

#### Scenario: Duplicate pair call (Android)
- **WHEN** an app calls `pair(address)` twice before the first call settles
- **THEN** the second call rejects with `PAIRING_IN_PROGRESS`, and the first continues

### Requirement: Pairing uses system UI only
The library SHALL NOT programmatically supply PINs or passkeys, or confirm pairing requests. Pairing confirmation SHALL always go through the OS pairing UI.

#### Scenario: Device requests a PIN (Android)
- **WHEN** a device being paired requests a PIN
- **THEN** the OS pairing dialog collects it from the user, and the library only observes the bond outcome

### Requirement: Unpair a device
On Android, `unpair(address)` SHALL remove the bond and resolve once that address reaches `'none'`. If the device is not bonded it SHALL resolve immediately. On API 36 and later it SHALL use the public OS API. On API 24 to 35, if the OS blocks bond removal, it SHALL reject with `UNSUPPORTED_ON_PLATFORM`. On iOS it SHALL reject with `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Unpair on API 36+
- **WHEN** an app on API 36 or later calls `unpair(address)` for a bonded device
- **THEN** the promise resolves after the device's bond state becomes `'none'`

#### Scenario: Bond removal blocked on API 24-35
- **WHEN** an app on API 24 to 35 calls `unpair(address)` and the OS blocks bond removal
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`, and the message explains that the user must unpair in system settings

#### Scenario: Unpair on iOS
- **WHEN** an iOS app calls `unpair(id)`
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`

### Requirement: Bond state events
On Android, `onBondStateChange(listener)` SHALL deliver `{ device, state, previousState, timestamp }` for every bond-state transition of any device, while the JS runtime is alive. This includes transitions while a system dialog covers the activity. On iOS, subscribing SHALL throw `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Bond completes behind the pairing dialog (Android)
- **WHEN** bonding completes while the system pairing dialog is in front of the app
- **THEN** listeners receive the `'bonding'` to `'bonded'` transition

#### Scenario: Subscribing on iOS
- **WHEN** an iOS app calls `onBondStateChange(listener)`
- **THEN** the call throws a `BluetoothClassicError` with code `UNSUPPORTED_ON_PLATFORM`

### Requirement: Bond loss events
On Android API 36 and later, `onBondLost(listener)` SHALL deliver `{ device, timestamp }` when the OS reports that the remote device lost its bonding keys. On API 24 to 35 the subscription SHALL be accepted but SHALL never fire, because the OS does not report this. On iOS, subscribing SHALL throw `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Remote device forgot the bond (API 36+)
- **WHEN** a bonded device was reset and the OS reports missing keys
- **THEN** `onBondLost` fires with that device

#### Scenario: Older Android releases
- **WHEN** an app on API 35 or lower subscribes to `onBondLost`
- **THEN** the subscription succeeds, and `getCapabilities()` reports `bondLossEvents: false`
