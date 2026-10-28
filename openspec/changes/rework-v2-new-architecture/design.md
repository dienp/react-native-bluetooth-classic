# Design

## Context

See `proposal.md` → Why for the v1 defects, and `specs/` for the required behavior. Facts and constraints that shape the design:

- **v1 code.** v1 is about 6,400 lines across Java (`android/src/main/java/kjd/reactnative/bluetooth/**`), Swift (`ios/**`) and TypeScript (`src/**`). It was written against the legacy bridge. None of the code is reused as-is, but v1 still documents the OS behaviors we have to handle: RFCOMM connect quirks, ExternalAccessory (EA) stream handling and the Android permission bands.
- **React Native floor.** React Native ≥ 0.82 always runs the new architecture, bridgeless. TurboModule codegen supports typed `CodegenTypes.EventEmitter` events. It does **not** support `ArrayBuffer` arguments for module methods.
- **Android.**
  - Socket `connect()`, `accept()` and `read()` block, and can only be unblocked by closing the socket.
  - From API 31, every call that touches a device needs `BLUETOOTH_CONNECT`.
  - On API 37, `read()` returns -1 on peer close instead of throwing.
- **iOS.**
  - EA works only with MFi accessories that are already connected to the OS.
  - Sessions are a pair of `NSStream`s. They need a run loop, or a dispatch queue that has the streams scheduled on it.
  - Only one session per accessory and protocol can be open at a time.
- **CI.** No Bluetooth hardware is available. Behavior is tested against fakes, and a manual hardware matrix gates releases.

## Goals / Non-Goals

**Goals:**
- One behavior contract on both platforms. Platform differences show up only as `getCapabilities()` flags and `UNSUPPORTED_ON_PLATFORM`.
- Every native entry point is crash-proof. Every async operation settles exactly once, and every connection has exactly one terminal event.
- Framing, decoding, validation and error normalization run in TypeScript, so they are identical on both platforms and unit-testable in Jest.
- Native layers stay thin and contain only transport and OS integration.
- An architecture that is testable with fakes at every layer (JS, Android, iOS).

**Non-Goals:**
- Raw throughput beyond what RFCOMM/SPP delivers in practice, a few hundred KB/s. We will not adopt JSI `ArrayBuffer` plumbing in v2.0.
- Making Android discoverable (`ACTION_REQUEST_DISCOVERABLE`), multi-client servers, or L2CAP sockets.
- Background reconnection or keep-alive policies. Apps own retry logic, and the library gives them precise error codes to drive it.
- Swift Package Manager distribution. React Native's SPM support is experimental; this is tracked as a follow-up change.

## Decisions

### D1. Codegen TurboModule, resolved lazily
- **Approach:**
  - A single spec, `src/specs/NativeBluetoothClassic.ts`, with `codegenConfig` (`name: RNBluetoothClassicSpec`, `type: modules`, `jsSrcsDir: src/specs`, `android.javaPackageName: kjd.reactnative.bluetooth`).
  - JS resolves the module with `TurboModuleRegistry.get()`, not `getEnforcing()`. When it is `null`, a proxy throws or rejects `MODULE_NOT_LINKED` on first use.
  - Events use `CodegenTypes.EventEmitter` properties.
  - The spec is internal. Apps import the typed facade in `src/index.ts`.
- **Alternatives considered:**
  - *Nitro Modules*: zero-copy `ArrayBuffer`, but it adds a C++ runtime dependency and build complexity for every consumer.
  - *Expo Modules API*: ties non-Expo apps to `expo-modules-core`.
  - *`getEnforcing()`*: throws at import time, which breaks apps that merely import the package (Expo Go, web).

### D2. React Native floor is 0.82
- **Approach:** This is the first release where the new architecture is guaranteed. There is no legacy-architecture detection or error path, and `CodegenTypes` is importable from the `react-native` root.
- **Alternatives considered:**
  - *0.76+*: wider reach, but the codegen import has to be a deep import that RN 0.87's strict TypeScript API flags, and the CI matrix gets bigger.
  - *0.80+*: needs a guard for apps that turned the new architecture off.

### D3. Public API shape: stateless functions plus `Connection` handles
- **Approach:**
  - Module-level async functions cover adapter, permission, discovery, pairing and accessory work.
  - `connect()` and `accept()` return a `Connection` object: a thin JS wrapper around an opaque `connectionId` that holds JS-side state (state cache, backlog, readers).
  - Device objects are frozen plain data.

  ```ts
  getCapabilities(): Capabilities
  setLogLevel(level: 'debug' | 'info' | 'warn' | 'error' | 'silent'): void
  getAdapterState(): Promise<AdapterState>
  requestEnable(): Promise<void>
  openSettings(): Promise<void>
  setAdapterName(name: string): Promise<void>
  checkPermissions(scope: PermissionScope): Promise<PermissionStatus>
  requestPermissions(scope: PermissionScope): Promise<PermissionRequestResult>
  getBondedDevices(): Promise<AndroidDevice[]>
  startDiscovery(o?: { timeoutMs?: number }): Promise<AndroidDevice[]>
  cancelDiscovery(): Promise<void>
  pair(address: string, o?: { timeoutMs?: number }): Promise<AndroidDevice>
  unpair(address: string): Promise<void>
  getConnectedAccessories(): Promise<IosAccessory[]>
  showAccessoryPicker(o?: { nameFilter?: string }): Promise<void>
  connect(deviceId: string, o?: ConnectOptions): Promise<Connection>
  accept(o?: AcceptOptions): Promise<Connection>
  cancelAccept(): Promise<void>
  getConnections(): Promise<Connection[]>
  getConnection(id: string): Promise<Connection | null>
  onAdapterStateChange / onDeviceFound / onBondStateChange / onBondLost /
  onAccessoryConnected / onAccessoryDisconnected (listener) => Subscription

  interface Connection {
    readonly id: string; readonly device: Device; readonly state: ConnectionState
    write(data: Uint8Array | string, o?: { encoding?: Encoding; timeoutMs?: number }): Promise<void>
    disconnect(o?: { timeoutMs?: number }): Promise<void>
    onData(l: (chunk: Uint8Array) => void): Subscription
    onStateChange(l: (e: ConnectionStateEvent) => void): Subscription
    onDisconnected(l: (e: DisconnectedEvent) => void): Subscription
    createReader<T>(o: { framer: Framer; encoding?: Encoding; maxFrameBytes?: number }): Reader<T>
  }
  ```

- **Alternatives considered:**
  - *v1-style stateful `BluetoothDevice` objects*: duplicate instances drift out of sync, and their meaning is ambiguous before and after a connection.
  - *Address-keyed functions only*: a stale callback can't be told apart from a new connection to the same address. That is exactly the v1 bug where an old disconnect removed a new connection.

### D4. Binary transport: base64 events, coalesced natively
- **Approach:**
  - Native read loops batch bytes and emit `onData({ connectionId, data: base64, seq })`. A batch is flushed when 16 KiB are pending, or 16 ms after its first byte arrived.
  - JS decodes the base64 with a built-in decoder (no `buffer` polyfill) and checks that `seq` is contiguous; a gap means a library bug and is logged at the `error` level.
  - Writes go the other way: JS encodes to base64, and native decodes and queues the bytes.
- **Alternatives considered:**
  - *Number arrays*: about 4–8× the bridge payload of base64.
  - *JSI `ArrayBuffer`*: not supported by module codegen, and needs hand-written C++ per platform.
  - *Strings decoded natively (v1)*: platform-specific charset behavior, and multi-byte characters corrupted at chunk boundaries.

### D5. One inbound stream; framing and decoding in JS
- **Approach:**
  - JS-side backlog: each JS `Connection` buffers bytes until its first consumer attaches. The limit is `maxBufferBytes` (default 1 MiB, enforced in JS). Overflow calls the native `closeWithError(connectionId, 'BUFFER_OVERFLOW')`, which produces the terminal event.
  - Readers: each one keeps its own framer state.
  - Framer interface: `push(chunk: Uint8Array): Uint8Array[]`, `flush(): Uint8Array[]` (called on a `'remote'` close) and `reset()`.
  - Text decoding: done by streaming decoders written in TypeScript (utf8, ascii, latin1). We don't rely on the runtime providing `TextDecoder`.
- **Alternatives considered:**
  - *Native framing (v1 "connection types")*: two implementations that diverge (v1 trimmed delimiters differently per platform), and extending it needs native code.
  - *A pull `read()` alongside events*: two consumers race for the same buffer (v1).

### D6. Error normalization in one place per layer
- **Native, one wrapper per entry point:**
  - Each native entry point runs inside a guard: Kotlin `runCatching`, Swift `do/catch`.
  - The guard rejects through a per-platform `ErrorMapper` as `reject(code, message, userInfo)`.
  - `userInfo` carries `nativeCode`, `nativeMessage`, `deviceId`, `connectionId` and `missingPermissions`.
  - Codes are drawn from a generated list that is shared with TypeScript: a single `errors.json` is the source, a build step emits `ErrorCode.ts`, `ErrorCode.kt` and `ErrorCode.swift`, and a CI check fails if they drift.
- **JS:** `toBluetoothClassicError(e)` builds the error class from the native rejection, and maps any unknown code to `UNKNOWN`.
- **Alternatives considered:**
  - *Hand-maintained code lists per platform*: this is how v1's three code sets drifted.

### D7. Android architecture (Kotlin, no coroutines)
- **Components:**
  - `BluetoothClassicModule`, the codegen spec subclass, delegates to these managers:
    - `AdapterMonitor`: state receiver, `requestEnable`.
    - `PermissionGate`: scope → permissions per API band; location-services check via `LocationManagerCompat`.
    - `DiscoverySession`.
    - `BondManager`.
    - `ConnectionManager`.
  - `ConnectionManager` owns one `RfcommConnection` per `connectionId`. Each `RfcommConnection` has a dedicated daemon read thread, a single-thread write executor and an `AtomicReference<State>` that changes only through `compareAndSet`.
- **Timeouts and cancellation:** a shared `ScheduledExecutorService` runs timeouts. A timeout or cancellation closes the socket, because that is the only way to unblock `connect()`, `read()` or `accept()`.
- **Precondition order:** every operation checks Bluetooth hardware (`BLUETOOTH_UNAVAILABLE`), then the permissions of its scope (`PERMISSION_DENIED`), then that the adapter is on (`BLUETOOTH_DISABLED`), then Location Services for discovery on API 24–30 (`LOCATION_SERVICES_DISABLED`). The Jest fake follows the same order.
- **Teardown:** the module's `invalidate()` closes everything.
- **Ending a connection:**
  - Callbacks carry `connectionId`, and the manager ignores any id that is no longer current.
  - `read() == -1` (API 37) is treated as a `'remote'` close.
  - An `IOException` while not closing locally is `'remote'`, unless the adapter is off, in which case it is `'error'`/`BLUETOOTH_DISABLED`.
  - A write failure is `'error'`/`WRITE_FAILED`.
- **Alternatives considered:**
  - *kotlinx-coroutines*: the blocking socket APIs still need dedicated threads, and the library would add a dependency that can conflict with apps' versions.
  - *Java*: more boilerplate and no null-safety, for no benefit.

### D8. Android receivers belong to the module, not the Activity
- **Approach:**
  - Adapter-state, bond-state and bond-loss receivers are registered on the **application context** with `ContextCompat.registerReceiver(…, RECEIVER_EXPORTED)` (they are system broadcasts) when the module initializes. They are unregistered only in `invalidate()`.
  - Discovery and pairing receivers live exactly as long as their operation. They are registered *before* the OS call and filtered by address.
- **Alternatives considered:**
  - *Registering on host resume / unregistering on host pause (v1)*: loses events whenever a system dialog pauses the activity, and leaves promises hanging.

### D9. Android permissions, enable request and settings
- **Permissions:** requested through `PermissionAwareActivity` (implemented by `ReactActivity`), with a library-unique request code. `canAskAgain` comes from `shouldShowRequestPermissionRationale` combined with whether the permission was requested before, which is persisted in `SharedPreferences`.
- **Enable request:** `requestEnable()` uses `startActivityForResult` with a unique request code and an `ActivityEventListener`. Concurrent callers share a single pending result. The call resolves on `STATE_ON`; it rejects with `BLUETOOTH_DISABLED` if the result was OK but the adapter doesn't reach `on` within 15 seconds.
- **Unpair:** `unpair` uses the public `removeBond()` on API 36+, and reflection on 24–35. A `SecurityException`, `NoSuchMethodException` or `false` return becomes `UNSUPPORTED_ON_PLATFORM`.
- **Pairing timeout:** cancelling a timed-out pairing uses `cancelBondProcess()` (public on API 37, reflection below).
- **Alternatives considered:**
  - *`ActivityResultRegistry`*: needs a `ComponentActivity` and registration before `STARTED`, which a library can't guarantee.
  - *Silently skipping `unpair` on old APIs*: violates the "fail explicitly" rule.

### D10. iOS architecture (Swift core + ObjC++ shim, no CoreBluetooth)
- **Components:**
  - `RNBluetoothClassic.mm` subclasses the generated `NativeBluetoothClassicSpecBase`, implements the JSI glue and forwards calls to `BluetoothClassicCore` (Swift, `@objc`).
  - `AccessoryRegistry` wraps `EAAccessoryManager` notifications and filters accessories by declared protocols. It reads the declared protocols from Info.plist with optional casting, so a missing key means an empty list and no crash.
- **Sessions and threading:**
  - Each `AccessorySession` owns an `EASession`.
  - Both streams are scheduled on **one dedicated I/O thread with its own run loop**, and all session state is confined to that thread.
  - Public calls hop onto that thread with `perform(_:on:with:waitUntilDone: false)` and complete their promises from it.
- **Opening and writing:**
  - `connect` resolves after both streams report `.openCompleted`, with a timer for `timeoutMs`.
  - Writes are queued and drained only on `.hasSpaceAvailable`. A write promise resolves when its last byte is accepted.
  - `bytesWritten < 0` produces `WRITE_FAILED`.
- **Terminal events:** `.endEncountered` or an accessory-disconnect notification is a `'remote'` close. `.errorOccurred` while the accessory is still connected is `'error'`/`CONNECTION_LOST`.
- **Other rules:**
  - Delegates are `weak`.
  - `invalidate()` closes sessions and removes observers.
  - CoreBluetooth is not linked, so there is no Bluetooth permission prompt and no `NSBluetoothAlwaysUsageDescription` requirement.
- **Alternatives considered:**
  - *Main run loop (v1)*: blocks the UI, and v1 even slept 0.5 s on it.
  - *Scheduling streams on a dispatch queue (`CFReadStreamSetDispatchQueue`)*: workable, but undocumented for EA streams. The dedicated run loop matches Apple's EA sample code.
  - *CoreBluetooth for adapter state*: it triggers a permission prompt and reports `.unknown` on first use (v1 bug).

### D11. Logging
- **Approach:** a native logger with a level set by `setLogLevel` (synchronous; default `warn`). Payloads, names and addresses are logged only at `debug`. The log tag is `RNBluetoothClassic`.
- **Alternatives considered:**
  - *Build-flag gating (v1)*: it used `com.facebook.react.BuildConfig.DEBUG`, which is always false in published artifacts, so the gate never worked as intended.

### D12. Packaging and build
- **JS package:**
  - Layout from `create-react-native-library` and `react-native-builder-bob`: `src/` is built to `lib/module` and `lib/typescript`.
  - `package.json` has an `exports` map with `source`, `react-native`, `types` and `default` conditions, plus the `./jest` and `./app.plugin.js` entries.
  - `sideEffects: false`.
  - Strict TypeScript with no deep `react-native/Libraries/*` imports.
- **Android:**
  - Kotlin with the new DSL. `namespace` is `kjd.reactnative.bluetooth`.
  - `compileSdk`, `minSdk` and `targetSdk` are read from the root project, defaulting to 36/24/36.
  - JVM 17, and the `com.facebook.react` plugin for codegen.
  - No hard-coded `react-native` artifact version.
- **iOS:** the podspec uses `install_modules_dependencies(s)`, `min_ios_version_supported` (15.1), `s.frameworks = 'ExternalAccessory'` and `swift_version 5.9`.
- **Removed:** the stale `.xcodeproj`, the Eclipse files and `windows/`.
- **Alternatives considered:**
  - *Keeping `tsc`-only output with no `exports` map*: no `source` condition for Metro, and no clean subpath exports.

### D13. Expo config plugin
- **Approach:**
  - The plugin is written in TypeScript under `plugin/src`, compiled to `plugin/build`, and re-exported from `app.plugin.js`.
  - It uses `@expo/config-plugins`, declared as an optional peer dependency.
  - Its mods are `withAndroidManifest` and `withInfoPlist`. Every mod is idempotent: it merges, dedupes and only removes what it previously added.
- **Alternatives considered:**
  - *Continuing to point users at the third-party plugin*: it is out of sync with v2's permission model.

### D14. One fake powers JS tests and the public Jest mock
- **Approach:**
  - `src/__fakes__/FakeNativeModule.ts` implements the codegen spec in memory, with platform and API-level emulation and controllable devices.
  - The library's own Jest suite and the published `react-native-bluetooth-classic/jest` both use it, so the mock never drifts from the contract.
  - Native tests:
    - Android: Robolectric shadows per API band, plus JVM tests against a `RfcommTransport` interface backed by piped streams.
    - iOS: XCTest against an `AccessoryTransport` protocol backed by bound stream pairs.
- **Alternatives considered:**
  - *A separate hand-written mock*: drifts from the real API.
  - *`ts-auto-mock` / `ttypescript` (v1)*: unmaintained, and broken with TypeScript 5.

### D15. CI and release
- **PR CI (GitHub Actions):**
  - Lint, typecheck, Jest, and `openspec validate --strict`.
  - Android: unit tests plus an example-app build on the RN 0.82 and latest lanes.
  - iOS: `pod install` plus an `xcodebuild` of the example app on both lanes.
  - An error-code drift check.
- **Releases:**
  - Made with `release-it` from builder-bob's template.
  - Prereleases (`-rc.N`) are published to the `next` dist-tag, and only GA versions go to `latest`.
  - v1 lives on the `1.x` branch under the `legacy` dist-tag.
- **Alternatives considered:**
  - *Changesets*: fine, but it adds monorepo-oriented tooling to a single package.
  - *The existing manual workflows*: they are broken (Node 12, invalid runner labels, publishing release candidates to `latest`).

## Risks / Trade-offs

- **No Bluetooth hardware in CI.** Mitigation: fakes at each layer (D14), plus a required manual hardware matrix before each release: Android 7, 10, 12, 14, 16 and 17; iOS 15, 18, 26 and 27; an SPP printer or scanner and an MFi accessory.
- **OEM RFCOMM quirks.** Some devices only work insecure or on a fixed channel. Mitigation: `android.transport` and the opt-in `fallbackChannel`, with a troubleshooting guide keyed by `CONNECT_FAILED` `nativeMessage` patterns.
- **Tail bytes lost when closing right after a write.** Some Android stacks drop data still in flight. Mitigation: `disconnect()` drains the write queue first (spec). The hardware matrix includes a "write then disconnect" receipt test. If loss is still observed, we add a short internal linger without changing the API.
- **Base64 overhead.** It adds about 33% bridge payload plus decode cost. Mitigation: native coalescing (D4), and a throughput benchmark in the example app. SPP practical rates are well within budget; revisit JSI `ArrayBuffer` only if the benchmark fails.
- **iOS 27 EA regression.** There is one unconfirmed report that `EASession` returns nil on iOS 27. Mitigation: it maps to `SESSION_OPEN_FAILED` with OS details, and is included in the hardware matrix. If confirmed, we document it and track an Apple Feedback report.
- **Classification of Android disconnect reasons.** On API 24–36 an `IOException` cannot reliably separate a peer close from link loss. Both are reported as `'remote'` (spec), so apps should not infer more.
- **Manifest merging and location permissions.** The library's `maxSdkVersion` on location permissions can restrict an app that needs location for its own use. Mitigation: documented `tools:remove` overrides, and the plugin's `neverForLocation: false` mode.
- **Every consumer must migrate.** Mitigation: a complete v1 → v2 mapping (below), the `1.x` branch kept for critical fixes, and release candidates on `next` for early adopters.

## Migration Plan

1. **Freeze v1.** Cut the `1.x` branch from the current `main` at `1.73.0-rc.17`, and move the npm `legacy` dist-tag to the last 1.x release. Critical fixes land on `1.x` only.
2. **Build v2 on `main`.** Build in task-group order (see `tasks.md`). Each group is a PR with green CI. Publish `2.0.0-rc.N` to `next` once groups 1–6 are done.
3. **Migration guide.** Publish it with the first release candidate, covering:

| v1 | v2 |
|---|---|
| `isBluetoothAvailable()` / `isBluetoothEnabled()` | `getAdapterState()` (Android); `getCapabilities()` |
| `requestBluetoothEnabled()` / `openBluetoothSettings()` / `setBluetoothAdapterName()` | `requestEnable()` / `openSettings()` / `setAdapterName()` |
| `getBondedDevices()` | `getBondedDevices()` (Android) / `getConnectedAccessories()` (iOS) |
| `startDiscovery()` / `cancelDiscovery()` / `onDeviceDiscovered` | same names (new settle rules) / `onDeviceFound` |
| `pairDevice()` / `unpairDevice()` | `pair()` / `unpair()` |
| `connectToDevice()` / `device.connect()` | `connect()` returns a `Connection` |
| `accept()` / `cancelAccept()` | same (Android only, new options) |
| `getConnectedDevices()` / `getConnectedDevice()` / `isDeviceConnected()` | `getConnections()` / `getConnection(id)` / `connection.state` |
| `disconnectFromDevice()` / `device.disconnect()` | `connection.disconnect()` |
| `writeToDevice()` / `device.write()` | `connection.write()` |
| `readFromDevice()` / `device.read()` / `availableFromDevice()` / `clearFromDevice()` | removed; use `connection.createReader()` or `connection.onData()` |
| `onDeviceRead()` / `device.onDataReceived()` | `connection.onData()` / reader iteration |
| `onBluetoothEnabled` / `onBluetoothDisabled` / `onStateChanged` | `onAdapterStateChange` (Android) |
| `onDeviceConnected` / `onDeviceDisconnected` | `connection.onDisconnected` / `onAccessoryConnected` / `onAccessoryDisconnected` (iOS) |
| `onError` | removed; errors arrive on promises and terminal events |
| options `DELIMITER`, `DEVICE_CHARSET`, `CONNECTION_TYPE`, `READ_SIZE`, `SECURE_SOCKET` | `delimiter()` framer, reader `encoding`, `raw()` framer, `maxBufferBytes`, `android.transport` |
| `RNBluetoothClassicPackage.Builder.withConnectionFactory` | JS `Framer` interface |
| `BluetoothError` enum, `EUNSPECIFIED`, lowercase iOS codes | `ErrorCode` + `BluetoothClassicError` |

4. **GA.** Release 2.0.0 when the hardware matrix passes on the latest release candidate. Then archive this change (`openspec archive rework-v2-new-architecture`), which promotes the specs to `openspec/specs/`.
5. **Rollback.** Apps pin `react-native-bluetooth-classic@1` (or `@legacy`). v2 makes no persistent on-device changes, so downgrading needs only a rebuild.

## Open Questions

- **Docs site.** Which generator replaces the Gatsby site in `docs/`? Docusaurus, VitePress or plain Markdown on GitHub Pages. The content plan is fixed regardless.
- **v1 support window.** How long does `1.x` get critical fixes after 2.0.0 GA? The proposal is 6 months.
- **Swift Package Manager.** When should SPM distribution (`Package.swift`) start? This becomes a separate change once React Native's SPM support leaves experimental.
