# Spec Delta

## Purpose

Defines which React Native, Android and iOS versions the library supports. Also defines how an app finds out at runtime what the current platform can do, and how unsupported or unlinked situations fail.

## ADDED Requirements

### Requirement: Supported React Native versions
The library SHALL support React Native 0.82 and every later release up to the latest at release time, using the new architecture only. The package SHALL declare a `react-native` peer dependency of `>=0.82`. Each release SHALL be verified by CI against React Native 0.82 and the latest React Native release.

#### Scenario: Install into a supported app
- **WHEN** the package is installed into an app on React Native 0.82 or later and the app is rebuilt
- **THEN** every public API behaves as specified, with no extra configuration

#### Scenario: Install into an unsupported app
- **WHEN** the package is installed into an app on React Native 0.81 or earlier
- **THEN** the package manager reports the `react-native >=0.82` peer dependency mismatch
- **AND** the documentation states that such apps must stay on v1.x of the `react-native-bluetooth-classic` package

### Requirement: Supported Android versions
The Android library SHALL declare `minSdkVersion` 24 (Android 7.0). It SHALL behave as specified on every Android release from API 24 through API 37. Where the specs describe behavior that varies by OS release, they name the API band.

#### Scenario: App below the Android floor
- **WHEN** an app with `minSdkVersion` lower than 24 includes the library
- **THEN** the Android build fails during manifest merging with a message that names the library's minimum SDK of 24

#### Scenario: Oldest and newest supported Android
- **WHEN** an app runs on API 24 or on API 37
- **THEN** discovery, pairing, connection and data transfer behave as specified for that API band

### Requirement: Supported iOS versions
The iOS library SHALL require iOS 15.1 or later. It SHALL behave as specified on every iOS release from 15.1 through iOS 27, and SHALL build with Xcode 16.1 or later.

#### Scenario: App below the iOS floor
- **WHEN** an app whose deployment target is lower than iOS 15.1 runs `pod install`
- **THEN** CocoaPods reports that the library requires iOS 15.1

#### Scenario: Newest supported iOS
- **WHEN** an app runs on iOS 27 with a connected MFi accessory
- **THEN** accessory listing, connection and data transfer behave as specified

### Requirement: Android build compatibility
The Android library SHALL compile against SDK 36 by default and SHALL use the host app's `compileSdkVersion` when one is defined. It SHALL build with Android Gradle Plugin 8.x and 9.x and Kotlin 2.x, and SHALL NOT require host apps to apply extra Gradle plugins or repositories.

#### Scenario: Host overrides compileSdk
- **WHEN** the host app defines `compileSdkVersion = 37` in its root project
- **THEN** the library compiles against SDK 37

#### Scenario: AGP 9 host
- **WHEN** the host app uses Android Gradle Plugin 9 (the default in React Native 0.87 and later)
- **THEN** the library builds without warnings that require host changes

### Requirement: Runtime capability flags
The library SHALL expose a synchronous `getCapabilities()` that returns the platform, the OS version and boolean flags: `discovery`, `pairing`, `server`, `adapterState`, `requestEnable`, `bondLossEvents`, `accessoryPicker`. On iOS it SHALL also return `declaredProtocols`, the protocol strings declared in Info.plist. The flags SHALL match what the APIs actually do.

#### Scenario: Capabilities on Android
- **WHEN** an app calls `getCapabilities()` on Android
- **THEN** it returns `platform: 'android'` and the API level
- **AND** `discovery`, `pairing`, `server`, `adapterState` and `requestEnable` are `true`, `accessoryPicker` is `false`, and `bondLossEvents` is `true` only on API 36 and later

#### Scenario: Capabilities on iOS
- **WHEN** an app calls `getCapabilities()` on iOS
- **THEN** it returns `platform: 'ios'` and the OS version
- **AND** `accessoryPicker` is `true`, and `discovery`, `pairing`, `server`, `adapterState`, `requestEnable` and `bondLossEvents` are `false`
- **AND** `declaredProtocols` lists the `UISupportedExternalAccessoryProtocols` entries in Info.plist order, or is empty if the key is missing

### Requirement: Unsupported operations fail explicitly
An operation that the current platform or OS release cannot perform SHALL fail with `UNSUPPORTED_ON_PLATFORM`. Asynchronous APIs SHALL reject; subscription APIs SHALL throw when called. No operation SHALL silently resolve, silently do nothing, or return a placeholder value.

#### Scenario: Android-only API called on iOS
- **WHEN** an app calls `startDiscovery()`, `pair()` or `accept()` on iOS
- **THEN** the returned promise rejects with `UNSUPPORTED_ON_PLATFORM`

#### Scenario: iOS-only API called on Android
- **WHEN** an app calls `showAccessoryPicker()` or `getConnectedAccessories()` on Android
- **THEN** the returned promise rejects with `UNSUPPORTED_ON_PLATFORM`

#### Scenario: Subscribing to an unsupported event
- **WHEN** an app calls `onAdapterStateChange(listener)` on iOS
- **THEN** the call throws a `BluetoothClassicError` with code `UNSUPPORTED_ON_PLATFORM`

### Requirement: Missing native module is reported clearly
If the native module is not registered, for example because the app was not rebuilt after installation or because it is running in Expo Go, importing the package SHALL NOT throw. The first API call SHALL fail with `MODULE_NOT_LINKED` and a message explaining how to rebuild.

#### Scenario: App not rebuilt after install
- **WHEN** an app imports the package and calls `getBondedDevices()` before rebuilding its native project
- **THEN** the promise rejects with `MODULE_NOT_LINKED`, and the message tells the developer to rebuild the app (or use a development build with Expo)

#### Scenario: Synchronous call without native module
- **WHEN** an app calls `getCapabilities()` without the native module registered
- **THEN** the call throws a `BluetoothClassicError` with code `MODULE_NOT_LINKED`

### Requirement: Unsupported host platforms
On any React Native platform other than Android and iOS, importing the package SHALL NOT throw. Every asynchronous API SHALL reject with `UNSUPPORTED_ON_PLATFORM`, and `getCapabilities()` SHALL report every flag as `false`.

#### Scenario: Web or Windows build
- **WHEN** a web or Windows build imports the package and calls `connect()`
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`
