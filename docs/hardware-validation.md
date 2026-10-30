# Hardware validation

CI has no Bluetooth hardware: it runs the JavaScript layer against a fake native module, the Android code against fake sockets (JVM and Robolectric), and the iOS code against fake streams (XCTest). This page lists what must still be checked on real devices before each release, and traces every scenario in the [specs](../openspec/changes/rework-v2-new-architecture/specs) to the automated test or checklist item that covers it. CI fails if a scenario is missing from the table ([`scripts/ci/check-traceability.mjs`](../scripts/ci/check-traceability.mjs)).

## Device matrix

Run the checklist on each of these, with the example app built from the release candidate:

| Platform | Versions                                                         | Hardware                                                                 |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Android  | 7 (API 24), 10 (29), 12 (31), 14 (34), 16 (36), 17 (37)          | An SPP printer or scanner, and an SPP loopback device for the echo test. |
| iOS      | 15, 18, 26, 27                                                   | An MFi accessory with a serial-style protocol that can echo.             |

Build the example on both React Native lanes: the minimum (0.82) and the latest release. Record each run in the release PR: device, OS version, item, result, and the error code and `nativeMessage` of any failure.

## Checklist

### Android

- **HW-A1** Adapter state: on the Overview screen, read the adapter state, then turn Bluetooth off and on from quick settings. Every transition is logged once, in order, including while a system dialog covers the app.
- **HW-A2** Permissions: on a fresh install, request each scope; deny once, then deny with "don't ask again" (`canAskAgain: false`). On API 24–30, turn Location Services off: discovery rejects with `LOCATION_SERVICES_DISABLED`.
- **HW-A3** Turning Bluetooth on: with Bluetooth off, `requestEnable()`; accept once and decline once. Also call `openSettings()` and `setAdapterName()`.
- **HW-A4** Discovery: start discovery near at least three devices. Each appears once; cancel resolves with what was found; a timeout ends it; Bluetooth off during discovery rejects with `BLUETOOTH_DISABLED`.
- **HW-A5** Pairing: pair a device that shows a PIN or passkey dialog; decline once; let one attempt time out; unpair. On API 36+, reset the paired device's bonds: `onBondLost` fires.
- **HW-A6** Connecting: connect to the SPP device (secure, then insecure); with a wrong UUID (`CONNECT_FAILED`, OS reason in `nativeMessage`); with `fallbackChannel` on a device whose SDP record is wrong; with the device off (`CONNECT_TIMEOUT`); cancel a pending connect (`CONNECT_CANCELLED`); connect twice (`ALREADY_CONNECTED`). Start a connect while discovery runs: discovery resolves first.
- **HW-A7** Echo: on the Echo screen, run the echo test against the loopback device ten times: every run reports "Echo OK" with its time. Send a 64 KiB payload and several unawaited writes: the bytes come back complete and in order.
- **HW-A8** Connection ends: power the device off or walk out of range (`'remote'`); repeat on API 37 (end of stream, also `'remote'`); turn Bluetooth off with a connection open (`'error'`, `BLUETOOTH_DISABLED`).
- **HW-A9** Write then disconnect: print a long receipt with `write()` followed by `disconnect()` without awaiting the write. The whole receipt prints.
- **HW-A10** Background: with a connection open, put the app in the background for five minutes while the device sends data. The connection stays open and the data arrives.
- **HW-A11** Accepting: on the Connect screen, `accept()` and connect to the phone from another device; cancel a pending accept; let one time out.
- **HW-A12** Reload: with a connection open, reload JavaScript from the dev menu. Nothing reaches the new runtime, and connecting to the same device again works.
- **HW-A13** Benchmark: run the benchmark screen against the loopback device and record throughput and latency (see [Benchmark](#benchmark)).

### iOS

- **HW-I1** Capabilities: the Overview screen shows `declaredProtocols` from Info.plist. A build of the example without `UISupportedExternalAccessoryProtocols` starts and reports none.
- **HW-I2** Picker: show the accessory picker; select an accessory (`onAccessoryConnected` fires); cancel (`USER_REJECTED`); use a name filter that matches nothing.
- **HW-I3** Accessory list: power the accessory off and on. `onAccessoryDisconnected` and `onAccessoryConnected` fire, and the accessory comes back with a new `id`.
- **HW-I4** Connecting: connect with the default protocol and with an explicit one; with an undeclared protocol (`PROTOCOL_NOT_DECLARED`); with a declared protocol the accessory lacks (`PROTOCOL_NOT_SUPPORTED`); to a stale `id` (`ACCESSORY_NOT_CONNECTED`); twice (`ALREADY_CONNECTED`).
- **HW-I5** Echo: run the echo test against the accessory ten times; every run reports "Echo OK".
- **HW-I6** Connection ends: power the accessory off with a session open (`'remote'`); disconnect (`'local'`).
- **HW-I7** Background: with the `external-accessory` background mode, the session survives five minutes in the background. Without it, after the app is suspended and resumed, `onDisconnected` fires once.
- **HW-I8** Reload: with a session open, reload JavaScript; then connect to the same accessory and protocol again.
- **HW-I9** Settings: `openSettings()` opens the app's page in Settings (iOS 15 and iOS 27; simulators are enough).

### Both platforms

- **HW-X1** Expo: a development build of an Expo app with the config plugin installs, and the Overview screen works.
- **HW-X2** Release build: a release build of the example (Hermes, minified) connects and passes the echo test.
- **HW-X3** Logging: at the default level, connecting and echoing logs nothing with payloads or names; after `setLogLevel('debug')`, logcat or Console shows the connection and byte counts.
- **HW-X4** Errors in the example: a failed connect shows the error's `code`, `message` and `nativeMessage` on screen.

## Benchmark

The example's Benchmark screen sends fixed-size blocks to a loopback device and measures:

- **Throughput:** bytes per second over 1 MiB, written without awaiting each block, until every byte has come back.
- **Latency:** the round-trip time of a 12-byte line, 100 times, reported as median and 95th percentile.

Record the device, OS version and results in the release PR. The release goal is a median added latency of 50 ms or less, and throughput no lower than v1's on the same device.

## Traceability

Every scenario of every capability, and what covers it. Paths are relative to the repository root; a test is written `` `file` › name ``.
