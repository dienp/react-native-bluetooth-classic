import {
  ErrorCode,
  connect,
  decodeText,
  delimiter,
  encodeText,
  fixedLength,
  raw,
  type Connection,
} from '../index';
import { uninstallFakeNativeModule } from '../__fakes__/install';
import type { FakeNativeModule } from '../__fakes__/FakeNativeModule';
import { ADDRESS, androidWithDevice, flush, iosWithAccessory } from './helpers';

afterEach(() => {
  jest.restoreAllMocks();
  uninstallFakeNativeModule();
});

async function open(
  options?: Parameters<typeof connect>[1]
): Promise<{ fake: FakeNativeModule; connection: Connection }> {
  const fake = androidWithDevice();
  const connection = await connect(ADDRESS, options);
  return { fake, connection };
}

describe('write input', () => {
  it('sends exactly the given bytes', async () => {
    const { fake, connection } = await open();
    await connection.write(new Uint8Array([0x1b, 0x40]));
    expect(Array.from(fake.writtenBytes(connection.id))).toEqual([0x1b, 0x40]);
  });

  it.each([
    ['héllo', undefined, [0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f]],
    ['héllo', 'latin1', [0x68, 0xe9, 0x6c, 0x6c, 0x6f]],
    ['1b40', 'hex', [0x1b, 0x40]],
    ['G0A=', 'base64', [0x1b, 0x40]],
  ] as const)('encodes %j with %s', async (text, encoding, expected) => {
    const { fake, connection } = await open();
    await connection.write(text, encoding ? { encoding } : undefined);
    expect(Array.from(fake.writtenBytes(connection.id))).toEqual(expected);
  });

  it('rejects text the encoding cannot represent, sending nothing', async () => {
    const { fake, connection } = await open();
    await expect(
      connection.write('café', { encoding: 'ascii' })
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
      connectionId: connection.id,
    });
    expect(fake.calls.filter((c) => c.method === 'write')).toEqual([]);
  });

  it('resolves an empty payload without I/O', async () => {
    const { fake, connection } = await open();
    await connection.write(new Uint8Array());
    await connection.write('');
    expect(fake.calls.filter((c) => c.method === 'write')).toEqual([]);
  });

  it.each([
    [42, undefined],
    [new Uint8Array([1]), { encoding: 'utf8' }],
    ['x', { encoding: 'utf16' }],
    ['x', { timeoutMs: 0 }],
  ])('rejects write(%p, %p) with INVALID_ARGUMENT', async (data, options) => {
    const { connection } = await open();
    await expect(
      connection.write(data as never, options as never)
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });
  });

  it('rejects writes on a closed connection with NOT_CONNECTED', async () => {
    const { fake, connection } = await open();
    fake.remoteClose(connection.id);
    await expect(connection.write('x')).rejects.toMatchObject({
      code: ErrorCode.NOT_CONNECTED,
    });
  });
});

describe('write completion and ordering', () => {
  it('keeps the order of unawaited writes', async () => {
    const { fake, connection } = await open();
    await Promise.all([
      connection.write('aaa'),
      connection.write('bbb'),
      connection.write('ccc'),
    ]);
    expect(decodeText(fake.writtenBytes(connection.id))).toBe('aaabbbccc');
  });

  it('writes a 64 KiB payload completely', async () => {
    const { fake, connection } = await open();
    const payload = new Uint8Array(65_536).map((_, i) => i % 251);
    await connection.write(payload);
    expect(fake.writtenBytes(connection.id)).toEqual(payload);
  });

  it('ends the connection with WRITE_FAILED on an OS error', async () => {
    const { fake, connection } = await open();
    const terminal = jest.fn();
    connection.onDisconnected(terminal);
    fake.writeBehavior = 'fail';

    await expect(connection.write('x')).rejects.toMatchObject({
      code: ErrorCode.WRITE_FAILED,
    });
    expect(terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'error',
        error: expect.objectContaining({ code: ErrorCode.WRITE_FAILED }),
      })
    );
  });

  it('ends the connection with WRITE_TIMEOUT and fails queued writes', async () => {
    jest.useFakeTimers();
    try {
      const fake = androidWithDevice();
      const connectPromise = connect(ADDRESS);
      await jest.advanceTimersByTimeAsync(0);
      const connection = await connectPromise;
      fake.writeBehavior = 'stall';
      const terminal = jest.fn();
      connection.onDisconnected(terminal);

      const first = connection
        .write('x', { timeoutMs: 2000 })
        .catch((e: unknown) => e);
      const queued = connection.write('y').catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(2000);

      expect(await first).toMatchObject({ code: ErrorCode.WRITE_TIMEOUT });
      expect(await queued).toMatchObject({ code: ErrorCode.NOT_CONNECTED });
      expect(terminal.mock.calls[0][0]).toMatchObject({
        reason: 'error',
        error: { code: ErrorCode.WRITE_TIMEOUT },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('lets queued writes finish before disconnecting', async () => {
    const { fake, connection } = await open();
    const write = connection.write('receipt');
    const disconnect = connection.disconnect();
    await Promise.all([write, disconnect]);
    expect(decodeText(fake.writtenBytes(connection.id))).toBe('receipt');
    expect(connection.state).toBe('disconnected');
  });

  it('rejects writes made while disconnecting', async () => {
    const { connection } = await open();
    const disconnect = connection.disconnect();
    await flush();
    await expect(connection.write('late')).rejects.toMatchObject({
      code: ErrorCode.NOT_CONNECTED,
    });
    await disconnect;
  });

  it('fails writes still stalled when the disconnect timeout elapses', async () => {
    const { fake, connection } = await open();
    fake.writeBehavior = 'stall';
    const stalled = connection.write('x').catch((e: unknown) => e);
    await connection.disconnect({ timeoutMs: 10 });
    expect(await stalled).toMatchObject({ code: ErrorCode.NOT_CONNECTED });
  });
});

describe('inbound stream', () => {
  it('delivers bytes in order, exactly once', async () => {
    const { fake, connection } = await open();
    const received: number[] = [];
    connection.onData((chunk) => received.push(...chunk));
    const all = new Uint8Array(10_000).map((_, i) => i % 256);
    for (let i = 0; i < all.length; i += 997) {
      fake.pushData(connection.id, all.subarray(i, i + 997));
    }
    expect(Uint8Array.from(received)).toEqual(all);
  });

  it('delivers data to listeners as soon as the native event arrives', async () => {
    const { fake, connection } = await open();
    const listener = jest.fn();
    connection.onData(listener);
    fake.pushData(connection.id, 'OK\r\n');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('gives the backlog to the first consumer', async () => {
    const { fake, connection } = await open();
    fake.pushData(connection.id, 'HELLO');
    const chunks: string[] = [];
    connection.onData((chunk) => chunks.push(decodeText(chunk)));
    fake.pushData(connection.id, ' WORLD');
    expect(chunks).toEqual(['HELLO', ' WORLD']);
  });

  it('keeps a greeting sent before connect() resolves', async () => {
    const fake = androidWithDevice();
    fake.onConnectionOpened = (id) => fake.pushData(id, 'GREETING');
    const connection = await connect(ADDRESS);
    const chunks: string[] = [];
    connection.onData((chunk) => chunks.push(decodeText(chunk)));
    expect(chunks).toEqual(['GREETING']);
  });

  it('gives later consumers only new bytes', async () => {
    const { fake, connection } = await open();
    const first: string[] = [];
    connection.onData((chunk) => first.push(decodeText(chunk)));
    fake.pushData(connection.id, 'a');
    const second: string[] = [];
    connection.onData((chunk) => second.push(decodeText(chunk)));
    fake.pushData(connection.id, 'b');
    expect(first).toEqual(['a', 'b']);
    expect(second).toEqual(['b']);
  });

  it('isolates a throwing data listener', async () => {
    const { fake, connection } = await open();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    connection.onData(() => {
      throw new Error('bug');
    });
    const healthy = jest.fn();
    connection.onData(healthy);
    fake.pushData(connection.id, 'x');
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(connection.state).toBe('connected');
  });

  it('ends with BUFFER_OVERFLOW instead of dropping bytes', async () => {
    const { fake, connection } = await open({ maxBufferBytes: 1024 });
    const terminal = jest.fn();
    connection.onDisconnected(terminal);
    fake.pushData(connection.id, new Uint8Array(1000));
    expect(terminal).not.toHaveBeenCalled();
    fake.pushData(connection.id, new Uint8Array(100));

    expect(terminal.mock.calls[0][0]).toMatchObject({
      reason: 'error',
      error: { code: ErrorCode.BUFFER_OVERFLOW },
    });
    expect(fake.calls.find((c) => c.method === 'closeWithError')?.args).toEqual(
      [connection.id, ErrorCode.BUFFER_OVERFLOW, expect.any(String)]
    );
  });

  it('logs sequence gaps', async () => {
    const { fake, connection } = await open();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    connection.onData(() => {});
    fake.onData.emit({ connectionId: connection.id, data: 'AA==', seq: 5 });
    expect(error).toHaveBeenCalledWith(
      '[react-native-bluetooth-classic]',
      expect.stringContaining('sequence gap')
    );
  });

  it('works on iOS', async () => {
    const { fake, id } = iosWithAccessory();
    const connection = await connect(id);
    const chunks: string[] = [];
    connection.onData((chunk) => chunks.push(decodeText(chunk)));
    fake.pushData(connection.id, 'from accessory');
    expect(chunks).toEqual(['from accessory']);
  });
});

describe('readers', () => {
  it('splits frames on a delimiter split across chunks', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({
      framer: delimiter('\r\n'),
      encoding: 'utf8',
    });
    fake.pushData(connection.id, 'OK\r');
    fake.pushData(connection.id, '\nREADY\r\n');
    await expect(reader.read()).resolves.toBe('OK');
    await expect(reader.read()).resolves.toBe('READY');
  });

  it('returns Uint8Array frames without an encoding', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({ framer: fixedLength(2) });
    fake.pushData(connection.id, new Uint8Array([1, 2, 3, 4]));
    await expect(reader.read()).resolves.toEqual(new Uint8Array([1, 2]));
    await expect(reader.read()).resolves.toEqual(new Uint8Array([3, 4]));
  });

  it('resolves a pending read when the frame arrives', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({
      framer: delimiter('\n'),
      encoding: 'ascii',
    });
    const pending = reader.read();
    fake.pushData(connection.id, 'PONG\n');
    await expect(pending).resolves.toBe('PONG');
  });

  it('rejects with READ_TIMEOUT and stays usable', async () => {
    jest.useFakeTimers();
    try {
      const fake = androidWithDevice();
      const connectPromise = connect(ADDRESS);
      await jest.advanceTimersByTimeAsync(0);
      const connection = await connectPromise;
      const reader = connection.createReader({
        framer: delimiter('\n'),
        encoding: 'utf8',
      });

      const outcome = reader.read({ timeoutMs: 1000 }).catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(1000);
      expect(await outcome).toMatchObject({ code: ErrorCode.READ_TIMEOUT });
      expect(connection.state).toBe('connected');

      fake.pushData(connection.id, 'late\n');
      await expect(reader.read()).resolves.toBe('late');
    } finally {
      jest.useRealTimers();
    }
  });

  it('iterates frames and ends after a remote close, yielding the trailing partial frame', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({
      framer: delimiter('\n'),
      encoding: 'utf8',
    });
    fake.pushData(connection.id, 'one\ntwo\nthr');
    fake.pushData(connection.id, 'ee');
    fake.remoteClose(connection.id);

    const frames: string[] = [];
    for await (const frame of reader) {
      frames.push(frame);
    }
    expect(frames).toEqual(['one', 'two', 'three']);
  });

  it('throws the terminal error from iteration after an error disconnect', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({ framer: delimiter('\n') });
    fake.pushData(connection.id, 'a\n');
    fake.failConnection(connection.id);

    const frames: Uint8Array[] = [];
    await expect(
      (async () => {
        for await (const frame of reader) frames.push(frame);
      })()
    ).rejects.toMatchObject({ code: ErrorCode.CONNECTION_LOST });
    expect(frames).toHaveLength(1);
  });

  it('rejects a pending read with the terminal error code', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({ framer: delimiter('\n') });
    const pending = reader.read();
    fake.failConnection(connection.id, ErrorCode.BLUETOOTH_DISABLED);
    await expect(pending).rejects.toMatchObject({
      code: ErrorCode.BLUETOOTH_DISABLED,
    });
  });

  it('rejects reads after a local disconnect with NOT_CONNECTED', async () => {
    const { connection } = await open();
    const reader = connection.createReader({ framer: delimiter('\n') });
    const pending = reader.read();
    await connection.disconnect();
    await expect(pending).rejects.toMatchObject({
      code: ErrorCode.NOT_CONNECTED,
    });
  });

  it('fails the reader with BUFFER_OVERFLOW and keeps the connection open', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({
      framer: delimiter('\n'),
      maxFrameBytes: 8,
    });
    fake.pushData(connection.id, 'way too long without a delimiter');
    await expect(reader.read()).rejects.toMatchObject({
      code: ErrorCode.BUFFER_OVERFLOW,
    });
    expect(connection.state).toBe('connected');
  });

  it('decodes text across raw chunks', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({ framer: raw(), encoding: 'utf8' });
    const euro = encodeText('€');
    fake.pushData(connection.id, euro.subarray(0, 1));
    fake.pushData(connection.id, euro.subarray(1));
    await expect(reader.read()).resolves.toBe('€');
  });

  it('counts frames held by a reader toward maxBufferBytes', async () => {
    const { fake, connection } = await open({ maxBufferBytes: 1024 });
    connection.createReader({ framer: fixedLength(100) });
    const terminal = jest.fn();
    connection.onDisconnected(terminal);
    fake.pushData(connection.id, new Uint8Array(1100));
    expect(terminal.mock.calls[0][0].error.code).toBe(
      ErrorCode.BUFFER_OVERFLOW
    );
  });

  it('stops receiving after close()', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({ framer: delimiter('\n') });
    reader.close();
    fake.pushData(connection.id, 'x\n');
    await expect(reader.read()).rejects.toMatchObject({
      code: ErrorCode.NOT_CONNECTED,
    });
  });

  it('rejects an invalid framer or options', async () => {
    const { connection } = await open();
    expect(() => connection.createReader({ framer: {} as never })).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT })
    );
    expect(() =>
      connection.createReader({
        framer: delimiter('\n'),
        encoding: 'hex' as never,
      })
    ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT }));
  });

  it('produces identical frames on Android and iOS', async () => {
    const chunks = ['$GP', 'GGA,1\r', '\n$GPRMC', ',2\r\n'];
    const collect = async (
      connection: Connection,
      push: (c: string) => void
    ) => {
      const reader = connection.createReader({
        framer: delimiter('\r\n'),
        encoding: 'ascii',
      });
      chunks.forEach(push);
      return [await reader.read(), await reader.read()];
    };
    const android = await open();
    const androidFrames = await collect(android.connection, (c) =>
      android.fake.pushData(android.connection.id, c)
    );
    uninstallFakeNativeModule();
    const { fake, id } = iosWithAccessory();
    const iosConnection = await connect(id);
    const iosFrames = await collect(iosConnection, (c) =>
      fake.pushData(iosConnection.id, c)
    );
    expect(androidFrames).toEqual(['$GPGGA,1', '$GPRMC,2']);
    expect(iosFrames).toEqual(androidFrames);
  });
});
