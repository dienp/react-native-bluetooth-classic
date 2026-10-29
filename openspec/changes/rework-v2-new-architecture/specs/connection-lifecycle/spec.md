# Spec Delta

## Purpose

Defines how connections are opened, accepted, cancelled, observed and closed. Every connection follows one predictable state machine and ends with exactly one terminal event on both platforms.

## ADDED Requirements

### Requirement: Connection handles
`connect()` and `accept()` SHALL resolve with a `Connection` exposing these fields:
- `id`: an opaque connection identifier, unique for the lifetime of the module
- `device`
- `state`
- `connectedAt`: epoch milliseconds

`getConnections()` SHALL resolve with every connection not yet `disconnected`, and `getConnection(id)` with that connection or `null`. All operations on a connection SHALL target that connection only.

#### Scenario: Listing open connections
- **WHEN** an app has two open connections and one of them disconnects
- **THEN** `getConnections()` resolves with only the remaining connection

#### Scenario: Unknown connection id
- **WHEN** an app calls `getConnection('missing')`
- **THEN** it resolves with `null`

### Requirement: Connection state machine
A connection's `state` SHALL move only forward: `connecting`, then `connected`, then `disconnecting`, then `disconnected`. The `disconnecting` step may be skipped when the connection is lost. `connection.onStateChange(listener)` SHALL deliver each transition exactly once and in order. No connection SHALL ever leave `disconnected`.

#### Scenario: Local disconnect transitions
- **WHEN** an app calls `disconnect()` on a connected connection
- **THEN** listeners receive `connected` to `disconnecting`, then `disconnecting` to `disconnected`

#### Scenario: Remote loss transitions
- **WHEN** the remote device goes out of range
- **THEN** listeners receive `connected` to `disconnected`

### Requirement: Exactly one terminal event per connection
Every connection SHALL emit exactly one `connection.onDisconnected({ reason, error?, timestamp })` event. `reason` is `'local'` after `disconnect()`, `'remote'` when the peer closes the link or the link drops (out of range, peer powered off), and `'error'` when the library ends the connection because of a failure. Only `'error'` events carry `error`.

#### Scenario: Connection ended by a failure
- **WHEN** a connection ends because of a write failure, a write timeout, adapter shutdown, a buffer overflow or an unexpected local failure
- **THEN** `onDisconnected` fires with `reason: 'error'`
- **AND** `error.code` is `WRITE_FAILED`, `WRITE_TIMEOUT`, `BLUETOOTH_DISABLED`, `BUFFER_OVERFLOW` or `CONNECTION_LOST` respectively

#### Scenario: Remote closes on Android API 37
- **WHEN** an Android app targeting API 37 runs on API 37 and the peer closes the RFCOMM link, so that reads report end-of-stream instead of an error
- **THEN** the connection emits `onDisconnected` with `reason: 'remote'` exactly once, and stops reading

#### Scenario: Remote closes or link drops on Android API 24-36
- **WHEN** the peer closes the RFCOMM link, or the device goes out of range, on API 24 to 36
- **THEN** the connection emits `onDisconnected` with `reason: 'remote'` exactly once

#### Scenario: Accessory unplugged or powered off (iOS)
- **WHEN** an iOS accessory with an open session disconnects from the OS, or its stream reports end or error
- **THEN** the connection emits `onDisconnected` exactly once
- **AND** the reason is `'remote'` for end of stream or accessory disconnect, and `'error'` with `CONNECTION_LOST` for a stream error reported while the accessory is still connected

#### Scenario: Adapter turned off (Android)
- **WHEN** the adapter turns off while connections are open
- **THEN** each connection emits `onDisconnected` with `reason: 'error'` and `error.code` `BLUETOOTH_DISABLED`

### Requirement: Terminal event replay for late listeners
A listener added with `connection.onDisconnected(listener)` after the connection has ended SHALL be called once, immediately, with the original terminal event.

#### Scenario: Late listener
- **WHEN** an app subscribes to `onDisconnected` on a connection that has already ended
- **THEN** the listener is called once with the original terminal event

### Requirement: Connect as a client on Android
On Android, `connect(address, options?)` SHALL open an RFCOMM connection and resolve once it is `connected`. Options:
- `android.transport`: `'secure'` (default) or `'insecure'`
- `android.uuid`: default is the Serial Port Profile UUID
- `timeoutMs`: default 15000
- `signal`: an AbortSignal

Any running discovery session SHALL be cancelled first.

#### Scenario: Successful connect (Android)
- **WHEN** an app with the `'connect'` scope granted calls `connect(address)` for a device in range
- **THEN** the promise resolves with a `Connection` in state `connected`

#### Scenario: Discovery running during connect (Android)
- **WHEN** an app calls `connect()` while its discovery session is running
- **THEN** discovery is cancelled, and the pending `startDiscovery()` resolves with the devices found so far, before the connection attempt starts

#### Scenario: Device unreachable (Android)
- **WHEN** the RFCOMM connection attempt fails
- **THEN** the promise rejects with `CONNECT_FAILED`, carrying the OS reason in `nativeMessage`, and the socket is closed

#### Scenario: Connect timeout (Android)
- **WHEN** the attempt does not complete within `timeoutMs`
- **THEN** the promise rejects with `CONNECT_TIMEOUT`, the socket is closed, and no connection is created later

### Requirement: Opt-in RFCOMM channel fallback on Android
On Android, when `android.fallbackChannel` is set and the UUID-based attempt fails, the library SHALL close the failed socket and retry once on that RFCOMM channel. Without the option it SHALL NOT retry on any channel. If both attempts fail, the rejection SHALL be `CONNECT_FAILED`, and its `nativeMessage` SHALL include both failure reasons.

#### Scenario: Fallback succeeds (Android)
- **WHEN** an app calls `connect(address, { android: { fallbackChannel: 1 } })` and the UUID attempt fails but channel 1 accepts
- **THEN** the promise resolves with a connected `Connection`, and only one socket remains open

#### Scenario: No fallback by default (Android)
- **WHEN** an app calls `connect(address)` without `fallbackChannel` and the UUID attempt fails
- **THEN** the promise rejects with `CONNECT_FAILED`, and no channel-based attempt is made

### Requirement: Connect to an accessory on iOS
On iOS, `connect(accessoryId, options?)` SHALL open an ExternalAccessory session. It SHALL resolve only once both the input and output streams are open. Options:
- `ios.protocol`: defaults to the first protocol declared in Info.plist that the accessory supports
- `timeoutMs`: default 15000
- `signal`

#### Scenario: Default protocol (iOS)
- **WHEN** an app calls `connect(accessoryId)` for an accessory that supports the second declared protocol only
- **THEN** the session opens with that protocol, and the promise resolves once both streams are open

#### Scenario: Explicit protocol not declared (iOS)
- **WHEN** an app passes an `ios.protocol` that is missing from `UISupportedExternalAccessoryProtocols`
- **THEN** the promise rejects with `PROTOCOL_NOT_DECLARED`

#### Scenario: Protocol not supported by accessory (iOS)
- **WHEN** an app passes a declared `ios.protocol` that the accessory does not list
- **THEN** the promise rejects with `PROTOCOL_NOT_SUPPORTED`

#### Scenario: Accessory not connected (iOS)
- **WHEN** an app calls `connect()` with an `id` that is not currently connected to the OS
- **THEN** the promise rejects with `ACCESSORY_NOT_CONNECTED`

#### Scenario: OS refuses the session (iOS)
- **WHEN** the OS returns no session for the accessory and protocol
- **THEN** the promise rejects with `SESSION_OPEN_FAILED`

#### Scenario: Streams never open (iOS)
- **WHEN** the streams do not both open within `timeoutMs`
- **THEN** the promise rejects with `CONNECT_TIMEOUT`, and the session is closed

### Requirement: Platform-scoped connect options
Options that apply on only one platform SHALL be nested under `android` or `ios`. The block for the other platform SHALL be ignored, so one options object works on both platforms. Unknown keys at any level SHALL reject with `INVALID_ARGUMENT`.

#### Scenario: Cross-platform options object
- **WHEN** an app passes `{ timeoutMs: 8000, android: { transport: 'insecure' }, ios: { protocol: 'com.acme.serial' } }` to `connect()`
- **THEN** on Android the insecure transport is used, and on iOS the `com.acme.serial` protocol is used

### Requirement: One active connection per target
At most one connection that is not `disconnected` SHALL exist per Android address and per iOS accessory-and-protocol pair. A second `connect()` to that target SHALL reject with `ALREADY_CONNECTED` while a connection exists, or with `ALREADY_CONNECTING` while an attempt is pending. The error's `connectionId` SHALL identify the existing connection.

#### Scenario: Connect twice to the same device
- **WHEN** an app calls `connect(address)` while a connection to that address is already `connected`
- **THEN** the promise rejects with `ALREADY_CONNECTED`, its `connectionId` is the existing connection's `id`, and the existing connection is unaffected

#### Scenario: Concurrent connect attempts
- **WHEN** an app calls `connect(address)` twice before the first attempt settles
- **THEN** the second call rejects with `ALREADY_CONNECTING`

### Requirement: Cancel a pending connect
When the `signal` passed to `connect()` or `accept()` is aborted before the operation settles, the library SHALL abort the attempt, close any socket or session, and reject with `CONNECT_CANCELLED` (or `ACCEPT_CANCELLED` for `accept()`). An abort after the operation settled SHALL have no effect.

#### Scenario: User leaves the screen during connect
- **WHEN** the app aborts the signal while a connect is pending
- **THEN** the promise rejects with `CONNECT_CANCELLED`, and no connection to that device remains

### Requirement: Stale events never affect newer connections
Native callbacks from a connection that has ended SHALL NOT change the state of, or close, any other connection, including a newer connection to the same device.

#### Scenario: Reconnect after loss
- **WHEN** a connection to a device is lost, the app connects again, and a late OS notification about the old link arrives
- **THEN** the new connection stays `connected`

### Requirement: Disconnect
`connection.disconnect({ timeoutMs? })` SHALL let writes that were queued before the call finish, close the link, and resolve once the state is `disconnected`. Writes still pending when `timeoutMs` elapses (default 5000) SHALL reject with `NOT_CONNECTED`. Calling `disconnect()` on a connection that is already disconnecting or disconnected SHALL resolve without effect.

#### Scenario: Write then disconnect immediately
- **WHEN** an app calls `write(receipt)` and then `disconnect()` without awaiting the write
- **THEN** the receipt bytes are written before the link closes, and both promises resolve

#### Scenario: Disconnect twice
- **WHEN** an app calls `disconnect()` on a connection that is already `disconnected`
- **THEN** the promise resolves and nothing else happens

### Requirement: Accept incoming connections on Android
On Android, `accept(options?)` SHALL listen for one incoming RFCOMM connection and resolve with its `Connection`. Options:
- `uuid`: default is the Serial Port Profile UUID
- `serviceName`
- `transport`: `'secure'` (default) or `'insecure'`
- `timeoutMs`: no default
- `signal`

The listening socket SHALL be closed once `accept()` settles. On iOS, `accept()` SHALL reject with `UNSUPPORTED_ON_PLATFORM`.

#### Scenario: Incoming connection (Android)
- **WHEN** a remote device connects to the advertised service while `accept()` is pending
- **THEN** the promise resolves with a `Connection` in state `connected`, and the listening socket is closed

#### Scenario: Accept timeout (Android)
- **WHEN** no device connects within `timeoutMs`
- **THEN** the promise rejects with `ACCEPT_TIMEOUT`, and the listening socket is closed

#### Scenario: Accept on iOS
- **WHEN** an iOS app calls `accept()`
- **THEN** the promise rejects with `UNSUPPORTED_ON_PLATFORM`

### Requirement: One accept at a time and cancellation
On Android, a second `accept()` while one is pending SHALL reject with `ACCEPT_ALREADY_RUNNING`. `cancelAccept()` SHALL make the pending `accept()` reject with `ACCEPT_CANCELLED`, close the listening socket, and resolve. With nothing pending it SHALL resolve without effect. A failure to listen SHALL reject with `ACCEPT_FAILED`.

#### Scenario: Cancel a pending accept (Android)
- **WHEN** an app calls `cancelAccept()` while `accept()` is pending
- **THEN** `accept()` rejects with `ACCEPT_CANCELLED`, `cancelAccept()` resolves, and a later `accept()` can start normally

#### Scenario: Second accept (Android)
- **WHEN** an app calls `accept()` while another `accept()` is pending
- **THEN** the second call rejects with `ACCEPT_ALREADY_RUNNING`

### Requirement: Connections while the app is in the background
On Android, open connections SHALL remain open while the app is in the background, for as long as the process is alive. On iOS, open sessions SHALL remain open in the background only when the app declares the `external-accessory` background mode. If the OS closes a session while the app is suspended, the terminal event SHALL be delivered when the app resumes.

#### Scenario: Backgrounded on Android
- **WHEN** an Android app with an open connection moves to the background
- **THEN** the connection stays `connected` and keeps receiving data

#### Scenario: Suspended on iOS without background mode
- **WHEN** an iOS app without the `external-accessory` background mode is suspended, and the OS closes its session
- **THEN** on resume the connection emits `onDisconnected` exactly once
