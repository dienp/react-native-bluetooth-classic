# Tasks

Groups 4–6 (Android) and group 7 (iOS) can run in parallel once groups 1–3 have landed. Each group lands as its own pull request.

## 1. Repository reset and tooling

- [x] 1.1 Create and push a `1.x` branch from the current `main` (`1.73.0-rc.17`). Verify `git ls-remote origin 1.x` returns the commit.
- [ ] 1.2 Set up publishing under the `@dynlabs` npm scope: org membership for the release maintainers and an automation token for `release-it` (maintainer action). v1 keeps its own name, `react-native-bluetooth-classic`. Verify `npm access list packages @dynlabs` includes `@dynlabs/react-native-bluetooth-classic` after the first prerelease.
- [x] 1.3 Delete the v1 implementation:
  - `src/`, `__tests__/`, `android/src/`, `ios/` and `windows/`
  - `ios/RNBluetoothClassic.xcodeproj`, the Eclipse files and the Gatsby `docs/` site
  - `.npmignore`, `ttypescript`, `ts-auto-mock` and the `buffer` dependency

  Verify `git ls-files` lists none of them.
- [x] 1.4 Scaffold the JS package with react-native-builder-bob:
  - `package.json`: `exports` map (`source`, `react-native`, `types`, `default`, plus `./jest` and `./app.plugin.js`), `peerDependencies` `react-native >=0.82` and `react`, `sideEffects: false`
  - strict `tsconfig`, ESLint, Prettier, and Jest with the React Native preset

  Verify `npm run typecheck && npm run lint && npm test` pass on the empty skeleton.
- [x] 1.5 Scaffold the Android library:
  - Kotlin, new DSL, `namespace kjd.reactnative.bluetooth`
  - root-project SDK lookups with defaults compileSdk 36, minSdk 24, targetSdk 36; JVM 17; the `com.facebook.react` plugin
  - the manifest declarations from the `permissions` spec

  Verify the example app's merged manifest (`./gradlew :app:processDebugMainManifest`) contains exactly those entries.
- [x] 1.6 Scaffold the iOS pod: `install_modules_dependencies(s)`, `min_ios_version_supported`, `s.frameworks = 'ExternalAccessory'`, `swift_version '5.9'`. Verify `pod install` and an `xcodebuild` of the example succeed.
- [x] 1.7 Create `example/` on the latest React Native, plus `scripts/ci/build-test-app.sh <version> <platform>`, which builds a freshly generated app at that React Native version (0.82.1 for the minimum lane) against the packed library. Verify the example and the RN 0.82 test app build for Android and iOS in CI.
- [x] 1.8 Replace `.github/workflows/*` with PR CI. Verify every job is green on the scaffold PR. The jobs are:
  - lint, typecheck, Jest, and `openspec validate --strict`
  - Android unit tests and an example build on the RN 0.82 and latest lanes
  - `pod install` and an example `xcodebuild` on the RN 0.82 and latest lanes
- [x] 1.9 Configure `release-it`: prereleases publish to the `next` dist-tag, GA to `latest`, and tags are `v`-prefixed. Verify `npx release-it --dry-run --preRelease=rc` prints `next`.
- [ ] 1.10 Rewrite `.github/ISSUE_TEMPLATE/bug_report.md` to ask for:
  - React Native version, OS and API level, device model
  - Expo yes/no, and the declared iOS protocols
  - the error `code`, `nativeMessage`, and logs at `setLogLevel('debug')`

  Verify the template renders on GitHub's new-issue page.

## 2. Error model and JS contract

- [x] 2.1 Add `errors/errors.json` as the single source of error codes, and a generator that emits `src/errors/ErrorCode.ts`, `android/.../ErrorCode.kt`, `ios/RNBCErrorCode.h` (plus `ErrorCode.swift` once the Swift core lands in group 7) and the tables in `docs/errors.md`. Add a CI drift check. Verify regeneration is a no-op and that a hand edit makes the check fail.
- [x] 2.2 Implement `BluetoothClassicError`, the `ErrorCode` value export, `isBluetoothClassicError(value, code?)`, `toJSON()`, and the `toBluetoothClassicError()` normalizer. Verify with Jest tests that cover every `error-model` scenario that JS can observe, including unknown codes becoming `UNKNOWN` with native fields preserved.
- [x] 2.3 Write the codegen spec `src/specs/NativeBluetoothClassic.ts` (methods and `CodegenTypes.EventEmitter` events per design D3/D4) and its `codegenConfig`. Verify the generated Android and iOS spec files appear in the example build on both RN lanes.
- [x] 2.4 Implement module resolution with `TurboModuleRegistry.get()`, the `MODULE_NOT_LINKED` proxy (async calls reject, sync calls throw), and the unsupported-host-platform behavior. Verify with Jest tests for the `platform-support` "Missing native module" and "Unsupported host platforms" scenarios.
- [x] 2.5 Implement strict option validation: unknown keys, types, ranges, and platform-scoped `android`/`ios` blocks. Every failure rejects `INVALID_ARGUMENT` and names the key. Verify with Jest tests, including the v1-style `DELIMITER` key and `timeoutMs: -1`.
- [x] 2.6 Implement the typed subscription layer: idempotent `remove()`, listeners isolated from each other, a throwing listener does not stop others, and unsupported events throw `UNSUPPORTED_ON_PLATFORM`. Verify with Jest tests for the `native-module-contract` subscription scenarios.
- [x] 2.7 Build `src/__fakes__/FakeNativeModule.ts` with platform emulation (Android API 24, 29, 30, 31, 36, 37, and iOS) and controllable devices (design D14). Verify the Jest suite runs every facade test in each emulated platform mode.
- [x] 2.8 Implement the facade functions for adapter, permissions, discovery, pairing and accessories on top of the spec and the normalizer, including the async-never-throws guard (`connect` and `accept` land with the `Connection` wrapper in 3.2). Verify with Jest tests, against the fake, for every spec scenario that JS can observe (unsupported paths, validation, settle-once).
- [x] 2.9 Write `README.md` (install, support matrix, quick start), `docs/api.md`, `docs/errors.md` (troubleshooting by code) and `docs/migration-v1-to-v2.md` (the design's mapping table). Verify the code samples in `docs/examples/*.ts` type-check in CI.

## 3. JS data path

- [x] 3.1 Implement streaming codecs (utf8, ascii, latin1) and the hex and base64 helpers, with no `buffer` dependency, and add a lint rule that bans imports of `buffer`. Verify with Jest tests covering split UTF-8, the 0xFF byte becoming U+FFFD, and round-trips; also verify that `npm ls buffer` is empty.
- [x] 3.2 Implement `connect()`, `accept()`, `cancelAccept()`, `getConnections()` and `getConnection()`, and the `Connection` wrapper: state cache, `onStateChange`, `AbortSignal` cancellation, and `onDisconnected` with exactly-once delivery and replay for late listeners. Verify with Jest tests for the `connection-lifecycle` scenarios that JS can observe against the fake.
- [x] 3.3 Implement the inbound stream:
  - a `seq` continuity check
  - a backlog held until the first consumer
  - fan-out to multiple consumers
  - `maxBufferBytes` enforcement that leads to a native `closeWithError` with `BUFFER_OVERFLOW`

  Verify with Jest tests for the `data-transfer` backlog and bounded-buffering scenarios.
- [x] 3.4 Implement the `Framer` interface and the `delimiter`, `fixedLength` and `raw` framers. Verify with property-based Jest tests (fast-check) that random re-chunking of the same input always yields identical frames.
- [x] 3.5 Implement readers:
  - `read({ timeoutMs, signal })`, rejecting with `READ_TIMEOUT`
  - `for await` iteration rules, including the trailing partial frame on a `'remote'` close
  - `maxFrameBytes`

  Verify with Jest tests for every "Reading frames" and "Framed readers" scenario.
- [x] 3.6 Implement `connection.write()` input handling: encodings, the empty-payload no-op and `INVALID_ARGUMENT`. Verify with Jest tests against the fake that unawaited writes reach the fake in call order.
- [x] 3.7 Write `docs/data.md` covering writes, readers, framers, encodings, a custom framer example and buffer limits. Verify its examples type-check in CI.

## 4. Android foundation

- [x] 4.1 Implement `BluetoothClassicModule` (Kotlin, the generated spec subclass), the per-entry-point guard, and the `ErrorMapper` built on the generated `ErrorCode.kt`. Verify with JVM tests that each mapped exception type produces its expected code and that no exception escapes an entry point.
- [x] 4.2 Implement the synchronous `getCapabilities()` (API level, flags, `bondLossEvents` only on API 36+), `setLogLevel`, and a logger that redacts payloads below `debug`. Verify with Robolectric tests at API 35 and 36, plus a test asserting that no payload is logged at the default level.
- [x] 4.3 Implement `AdapterMonitor`:
  - `getAdapterState()`
  - the application-context state receiver, registered with `ContextCompat.registerReceiver(..., RECEIVER_EXPORTED)`
  - `onAdapterStateChange` events
  - the precondition helper that rejects `BLUETOOTH_UNAVAILABLE` or `BLUETOOTH_DISABLED`

  Verify with Robolectric tests for the `adapter-state` scenarios, including a transition while the host activity is paused.
- [x] 4.4 Implement `PermissionGate`:
  - scope-to-permission mapping per API band
  - `checkPermissions`, and `requestPermissions` with `canAskAgain`
  - the Location Services check on API 24–30

  Verify with Robolectric tests at API 24, 28, 29, 30, 31, 33 and 36 for every `permissions` scenario.
- [x] 4.5 Implement:
  - `requestEnable()`: shared pending result, `USER_REJECTED`, `ACTIVITY_UNAVAILABLE`, `PERMISSION_DENIED` on 31+, and the 15 s wait for `STATE_ON`
  - `openSettings()`
  - `setAdapterName()`: 248-byte limit and empty-name check

  Verify with Robolectric tests for each scenario.
- [x] 4.6 Implement the `invalidate()` teardown skeleton: unregister receivers and cancel pending operations. Verify with a Robolectric test that no receiver remains registered after invalidation.
- [x] 4.7 Write `docs/android.md` covering:
  - permissions per API band and the manifest overrides (`tools:remove` for `maxSdkVersion` and `neverForLocation`)
  - the Location Services trap
  - `requestEnable`

  Verify a CI script asserts that the example's merged manifest matches the documented entries.

## 5. Android discovery and pairing

- [ ] 5.1 Implement Android device mapping: upper-case `id`/`address`, `bondState`, `type`, `deviceClass`, `rssi` only from discovery, and address validation that rejects `INVALID_ARGUMENT`. Verify with JVM tests and Jest (frozen objects) for the "Android device objects" scenarios.
- [ ] 5.2 Implement `getBondedDevices()` with permission and adapter preconditions. Verify with Robolectric tests, including `PERMISSION_DENIED` on API 31+ and `BLUETOOTH_DISABLED`.
- [ ] 5.3 Implement `DiscoverySession`:
  - start, de-duplication by address, `onDeviceFound`
  - `timeoutMs`, `cancelDiscovery()`
  - finish on `ACTION_DISCOVERY_FINISHED`
  - adapter off rejects `BLUETOOTH_DISABLED`; a refused start rejects `DISCOVERY_FAILED`; a second start rejects `DISCOVERY_ALREADY_RUNNING`
  - no dependence on the host lifecycle

  Verify with Robolectric tests for every `device-discovery` Android scenario, including the app being paused mid-session.
- [ ] 5.4 Implement `pair()`:
  - the receiver is registered before `createBond`
  - the address filter
  - `BONDED` and `NONE` handling
  - the timeout with `cancelBondProcess`
  - `PAIRING_IN_PROGRESS`
  - immediate `PAIRING_FAILED` when `createBond` returns false

  Verify with Robolectric tests for every `device-pairing` "Pair" scenario.
- [ ] 5.5 Implement `unpair()`: public `removeBond()` on API 36+, and reflection on API 24–35 that rejects `UNSUPPORTED_ON_PLATFORM` when blocked. Verify with Robolectric tests at API 33 and 36.
- [ ] 5.6 Implement `onBondStateChange` and `onBondLost` (API 36+, using `ACTION_KEY_MISSING`). Verify with Robolectric tests at API 35 and 36.
- [ ] 5.7 Add the discovery and pairing sections to `docs/android.md`, and the discovery and pairing screens to the example app. Verify the example builds on both RN lanes and the screens show results from the fake in a Detox-free smoke test (Jest render).

## 6. Android connections and data

- [ ] 6.1 Introduce the `RfcommTransport` interface, a `BluetoothSocket` implementation, and a fake backed by piped streams. Verify with JVM tests that the fake supports peer close, `-1` reads, I/O errors and slow writes.
- [ ] 6.2 Implement `ConnectionManager`:
  - `connectionId` generation and the target index, rejecting `ALREADY_CONNECTED`/`ALREADY_CONNECTING` with `connectionId`
  - `compareAndSet` state transitions
  - the stale-callback guard

  Verify with JVM tests, including "stale events never affect newer connections".
- [ ] 6.3 Implement `connect()`:
  - cancel discovery first
  - `secure`/`insecure` transport and `uuid`
  - `timeoutMs`, enforced by closing the socket
  - `AbortSignal` cancellation, rejecting `CONNECT_CANCELLED`
  - the opt-in `fallbackChannel`, which closes the first socket and reports both reasons

  Verify with JVM tests for every "Connect as a client on Android" and "fallback" scenario.
- [ ] 6.4 Implement the read loop:
  - `-1` means a `'remote'` close
  - an `IOException` means `'remote'`, or `'error'`/`BLUETOOTH_DISABLED` when the adapter is off
  - a coalescing batcher (16 KiB or 16 ms) emits base64 data with `seq`

  Verify with JVM tests, including the API 37 `-1` path and a latency assertion of 50 ms or less.
- [ ] 6.5 Implement the per-connection write executor:
  - ordered, chunked writes that resolve after a full write
  - `WRITE_FAILED` ends the connection
  - `WRITE_TIMEOUT` closes the socket and fails queued writes with `NOT_CONNECTED`

  Verify with JVM tests for every `data-transfer` write scenario.
- [ ] 6.6 Implement `disconnect()`: drain queued writes up to `timeoutMs`, then close; idempotent; remaining writes reject `NOT_CONNECTED`. Verify with JVM tests for "Write then disconnect immediately" and "Disconnect twice".
- [ ] 6.7 Implement `accept()` and `cancelAccept()`: `ACCEPT_TIMEOUT`, `ACCEPT_ALREADY_RUNNING`, `ACCEPT_FAILED`, `ACCEPT_CANCELLED`, and closing the listening socket on settle. Verify with JVM tests that include a later `accept()` succeeding after a cancel.
- [ ] 6.8 Handle global terminations:
  - adapter off ends every connection with `'error'`/`BLUETOOTH_DISABLED`, and rejects pending connect and accept calls
  - `invalidate()` closes every socket and thread

  Verify with Robolectric tests, including reconnecting after a simulated reload.
- [ ] 6.9 Add to `docs/android.md`:
  - connect options and `fallbackChannel`
  - troubleshooting `CONNECT_FAILED` by `nativeMessage`
  - write-then-disconnect and background behavior

  Add the Android connect and echo screens to the example. Verify the echo test against an SPP loopback device and record the result in the PR.

## 7. iOS

- [ ] 7.1 Implement `RNBluetoothClassic.mm`, subclassing the generated `SpecBase` and forwarding to the Swift `BluetoothClassicCore`, with an entry-point guard and an `ErrorMapper` built on the generated `ErrorCode.swift`. Verify with XCTest that mapped errors produce their codes and that no Objective-C or Swift error escapes.
- [ ] 7.2 Implement `getCapabilities()` (with `declaredProtocols` read safely from Info.plist) and `setLogLevel`. Android-only APIs reject `UNSUPPORTED_ON_PLATFORM`, and subscribing to their events throws. Verify with XCTest, and with an example build whose Info.plist has no protocol key, that the app starts without crashing.
- [ ] 7.3 Implement `AccessoryRegistry`: `getConnectedAccessories()` filtered by declared protocols, accessory objects, and `onAccessoryConnected`/`onAccessoryDisconnected`. Verify with XCTest using an injected accessory-manager adapter.
- [ ] 7.4 Implement `showAccessoryPicker()`: a cancel rejects `USER_REJECTED`, not-found rejects `DEVICE_NOT_FOUND`, and any other failure rejects `UNKNOWN`. Verify with XCTest using an injected picker.
- [ ] 7.5 Introduce the `AccessoryTransport` protocol, an `EASession` implementation on a dedicated I/O thread run loop, and a fake built from bound stream pairs. Verify with XCTest that all stream callbacks run on the I/O thread.
- [ ] 7.6 Implement `connect()`:
  - protocol selection
  - `PROTOCOL_NOT_DECLARED`, `PROTOCOL_NOT_SUPPORTED`, `ACCESSORY_NOT_CONNECTED` and `SESSION_OPEN_FAILED`
  - resolving only when both streams are open, with `CONNECT_TIMEOUT` and cancellation
  - `ALREADY_CONNECTED` per accessory and protocol

  Verify with XCTest for every "Connect to an accessory on iOS" scenario.
- [ ] 7.7 Implement the session data path:
  - a coalesced read path with `seq`
  - a write queue drained only on `hasSpaceAvailable`
  - `WRITE_FAILED` and `WRITE_TIMEOUT`
  - draining queued writes on disconnect
  - terminal events: end of stream or accessory disconnect means `'remote'`; a stream error means `'error'`/`CONNECTION_LOST`

  Verify with XCTest for the iOS `data-transfer` and terminal-event scenarios.
- [ ] 7.8 Implement `invalidate()` (close sessions, remove observers), weak delegates and resume-time terminal delivery. Verify with XCTest that the core deallocates after invalidation, and with a manual reload test on a device.
- [ ] 7.9 Implement `openSettings()` to open the app settings URL. Verify manually on an iOS 15 simulator and on an iOS 27 simulator.
- [ ] 7.10 Write `docs/ios.md`:
  - the MFi requirement and Info.plist protocols
  - the `external-accessory` background mode
  - why there is no discovery or pairing
  - accessory `id` changing on reconnect

  Add the iOS picker, accessory and echo screens to the example. Verify the echo test against an MFi accessory and record the result in the PR.

## 8. Expo config plugin and Jest mock

- [ ] 8.1 Implement the plugin in `plugin/src`:
  - `withAndroidManifest` with the `neverForLocation` option
  - `withInfoPlist` with `protocols` and `iosBackgroundMode`
  - option validation and idempotent merges

  Verify with Jest fixture tests that running the plugin twice produces identical output, and that invalid options fail with the option named.
- [ ] 8.2 Add the `app.plugin.js` entry and declare `@expo/config-plugins` as an optional peer dependency. Verify with a CI job that runs `npx expo prebuild` on a fixture Expo app and asserts the manifest and Info.plist entries.
- [ ] 8.3 Publish the `@dynlabs/react-native-bluetooth-classic/jest` entry backed by `FakeNativeModule`, with control helpers (fake devices, push data, end connection, fail next call, read written bytes, platform emulation). Verify with type tests that the mock's types equal the real API, and with a consumer test in `example/__tests__`.
- [ ] 8.4 Write `docs/expo.md` and `docs/testing.md`. Verify the sample test in `docs/testing.md` runs in CI.

## 9. Integration and release

- [ ] 9.1 Write `docs/hardware-validation.md` with the device matrix (Android 7, 10, 12, 14, 16, 17; iOS 15, 18, 26, 27; an SPP printer or scanner; an MFi accessory), and add a traceability table that maps every spec scenario to an automated test or a checklist item. Verify that no scenario is unmapped.
- [ ] 9.2 Add a throughput and latency benchmark to the example app and record results for an SPP device. Verify that the latency budget of 50 ms or less holds, and that throughput does not regress against v1 on the same device.
- [ ] 9.3 Publish `2.0.0-rc.1` to `next`. Verify that installing it into fresh React Native 0.82 and latest apps builds and passes the echo test on both platforms.
- [ ] 9.4 Run the full hardware matrix on the release candidate. Verify every checklist item passes, or that each failure has a tracked fix before GA.

## Workflow follow-up

- Release `2.0.0` to `latest` after 9.4 passes, then run `openspec archive rework-v2-new-architecture` to promote the specs to `openspec/specs/`.
- Resolve the design's open questions in follow-up changes: the docs site generator, the v1 support window, and Swift Package Manager distribution.
