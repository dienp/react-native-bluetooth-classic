# Spec Delta

## Purpose

Lets Expo apps that use development builds configure the native permissions, Info.plist keys and background modes the library needs. Apps set this through the package's own config plugin, without editing native files by hand.

## ADDED Requirements

### Requirement: Plugin registration
The package SHALL ship an Expo config plugin that is resolved when `'@dynlabs/react-native-bluetooth-classic'` appears in the app config's `plugins` list. It SHALL work with `expo prebuild` and with EAS Build. The documentation SHALL state that Expo Go is not supported. In Expo Go, API calls fail as specified for a missing native module.

#### Scenario: Prebuild with defaults
- **WHEN** an Expo app adds the plugin without options and runs `expo prebuild`
- **THEN** the generated Android manifest and iOS Info.plist contain the default entries this spec defines

#### Scenario: Running in Expo Go
- **WHEN** an app using the package is opened in Expo Go and calls `connect()`
- **THEN** the promise rejects with `MODULE_NOT_LINKED`

### Requirement: Android permission configuration
The plugin SHALL ensure that the generated Android manifest contains the permissions the permissions capability requires. A `neverForLocation` option (default `true`) SHALL control whether `BLUETOOTH_SCAN` carries the `neverForLocation` flag. When the option is `false`, location permissions SHALL also be declared without a maximum SDK, so apps can derive location from scans.

#### Scenario: Default permissions
- **WHEN** the plugin runs with default options
- **THEN** the manifest declares `BLUETOOTH_SCAN` with `neverForLocation`, `BLUETOOTH_CONNECT`, and the legacy permissions limited to API 30

#### Scenario: Location derived from scans
- **WHEN** the plugin runs with `neverForLocation: false`
- **THEN** `BLUETOOTH_SCAN` has no `neverForLocation` flag, and `ACCESS_FINE_LOCATION` has no `maxSdkVersion`

### Requirement: iOS accessory protocol configuration
The plugin SHALL take a `protocols` option (an array of strings) and write it to `UISupportedExternalAccessoryProtocols` in Info.plist. It SHALL preserve order, merge with existing entries and remove duplicates. If no protocols are configured, prebuild SHALL print a warning that iOS connections will fail with `PROTOCOL_NOT_DECLARED`.

#### Scenario: Protocols configured
- **WHEN** the plugin runs with `protocols: ['com.acme.serial', 'com.acme.update']`
- **THEN** Info.plist lists exactly those protocols, in that order, plus any entries that already existed

#### Scenario: No protocols configured
- **WHEN** the plugin runs without `protocols`
- **THEN** prebuild prints a warning that names the `protocols` option

### Requirement: iOS background mode option
The plugin SHALL take an `iosBackgroundMode` boolean option (default `false`). When it is `true`, `external-accessory` SHALL be added to `UIBackgroundModes` without removing other modes.

#### Scenario: Background mode enabled
- **WHEN** the plugin runs with `iosBackgroundMode: true` on an app that already declares `audio`
- **THEN** `UIBackgroundModes` contains both `audio` and `external-accessory`

### Requirement: Idempotent and validated
Running the plugin more than once SHALL produce the same native configuration as running it once. Invalid options SHALL fail prebuild with an error that names the option and the expected type.

#### Scenario: Prebuild twice
- **WHEN** `expo prebuild` runs twice with the same configuration
- **THEN** the manifest and Info.plist contain no duplicate entries

#### Scenario: Wrong option type
- **WHEN** the plugin runs with `protocols: 'com.acme.serial'` (a string instead of an array)
- **THEN** prebuild fails with an error that names `protocols` and says it must be an array of strings
