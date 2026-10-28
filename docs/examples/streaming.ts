import {
  connect,
  delimiter,
  type Connection,
  type Framer,
} from 'react-native-bluetooth-classic';

/** Logs every NMEA sentence from a GPS receiver until the connection ends. */
export async function logNmea(deviceId: string): Promise<void> {
  const connection = await connect(deviceId, {
    ios: { protocol: 'com.acme.gps' },
  });
  connection.onDisconnected(({ reason, error }) => {
    console.log(`GPS disconnected (${reason})`, error?.code ?? '');
  });

  const reader = connection.createReader({
    framer: delimiter('\r\n'),
    encoding: 'ascii',
  });
  // Ends normally after a local or remote disconnect; throws after an error.
  for await (const sentence of reader) {
    console.log(sentence);
  }
}

/**
 * A custom framer for a length-prefixed protocol: one length byte, then that
 * many payload bytes.
 */
export function lengthPrefixed(): Framer {
  let buffer = new Uint8Array(0);
  return {
    push(chunk) {
      const merged = new Uint8Array(buffer.length + chunk.length);
      merged.set(buffer);
      merged.set(chunk, buffer.length);
      buffer = merged;
      const frames: Uint8Array[] = [];
      while (buffer.length > 0 && buffer.length >= 1 + buffer[0]!) {
        frames.push(buffer.slice(1, 1 + buffer[0]!));
        buffer = buffer.slice(1 + buffer[0]!);
      }
      return frames;
    },
    flush() {
      buffer = new Uint8Array(0);
      return [];
    },
    reset() {
      buffer = new Uint8Array(0);
    },
    get bufferedBytes() {
      return buffer.length;
    },
  };
}

/** Reads length-prefixed frames as bytes. */
export function readPackets(connection: Connection): AsyncIterable<Uint8Array> {
  return connection.createReader({
    framer: lengthPrefixed(),
    maxFrameBytes: 255,
  });
}
