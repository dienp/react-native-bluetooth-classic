# Connections and data

> The native modules are still stubs in this v2 pre-release; this page describes the contract the JavaScript layer already implements and tests.

## Connecting

```ts
const connection = await connect(deviceId, {
  timeoutMs: 15_000, // default
  signal, // AbortSignal: aborting rejects with CONNECT_CANCELLED
  maxBufferBytes: 1024 * 1024, // default; see "Buffering"
  android: { transport: 'secure', uuid, fallbackChannel }, // ignored on iOS
  ios: { protocol: 'com.acme.serial' }, // ignored on Android
});
```

- `deviceId` is the device address on Android and the accessory `id` on iOS.
- One options object works on both platforms: the `android` and `ios` blocks are only read on their platform.
- One connection per Android address, and per accessory and protocol on iOS. A second `connect()` rejects with `ALREADY_CONNECTED` (with the existing `connectionId`) or `ALREADY_CONNECTING`.
- On Android a running discovery session is cancelled first.
- `fallbackChannel` is opt-in: when the UUID-based attempt fails, the library retries once on that RFCOMM channel.
- On iOS the protocol defaults to the first protocol in `UISupportedExternalAccessoryProtocols` that the accessory supports. An undeclared protocol rejects with `PROTOCOL_NOT_DECLARED`; one the accessory lacks rejects with `PROTOCOL_NOT_SUPPORTED`.

Android apps can also `accept({ uuid, serviceName, transport, timeoutMs, signal })` one incoming connection; `cancelAccept()` rejects the pending accept with `ACCEPT_CANCELLED`.

## Connection lifecycle

`connection.state` only moves forward: `connecting` → `connected` → `disconnecting` → `disconnected` (`disconnecting` is skipped when the link drops). `connection.onStateChange()` reports each transition once.

Every connection emits exactly one `connection.onDisconnected({ reason, error?, timestamp })`:

| `reason` | When | `error.code` |
|---|---|---|
| `'local'` | After `disconnect()` | — |
| `'remote'` | The peer closed the link or the link dropped | — |
| `'error'` | The library ended the connection because of a failure | `WRITE_FAILED`, `WRITE_TIMEOUT`, `BLUETOOTH_DISABLED`, `BUFFER_OVERFLOW` or `CONNECTION_LOST` |

A listener added after the connection ended is called immediately with the same event.

`connection.disconnect({ timeoutMs = 5000 })` lets writes queued before the call finish, then closes the link. Writes still pending after `timeoutMs` reject with `NOT_CONNECTED`. Calling it again has no effect.

## Writing

```ts
await connection.write(new Uint8Array([0x1b, 0x40]));
await connection.write('Total: 12.50\n', { encoding: 'latin1' });
```

- `data` is a `Uint8Array`, or a string with `encoding`: `'utf8'` (default), `'ascii'`, `'latin1'`, `'hex'` or `'base64'`. Characters the encoding cannot represent reject with `INVALID_ARGUMENT` before anything is sent.
- `write()` resolves only after the OS has accepted every byte. Writes are sent in call order and never interleave, even when not awaited.
- An OS write error rejects with `WRITE_FAILED` and ends the connection. With `timeoutMs`, a write that is not accepted in time rejects with `WRITE_TIMEOUT` and ends the connection (the stream position is unknown afterwards).

## Receiving

There is exactly one inbound stream per connection. Consume it with `connection.onData(listener)` (raw `Uint8Array` chunks; boundaries carry no meaning) or with readers.

```ts
const reader = connection.createReader({
  framer: delimiter('\r\n'),
  encoding: 'utf8', // omit to get Uint8Array frames
  maxFrameBytes: 64 * 1024, // default
});

const reply = await reader.read({ timeoutMs: 1000 }); // READ_TIMEOUT if nothing arrives

for await (const line of reader) {
  // Ends after a local or remote disconnect; throws after an error disconnect.
}
```

- `read()` rejects with `READ_TIMEOUT` when `timeoutMs` elapses or `signal` aborts; the reader and the connection stay usable.
- After a `'remote'` close, a reader still yields the trailing partial frame (for example a last line without a newline).
- After the connection ends, `read()` rejects with the terminal error (for `'error'`) or `NOT_CONNECTED`.
- A frame larger than `maxFrameBytes` fails that reader with `BUFFER_OVERFLOW`; the connection stays open.
- `reader.close()` detaches the reader and drops its queued frames.

### Framers

| Framer | Frames |
|---|---|
| `delimiter(value, { includeDelimiter?, encoding? })` | Split on a string or byte delimiter of any length, recognized across chunk boundaries |
| `fixedLength(n)` | Exactly `n` bytes each |
| `raw()` | Each chunk as received (text decoding then continues across chunks) |
| Custom | Any object implementing `Framer`: `push(chunk) => frames`, `flush() => frames` (on remote close), `reset()`, optional `bufferedBytes` |

Framing runs in JavaScript, so the same bytes give the same frames on Android and iOS, whatever the OS chunking. See the [length-prefixed framer example](./examples/streaming.ts).

### Text decoding

Readers decode with streaming decoders that behave the same on both platforms: `'utf8'` handles characters split across chunks and replaces invalid bytes with U+FFFD; `'ascii'` replaces bytes above 0x7F with U+FFFD; `'latin1'` maps each byte to the same code point. A bad byte never stalls a reader.

The helpers `encodeText`, `decodeText`, `createTextDecoder`, `toHex`/`fromHex` and `toBase64`/`fromBase64` are exported for your own use; no `buffer` polyfill is needed.

## Buffering

Bytes that arrive before the first consumer (`onData` listener or reader) attaches are kept and handed to that first consumer, so a greeting sent right after connecting is not lost. Later consumers only receive newer bytes.

Everything held but not yet delivered to your code (the backlog plus frames queued in readers) is limited by `maxBufferBytes`. Exceeding it ends the connection with `'error'`/`BUFFER_OVERFLOW`; bytes are never dropped silently.

## Examples

- [Printing a receipt and request/response](./examples/printer.ts)
- [Streaming and a custom framer](./examples/streaming.ts)
