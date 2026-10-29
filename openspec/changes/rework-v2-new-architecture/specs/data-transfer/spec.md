# Spec Delta

## Purpose

Defines how bytes move over an open connection: ordered writes, a single inbound byte stream with bounded buffering, and framing and text-decoding helpers. All of them behave the same on Android and iOS.

## ADDED Requirements

### Requirement: Write input
`connection.write(data, options?)` SHALL accept either a `Uint8Array`, or a string together with `options.encoding`. Supported encodings are `'utf8'` (the default), `'ascii'`, `'latin1'`, `'hex'` and `'base64'`. Input that cannot be encoded SHALL reject with `INVALID_ARGUMENT` before any byte is sent. An empty payload SHALL resolve immediately without I/O.

#### Scenario: Bytes written
- **WHEN** an app writes `new Uint8Array([0x1b, 0x40])`
- **THEN** exactly those two bytes are sent

#### Scenario: Non-ASCII text with ascii encoding
- **WHEN** an app writes the string `'café'` with `encoding: 'ascii'`
- **THEN** the promise rejects with `INVALID_ARGUMENT` and nothing is sent

### Requirement: Write completion
`write()` SHALL resolve only after every byte of the payload has been accepted by the OS stream. A partial write SHALL continue until the whole payload is accepted. If the OS reports a write error, the call SHALL reject with `WRITE_FAILED`, and the connection SHALL end with reason `'error'` and the same code.

#### Scenario: Large payload on Android
- **WHEN** an Android app writes a 64 KiB payload
- **THEN** the promise resolves after all 65,536 bytes have been accepted by the RFCOMM socket

#### Scenario: Stream accepts partial writes on iOS
- **WHEN** an iOS app writes a payload larger than the output stream accepts at once
- **THEN** the library writes the rest as soon as the stream has space, and resolves once every byte is accepted

#### Scenario: Write error
- **WHEN** the OS reports an I/O error during a write
- **THEN** the write rejects with `WRITE_FAILED`, and the connection emits `onDisconnected` with `reason: 'error'`

### Requirement: Write ordering
Writes on one connection SHALL be sent in the order `write()` was called. Bytes from different writes SHALL never interleave, whether or not callers await each write.

#### Scenario: Unawaited writes
- **WHEN** an app calls `write(a)`, `write(b)` and `write(c)` without awaiting
- **THEN** the remote device receives all bytes of `a`, then all of `b`, then all of `c`

### Requirement: Write timeout
When `options.timeoutMs` is given, a write that is not fully accepted within that time SHALL reject with `WRITE_TIMEOUT`. Because the stream position is then unknown, the connection SHALL end with reason `'error'` and code `WRITE_TIMEOUT`. Writes queued behind it SHALL reject with `NOT_CONNECTED`.

#### Scenario: Remote stops reading
- **WHEN** the remote device stops reading and a write with `timeoutMs: 2000` cannot complete
- **THEN** after 2 seconds the write rejects with `WRITE_TIMEOUT`, and the connection ends with `reason: 'error'`

### Requirement: Single inbound byte stream
Inbound bytes SHALL reach JS only through the connection's data stream, which apps consume with `connection.onData(listener)` or with readers. Bytes SHALL arrive as `Uint8Array` chunks in arrival order. Chunk boundaries carry no meaning. There SHALL be no separate pull-style read, available or clear API that competes for the same bytes.

#### Scenario: Ordered delivery
- **WHEN** a device sends 10,000 bytes in several bursts
- **THEN** concatenating the received chunks yields exactly the 10,000 bytes in order, with nothing duplicated or missing

### Requirement: Delivery latency
Bytes read from the OS stream SHALL be delivered to JS consumers with at most 50 milliseconds of added batching delay. Batching SHALL never reorder bytes.

#### Scenario: Single small message
- **WHEN** a device sends a 12-byte reply and nothing else
- **THEN** a data listener receives those 12 bytes no later than 50 milliseconds after the OS made them readable

### Requirement: Backlog before the first consumer
Bytes that arrive after a connection is established but before its first consumer attaches SHALL be retained, up to `maxBufferBytes` (connection option, default 1 MiB). They SHALL be delivered to the first consumer before any newer bytes. Later consumers SHALL receive only bytes that arrive after they attach.

#### Scenario: Greeting sent on connect
- **WHEN** a device sends a greeting immediately on connect, and the app attaches `onData` after `connect()` resolves
- **THEN** the listener receives the greeting first

#### Scenario: Second consumer
- **WHEN** a second data listener attaches after the first has received some data
- **THEN** the second listener receives only bytes that arrive after it attached, and the first listener is unaffected

### Requirement: Bounded buffering
The bytes held for a connection but not yet delivered to consumers SHALL never exceed `maxBufferBytes`. If that limit would be exceeded, the connection SHALL end with reason `'error'` and code `BUFFER_OVERFLOW`. Bytes SHALL never be dropped silently.

#### Scenario: No consumer attached (Android)
- **WHEN** an Android device streams data continuously and the app never attaches a consumer
- **THEN** once `maxBufferBytes` is exceeded, the connection ends with `BUFFER_OVERFLOW`

#### Scenario: No consumer attached (iOS)
- **WHEN** an iOS accessory streams data continuously and the app never attaches a consumer
- **THEN** once `maxBufferBytes` is exceeded, the connection ends with `BUFFER_OVERFLOW`

### Requirement: Framed readers
`connection.createReader({ framer, encoding?, maxFrameBytes? })` SHALL return a reader whose frames are produced from the inbound stream by a framer. Built-in framers:
- `delimiter(bytesOrString, { includeDelimiter? })`: the delimiter may be any length
- `fixedLength(n)`
- `raw()`

Custom framers implementing the documented `Framer` interface SHALL be supported. Framing SHALL produce identical frames on both platforms.

#### Scenario: Delimiter split across chunks
- **WHEN** a `delimiter('\r\n')` reader receives `"OK\r"` in one chunk and `"\nREADY\r\n"` in the next
- **THEN** it produces the frames `"OK"` and `"READY"`, with no leftover delimiter bytes

#### Scenario: Same frames on both platforms
- **WHEN** the same byte sequence is received on Android and on iOS with the same framer
- **THEN** both platforms produce identical frames

#### Scenario: Frame too large
- **WHEN** a frame grows beyond `maxFrameBytes` before its delimiter arrives
- **THEN** the reader fails with `BUFFER_OVERFLOW`, and the connection stays open

### Requirement: Reading frames
`reader.read({ timeoutMs?, signal? })` SHALL resolve with the next frame. Frames are strings when the reader has an `encoding`, otherwise `Uint8Array`. The method SHALL reject with `READ_TIMEOUT` when no frame arrives within `timeoutMs`. Readers SHALL support `for await` iteration, which ends normally after a `'local'` or `'remote'` disconnect and throws the terminal error after an `'error'` disconnect.

#### Scenario: Request/response with timeout
- **WHEN** an app writes a command and calls `reader.read({ timeoutMs: 1000 })` and no reply arrives
- **THEN** the read rejects with `READ_TIMEOUT`, the connection stays open, and the reader remains usable

#### Scenario: Iteration ends on remote close
- **WHEN** an app iterates a reader with `for await` and the remote device closes the link
- **THEN** the loop exits normally after the last complete frame
- **AND** a trailing partial frame is yielded as the final frame

#### Scenario: Pending read when connection fails
- **WHEN** a `read()` is pending and the connection ends with `reason: 'error'`
- **THEN** the read rejects with the connection's terminal error code

### Requirement: Text decoding
Decoding SHALL be streaming and SHALL be identical on both platforms:
- `'utf8'`: multi-byte sequences split across chunks decode correctly, and invalid sequences become U+FFFD
- `'ascii'`: bytes above 0x7F become U+FFFD
- `'latin1'`: each byte maps to the code point of the same value

A byte that cannot be decoded SHALL never stall a reader or connection.

#### Scenario: UTF-8 character split across chunks
- **WHEN** a utf8 reader receives the first two bytes of a three-byte character in one chunk and the last byte in the next
- **THEN** the frame contains the correct character

#### Scenario: Invalid byte in the stream
- **WHEN** a utf8 reader receives the byte 0xFF
- **THEN** that byte decodes as U+FFFD, and the following frames still decode normally

### Requirement: Encoding helpers without polyfills
The library SHALL export helpers to convert between `Uint8Array` and hex, base64, utf8, ascii and latin1 strings. It SHALL work without any `buffer` polyfill. Public types SHALL reference only `Uint8Array`, `ArrayBuffer` and string.

#### Scenario: Hex helper
- **WHEN** an app calls `fromHex('1b40')`
- **THEN** it returns `Uint8Array [0x1b, 0x40]`

#### Scenario: No polyfill installed
- **WHEN** an app that does not install the `buffer` package uses every data API
- **THEN** everything works as specified
