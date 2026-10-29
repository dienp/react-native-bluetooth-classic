# Spec Delta

## Purpose

Defines which runtime permissions and OS settings each kind of Bluetooth work needs on every supported Android API band, how apps check and request them, and how operations fail when they are missing, instead of crashing.

## ADDED Requirements

### Requirement: Permission scopes
Permissions SHALL be grouped into three scopes:
- `'discovery'`: finding nearby devices
- `'connect'`: bonded-device listing, pairing, client connections and adapter changes
- `'server'`: accepting incoming connections

Each scope SHALL map to the runtime permissions that the running Android API band requires.

#### Scenario: Discovery scope on API 24-28
- **WHEN** the app runs on API 24 to 28
- **THEN** the `'discovery'` scope requires `ACCESS_COARSE_LOCATION` (or `ACCESS_FINE_LOCATION`)

#### Scenario: Discovery scope on API 29-30
- **WHEN** the app runs on API 29 or 30
- **THEN** the `'discovery'` scope requires `ACCESS_FINE_LOCATION`

#### Scenario: Discovery scope on API 31+
- **WHEN** the app runs on API 31 or later
- **THEN** the `'discovery'` scope requires `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT`

#### Scenario: Connect and server scopes on API 24-30
- **WHEN** the app runs on API 24 to 30
- **THEN** the `'connect'` and `'server'` scopes require no runtime permission

#### Scenario: Connect and server scopes on API 31+
- **WHEN** the app runs on API 31 or later
- **THEN** the `'connect'` and `'server'` scopes require `BLUETOOTH_CONNECT`

### Requirement: Check permissions without prompting
`checkPermissions(scope)` SHALL resolve with `{ granted, missing }` and never show a prompt. `missing` lists the permissions the scope still needs. On Android API 24-30, a `'discovery'` result SHALL also report `locationServicesEnabled`. On iOS, `'connect'` SHALL resolve with `granted: true`; `'discovery'` and `'server'` SHALL reject with `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Missing permission on API 31+
- **WHEN** an app on API 31 or later calls `checkPermissions('connect')` without `BLUETOOTH_CONNECT` granted
- **THEN** it resolves with `granted: false` and `missing: ['BLUETOOTH_CONNECT']`, and no prompt is shown

#### Scenario: Location Services off on API 29-30
- **WHEN** an app on API 29 or 30 calls `checkPermissions('discovery')` with `ACCESS_FINE_LOCATION` granted but Location Services switched off
- **THEN** it resolves with `granted: true` and `locationServicesEnabled: false`

#### Scenario: Connect scope on iOS
- **WHEN** an iOS app calls `checkPermissions('connect')`
- **THEN** it resolves with `granted: true` and `missing: []`

#### Scenario: Discovery scope on iOS
- **WHEN** an iOS app calls `checkPermissions('discovery')`
- **THEN** it rejects with `UNSUPPORTED_ON_PLATFORM`

### Requirement: Request permissions
On Android, `requestPermissions(scope)` SHALL prompt only for the scope's missing permissions. It SHALL resolve with `{ granted, missing, canAskAgain }`, where `canAskAgain` is `false` when the OS will no longer show the prompt. It SHALL reject with `ACTIVITY_UNAVAILABLE` when no activity is in the foreground. On iOS it follows the same rules as `checkPermissions`.

#### Scenario: User grants (Android 12+)
- **WHEN** an app on API 31 or later calls `requestPermissions('discovery')` and the user grants every prompt
- **THEN** it resolves with `granted: true` and `missing: []`

#### Scenario: Permanently denied (Android)
- **WHEN** the user has denied the permission with "don't ask again"
- **THEN** `requestPermissions` resolves with `granted: false`, the permission in `missing`, and `canAskAgain: false`, without showing a prompt

#### Scenario: Already granted (Android)
- **WHEN** every permission of the scope is already granted
- **THEN** `requestPermissions` resolves with `granted: true` without showing a prompt

#### Scenario: No foreground activity (Android)
- **WHEN** an app calls `requestPermissions('connect')` while no activity is in the foreground
- **THEN** it rejects with `ACTIVITY_UNAVAILABLE`

### Requirement: Operations check permissions first
Before doing any Bluetooth work, every Android operation SHALL check the permissions of its scope. If any are missing it SHALL reject with `PERMISSION_DENIED`, with `missingPermissions` listing them. The library SHALL NOT prompt implicitly, and SHALL NOT let an OS security exception escape on any thread.

#### Scenario: Discovery without permission on API 31+
- **WHEN** an app on API 31 or later calls `startDiscovery()` without `BLUETOOTH_SCAN` granted
- **THEN** the promise rejects with `PERMISSION_DENIED` and `missingPermissions` contains `BLUETOOTH_SCAN`, and discovery does not start

#### Scenario: Discovery without location permission on API 29-30
- **WHEN** an app on API 29 or 30 calls `startDiscovery()` without `ACCESS_FINE_LOCATION` granted
- **THEN** the promise rejects with `PERMISSION_DENIED` instead of never settling

### Requirement: Location Services required for discovery on API 24-30
On Android API 24 to 30, `startDiscovery()` SHALL reject with `LOCATION_SERVICES_DISABLED` when the system Location Services setting is off. On those releases the OS would otherwise return no results without reporting an error. On API 31 and later the Location Services setting SHALL NOT affect discovery.

#### Scenario: Location Services off on API 29
- **WHEN** an app on API 29 with location permission granted calls `startDiscovery()` while Location Services is off
- **THEN** the promise rejects with `LOCATION_SERVICES_DISABLED`

#### Scenario: Location Services off on API 33
- **WHEN** an app on API 33 with discovery permissions granted calls `startDiscovery()` while Location Services is off
- **THEN** discovery starts normally

### Requirement: Library manifest declarations
The Android library manifest SHALL declare:
- `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`, each with `maxSdkVersion` 30
- `BLUETOOTH_SCAN` with the `neverForLocation` flag
- `BLUETOOTH_CONNECT`
- the `android.hardware.bluetooth` feature with `required="false"`

Apps SHALL be able to override the scan flag and the location limits using documented manifest overrides or the config plugin.

#### Scenario: Merged manifest on Android 12+ app
- **WHEN** an app that declares no Bluetooth permissions itself includes the library
- **THEN** on API 31 and later the merged manifest requests only `BLUETOOTH_SCAN` (flagged `neverForLocation`) and `BLUETOOTH_CONNECT` for Bluetooth work, with no location permission

#### Scenario: Install on device without Bluetooth
- **WHEN** an app that includes the library is published to Google Play
- **THEN** the library's manifest alone does not exclude devices without Bluetooth hardware

#### Scenario: App needs location from scans
- **WHEN** an app follows the documented override to remove `neverForLocation`
- **THEN** the merged manifest declares `BLUETOOTH_SCAN` without that flag, and the library's behavior is otherwise unchanged
