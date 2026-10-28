# Proposal

## Why

v1 (1.73.x) is a legacy-bridge module whose behavior is hard to predict. It has no typed error contract, and the same call behaves differently on each platform. Several promises can hang forever and several paths crash the app. React Native 0.82+ runs only the new architecture, and Google Play now requires apps to target API 36. Patching v1 further will not make it reliable, so we rebuild it as **v2.0.0**: TurboModule-only, with a small, typed and spec-defined surface. It is published as a new npm package, **`@dynlabs/react-native-bluetooth-classic`**, and the v1 package `react-native-bluetooth-classic` stays as it is.

Representative v1 defects (from a code audit of `src/`, `android/` and `ios/`):

- **Errors are not a contract.**
  - Android rejects most failures with `EUNSPECIFIED`, and the message is `cause.toString()` or null.
  - iOS uses a different, lowercase set of codes.
  - `BluetoothError` is exported as a type only, so it is undefined at runtime.
  - Unsupported methods throw synchronously in some places and reject in others.
- **Promises never settle.**
  - `accept()` never settles after `cancelAccept()`, because the acceptor busy-loops on a closed socket.
  - `startDiscovery()` never settles if the app pauses, or on Android 10–11 without location permission.
  - With concurrent `requestBluetoothEnabled()` calls, the first promise is orphaned.
  - `pairDevice()` resolves on *any* device's bond change, so a cancelled pairing reports success.
- **The app crashes.**
  - Android 12+ never checks `BLUETOOTH_CONNECT`, so `SecurityException` can surface on the native-modules, main and read threads.
  - Check-then-act on the connection maps throws a null-pointer exception when a call races a disconnect.
  - Invalid addresses, bad base64 and `accept(null)` all crash.
  - iOS crashes at startup when `UISupportedExternalAccessoryProtocols` is missing, and on force-casts of options.
- **Events are unreliable.**
  - `DEVICE_CONNECTED` and `DEVICE_DISCONNECTED` mean different things on each platform.
  - Socket-level disconnects go to an event that JS cannot subscribe to.
  - iOS stream errors are only logged.
  - Android unregisters its receivers on `onHostPause`, so events are lost while system dialogs are open.
  - Discovery reports each device twice.
  - Listener counting is broken on both platforms.
- **Data handling is lossy.**
  - Payloads are strings only, and decoding each chunk separately corrupts UTF-8 characters split across reads.
  - Delimiter trimming differs between platforms.
  - `read()` and `onDataReceived` drain the same buffer.
  - Android binary connections drop at 1024 bytes.
  - The `readSize` and `readTimeout` options are silently ignored.
  - iOS writes can drop bytes and still resolve `true`.
- **Lifecycle and build are fragile.**
  - There is no `invalidate()`, so sockets and sessions survive a JS reload.
  - A stale disconnect can remove a newer connection to the same address.
  - Every payload is logged.
  - The podspec still targets iOS 9 / Swift 4.1, and the Android build uses AGP 3.4.3 with minSdk 16.
  - CI is manual-only and misconfigured, and release candidates publish to the `latest` npm tag.

## What Changes

- **BREAKING** Support only React Native ≥ 0.82 (new architecture, bridgeless). The module is a codegen TurboModule. There is no `NativeModules` or interop-layer path.
- **BREAKING** Platform floors are Android API 24 (tested through API 37) and iOS 15.1 (tested through iOS 27). Windows support is removed.
- **BREAKING** New JS API.
  - Stateless functions and immutable device objects replace v1's stateful `BluetoothDevice` objects.
  - A `Connection` handle is keyed by an opaque `connectionId` and replaces calls keyed by address.
  - Options are typed and validated, with camelCase keys only.
- **BREAKING** One typed error model.
  - `BluetoothClassicError`, with a closed `ErrorCode` union, is used on both platforms.
  - Every promise settles exactly once.
  - Unsupported operations reject with `UNSUPPORTED_ON_PLATFORM`.
- **BREAKING** Binary-first data.
  - `write()` accepts `Uint8Array` (or a string plus an encoding).
  - Inbound bytes arrive once, through a single push stream.
  - Framing (delimiter, fixed length, custom) and text decoding move to JS, so they behave the same on both platforms.
  - `read()`, `available()` and `clear()` are removed, and so is the `buffer` dependency.
- **BREAKING** The native `RNBluetoothClassicPackage.Builder` / `withConnectionFactory` extension point is removed. It is replaced by a JS `Framer` interface.
- **BREAKING** New event set: adapter state, discovery, bond state, connection state, data, and accessory connect/disconnect. Each connection emits exactly one terminal `disconnected` event, with a reason.
- New capability discovery (`getCapabilities()`) and permission helpers per Android API band.
- An Expo config plugin and a Jest mock for consumers.
- A new build and release pipeline: builder-bob packaging, an example app, PR CI on RN 0.82 and the latest RN, and release candidates on the `next` dist-tag.
- **BREAKING** The package is renamed to `@dynlabs/react-native-bluetooth-classic` (published under the `@dynlabs` npm scope). Apps replace the dependency and their imports.
- v1 continues unchanged as `react-native-bluetooth-classic` on npm, maintained on the `1.x` branch. A v1 → v2 migration guide covers every v1 API and the package switch.

### Out of scope

- Bluetooth Low Energy, including BLE serial emulation on iOS.
- Windows, macOS, web and Expo Go.
- Non-MFi accessories on iOS (the OS does not allow them).
- Audio profiles (A2DP, HFP) and any profile other than RFCOMM/SPP serial on Android.
- A v1 compatibility shim.
- Swift Package Manager distribution (RN support is experimental; follow-up change).

## Capabilities

### New Capabilities

- `platform-support`: supported RN, Android and iOS versions; runtime capability flags; how unsupported and unlinked cases fail.
- `native-module-contract`: the codegen TurboModule spec, typed native events, payload conventions, and module teardown.
- `error-model`: `BluetoothClassicError`, the `ErrorCode` set, normalization of native failures, and the settle-exactly-once guarantees.
- `adapter-state`: adapter availability and state, state-change events, requesting enable, opening settings, and setting the adapter name.
- `permissions`: checking and requesting the runtime permissions for discovery, connect and server use, per Android API band; manifest declarations.
- `device-discovery`: bonded devices, discovery sessions, and on iOS, connected accessories and the accessory picker.
- `device-pairing`: pairing, unpairing and bond-state/bond-loss events on Android.
- `connection-lifecycle`: client connect, server accept, cancellation, timeouts, the connection state machine and the terminal disconnect guarantee.
- `data-transfer`: ordered binary writes, the inbound byte stream, buffering limits, framers and text codecs.
- `expo-config-plugin`: config plugin for Android permissions and iOS Info.plist keys.
- `testing-support`: the Jest mock and a fake device for consumers; example app for hardware validation.

### Modified Capabilities

None. There are no existing specs.

## Impact

- **Code**:
  - Replaced: `src/`, `android/` (Java → Kotlin), `ios/` (Swift + ObjC++ shim) and `__tests__/`.
  - Deleted: `windows/`, the stale `ios/RNBluetoothClassic.xcodeproj` and the committed Eclipse files.
  - Added: `example/`, `app.plugin.js`, `jest/` (mock entry) and `src/specs/NativeBluetoothClassic.ts`.
- **Package**:
  - Published as `@dynlabs/react-native-bluetooth-classic` (public, `@dynlabs` scope); the iOS pod is `dynlabs-react-native-bluetooth-classic`.
  - `package.json` gains `codegenConfig` and an `exports` map, and peerDependencies become `react-native >= 0.82`.
  - The `buffer` dependency is removed.
  - The podspec uses `install_modules_dependencies` and iOS 15.1. Android uses Kotlin, the new DSL and `minSdk 24`.
- **Consumers**: every app must migrate (guide provided), including switching the dependency from `react-native-bluetooth-classic` to `@dynlabs/react-native-bluetooth-classic`. Apps on RN < 0.82, Android < 7.0, iOS < 15.1 or Windows stay on v1.
- **Docs, CI and release**: the docs are rewritten (API, per-API-band platform guide, troubleshooting by error code, migration). The workflows and issue templates are replaced. Release candidates publish under `next`.
